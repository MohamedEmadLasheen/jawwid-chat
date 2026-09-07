import { Body, Controller, Headers, HttpCode, Logger, Post, UseFilters } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { RecordingService } from '../calls/recording.service';
import { CommErrorFilter } from './http-exception.filter';

/**
 * LiveKit Egress completion webhooks.
 *
 * ## Why this route is unauthenticated by bearer token, and what replaces it
 *
 * Egress is a service, not a user. It has no session and no actor, so the
 * ordinary auth guard has nothing to resolve — which is exactly the shape of
 * route that becomes an unauthenticated write endpoint by accident.
 *
 * It is authenticated instead by the signature LiveKit puts on every webhook:
 * an `Authorization` JWT signed with the SAME API secret this deployment uses
 * to mint call tokens, whose `sha256` claim is the digest of the raw body. Both
 * halves are checked here — a valid signature over a *different* body is a
 * replay with substituted contents, and checking only the signature would let
 * one through.
 *
 * ## What it may do
 *
 * Exactly two things: mark a pending recording available, or mark it failed.
 * It cannot create a recording, cannot reach a recording that is not `pending`,
 * and is matched on the egress job id — a value only the recorder and the row
 * know. A forged call therefore needs the API secret AND a live job id, and
 * even then can only complete a recording that was genuinely requested.
 */
@Controller('webhooks/egress')
@UseFilters(CommErrorFilter)
export class EgressWebhookController {
  private readonly log = new Logger(EgressWebhookController.name);

  constructor(private readonly recordings: RecordingService) {}

  @Post()
  // 200 on everything this route understands, including events it ignores.
  // A webhook that answers 4xx to an event it simply does not care about
  // teaches the sender to retry forever.
  @HttpCode(200)
  async receive(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: boolean }> {
    if (!this.verify(authorization, body)) {
      this.log.warn('rejected an egress webhook with a bad or missing signature');
      // Deliberately not 401: a signature oracle tells an attacker when they
      // have the secret right. It is also not a lie — nothing was accepted.
      return { ok: false };
    }

    const event = body.event as string | undefined;
    const info = (body.egress_info ?? {}) as Record<string, unknown>;
    const egressId = info.egress_id as string | undefined;
    if (!egressId) return { ok: false };

    switch (event) {
      case 'egress_ended': {
        // LiveKit reports 'EGRESS_COMPLETE' on success and a failure status
        // otherwise. Treating anything non-complete as success would mark a
        // recording available with no file behind it.
        const status = info.status as string | undefined;
        if (status && status !== 'EGRESS_COMPLETE') {
          await this.recordings.failFromEgress(egressId, `EGRESS_${status}`);
          return { ok: true };
        }

        const file = this.firstFile(info);
        await this.recordings.completeFromEgress({
          egressId,
          // Egress reports nanoseconds. Rounding to whole seconds here keeps
          // the column an integer of seconds, as every other duration is.
          durationSeconds: Math.max(0, Math.round(Number(file?.duration ?? 0) / 1_000_000_000)),
          byteSize: Number(file?.size ?? 0),
          objectKey: (file?.filename as string | undefined) ?? null,
        });
        return { ok: true };
      }

      case 'egress_failed': {
        await this.recordings.failFromEgress(egressId, 'EGRESS_FAILED');
        return { ok: true };
      }

      default:
        // egress_started, egress_updated and anything LiveKit adds later.
        // Acknowledged and ignored rather than retried at us forever.
        return { ok: true };
    }
  }

  /** The finished file, from either shape Egress has used for this field. */
  private firstFile(info: Record<string, unknown>): Record<string, unknown> | null {
    const results = info.file_results as Array<Record<string, unknown>> | undefined;
    if (results && results.length > 0) return results[0];
    return (info.file as Record<string, unknown> | undefined) ?? null;
  }

  /**
   * LiveKit's webhook signature: a JWT signed with the API secret whose
   * `sha256` claim is the base64 digest of the raw body.
   *
   * Both the signature AND the body digest are checked. A valid signature over
   * a different body is a replay with substituted contents.
   */
  private verify(authorization: string | undefined, body: unknown): boolean {
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!secret || !authorization) return false;

    const token = authorization.replace(/^Bearer\s+/i, '');
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const [header, payload, signature] = parts;
    const expected = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Constant time, so the comparison is not itself an oracle for the secret.
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    } catch {
      return false;
    }

    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return false;

    const digest = createHash('sha256').update(JSON.stringify(body)).digest('base64');
    return typeof claims.sha256 === 'string' && claims.sha256 === digest;
  }
}
