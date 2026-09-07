import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';

/**
 * PLATFORM SEAM for the component that actually RECORDS.
 *
 * ## Why this is a seam and not a method on RecordingService
 *
 * Recording audio is not something this API does. It cannot: the media never
 * passes through it — that is the entire point of an SFU — so "start
 * recording" is necessarily a request to something else. Before this file,
 * `RecordingService.start` minted an upload authorization and created a
 * `pending` row for a media pipeline that **did not exist**, and nothing in the
 * repository ever moved that row to `available`. The metadata was real and the
 * audio was imaginary.
 *
 * The seam makes the dependency explicit and, more importantly, makes its
 * ABSENCE loud: `DisabledCallRecorder` throws, so an unconfigured deployment
 * fails a recording request visibly instead of leaving a row pending forever
 * while everyone assumes the call is being recorded.
 */
export interface RecordingRequest {
  /** The server-minted room. Never client-supplied. */
  roomName: string;
  /** Where the finished file must land, in the private bucket. */
  objectKey: string;
}

export interface CallRecorder {
  /**
   * Begin recording, returning the recorder's own job id.
   *
   * The id matters: it is how the recording is STOPPED, and how a webhook
   * reporting completion is matched back to the row it belongs to.
   */
  start(request: RecordingRequest): Promise<{ egressId: string }>;
  stop(egressId: string): Promise<void>;
  /** Whether this deployment can record at all. Read, never assumed. */
  readonly isAvailable: boolean;
}

/**
 * The honest no-op.
 *
 * Used when LiveKit Egress is not configured. It REFUSES rather than silently
 * succeeding, because a recording request that appears to work and records
 * nothing is worse than one that fails: the participants were told the call is
 * being recorded, and the academy believes it has an artefact it does not have.
 */
@Injectable()
export class DisabledCallRecorder implements CallRecorder {
  readonly isAvailable = false;

  async start(): Promise<{ egressId: string }> {
    throw new Error(
      'call recording is not configured: LIVEKIT_URL, LIVEKIT_API_KEY and ' +
        'LIVEKIT_API_SECRET must be set and a LiveKit Egress service must be ' +
        'reachable. See docs/recovery/PHASE-5-CLOSURE-REPORT.md.',
    );
  }

  async stop(): Promise<void> {
    // Nothing was started, so stopping is genuinely a no-op rather than a
    // failure. A call ending must not error because it was never recorded.
  }
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * LiveKit Egress, over its Twirp HTTP API.
 *
 * ## How the audio actually gets recorded
 *
 * Egress joins the room as a hidden participant, mixes the audio, and writes
 * the file to S3-compatible storage **itself**. The bytes never transit this
 * API, exactly as an attachment upload never does — which is why the
 * destination below is a full S3 credential set rather than a presigned URL.
 *
 * ## Audio only, deliberately
 *
 * `audio_only: true`. The product is voice calling; a video pipeline would
 * record black frames at a large multiple of the cost and storage, and would
 * make a recording of a *voice* call contain a video track nobody consented to.
 *
 * ## The authorization for the egress request itself
 *
 * A separate token from the one a participant gets, carrying `roomRecord` and
 * NOT `roomJoin`. Reusing a participant token here would mean the credential
 * that starts a recording is the same one handed to every phone in the call.
 */
@Injectable()
export class LiveKitEgressRecorder implements CallRecorder {
  private readonly log = new Logger(LiveKitEgressRecorder.name);

  private readonly apiKey = process.env.LIVEKIT_API_KEY ?? '';
  private readonly apiSecret = process.env.LIVEKIT_API_SECRET ?? '';
  private readonly url = process.env.LIVEKIT_URL ?? '';

  readonly isAvailable: boolean;

  constructor() {
    this.isAvailable = Boolean(this.apiKey && this.apiSecret && this.url);
  }

  /** Whether the environment can support recording at all. */
  static isConfigured(): boolean {
    return Boolean(
      process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.LIVEKIT_URL,
    );
  }

  async start(request: RecordingRequest): Promise<{ egressId: string }> {
    const body = {
      room_name: request.roomName,
      // A voice call. See the class comment.
      audio_only: true,
      file_outputs: [
        {
          file_type: 'OGG',
          filepath: request.objectKey,
          s3: {
            access_key: process.env.STORAGE_ACCESS_KEY ?? '',
            secret: process.env.STORAGE_SECRET_KEY ?? '',
            region: process.env.STORAGE_REGION ?? 'auto',
            endpoint: process.env.STORAGE_ENDPOINT ?? '',
            bucket: process.env.STORAGE_BUCKET ?? '',
            // MinIO and R2 both need path-style addressing; virtual-host style
            // would resolve the bucket as a subdomain that does not exist.
            force_path_style: true,
          },
        },
      ],
    };

    const response = await this.twirp('StartRoomCompositeEgress', body);
    const egressId = response.egress_id as string | undefined;
    if (!egressId) {
      throw new Error('egress accepted the request but returned no egress id');
    }
    // The room name is safe to log (it is server-minted and opaque); the
    // object key is NOT, because it is the location of somebody's recorded
    // voice in the private bucket.
    this.log.log(`egress ${egressId} started for room ${request.roomName}`);
    return { egressId };
  }

  async stop(egressId: string): Promise<void> {
    await this.twirp('StopEgress', { egress_id: egressId });
  }

  private async twirp(method: string, body: unknown): Promise<Record<string, unknown>> {
    if (!this.isAvailable) {
      throw new Error('LiveKit Egress is not configured');
    }

    // The Egress API is served by the LiveKit server over HTTP, on the same
    // host as the websocket endpoint. The scheme is the only difference, and
    // getting it wrong is a confusing connection error rather than a clear one.
    const httpUrl = this.url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');

    const response = await fetch(`${httpUrl}/twirp/livekit.Egress/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.recorderToken()}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // The body can echo the destination credentials back on a config error,
      // so it is deliberately NOT included in the thrown message: this string
      // reaches logs and the recording row's failure code.
      throw new Error(`egress ${method} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * A short-lived token authorizing THIS API to command Egress.
   *
   * `roomRecord: true` and no `roomJoin`: this credential may start and stop a
   * recording and may not join a room as a participant. Ninety seconds is far
   * longer than a Twirp round trip and far shorter than anything worth
   * capturing from a log.
   */
  private recorderToken(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      iss: this.apiKey,
      sub: 'jawwid-api',
      jti: randomUUID(),
      nbf: now - 5,
      exp: now + 90,
      video: { roomRecord: true },
    };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = b64url(createHmac('sha256', this.apiSecret).update(signingInput).digest());
    return `${signingInput}.${signature}`;
  }
}
