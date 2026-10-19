import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Optional,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { MediaPresenceService } from '../calls/media-presence.service';
import type { MediaRoomControl } from '../calls/media-room-control';
import { PrismaService } from '../../platform/prisma.service';
import { MEDIA_ROOM_CONTROL } from '../../platform/tokens';
import { actorIsLive } from '../../platform/liveness';
import { realtimeMetrics } from '../../platform/realtime-metrics';
import { Public } from '../../platform/auth/auth.guard';
import {
  LiveKitWebhookVerifier,
  MEDIA_WEBHOOK_EVENTS,
  WebhookVerificationError,
} from '../calls/livekit-webhook.verifier';

/** Just enough of the request to read a raw body. Nest populates `rawBody`. */
interface RawBodyRequest {
  rawBody?: Buffer;
}

/**
 * `POST /livekit/webhook` — what LiveKit says actually happened in a room.
 *
 * THIN ON PURPOSE. Verify, reduce, hand to the reconciliation, answer. There is
 * no call logic here: `MediaPresenceService` owns what a join or a leave means,
 * and putting any of it in a controller would put it somewhere a second
 * transport could not reach.
 *
 * NO AUTH GUARD, AND THAT IS NOT AN OVERSIGHT. LiveKit is not a Jawwid actor and
 * carries no session; it authenticates with a JWT signed by the project API
 * secret, which the verifier checks. The route is unauthenticated to Nest and
 * authenticated to LiveKit, and nothing reaches the database until the verifier
 * has vouched for it.
 *
 * ALWAYS 200 ON A VERIFIED EVENT, including one it does nothing with. LiveKit
 * retries a non-2xx, so a failure code for "I have already seen this" or "that
 * room is not mine" would buy a retry loop for an answer that will not change.
 * An unverified request is the exception: that gets 401 and touches nothing.
 *
 * THE RAW BODY IS THE SIGNED THING. `rawBody: true` in `main.ts` keeps the bytes
 * as they arrived, because the JWT's `sha256` claim is a hash of exactly those.
 * A re-serialized object hashes differently and every webhook would fail.
 */
/**
 * PUBLIC to the bearer-token guard, because LiveKit is not a user: it
 * authenticates with ITS signature (an HS256 JWT over the exact body, verified
 * below before anything is read), never with a Jawwid access token. Without
 * `@Public()` the global AuthenticatedGuard (PR-B) answered every LiveKit
 * delivery 401 before this controller ran -- verified live on 2026-10-14 -- so
 * no media-presence webhook could ever have been accepted by a running API
 * (W5, closed at 2be26b8, reopened for this by RT-037; see findings.md).
 */
@Public()
@Controller('livekit')
export class LiveKitWebhookController {
  private readonly log = new Logger(LiveKitWebhookController.name);

  constructor(
    private readonly verifier: LiveKitWebhookVerifier,
    private readonly presence: MediaPresenceService,
    // RT-037: join-time enforcement. Optional only for tests that build the
    // controller without it; the application always provides both.
    @Optional() private readonly prisma?: PrismaService,
    @Optional() @Inject(MEDIA_ROOM_CONTROL) private readonly media?: MediaRoomControl,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() request: RawBodyRequest,
    @Headers('authorization') authorization?: string,
  ): Promise<{ ok: boolean }> {
    const raw = request.rawBody?.toString('utf8');
    if (!raw) {
      // Nothing to verify is nothing to trust.
      this.log.warn('livekit webhook: rejected, no body');
      return this.unauthorized();
    }

    let event;
    try {
      event = await this.verifier.verify(raw, authorization);
    } catch (error) {
      // Category only. The body, the header and the claims never reach a log.
      const reason =
        error instanceof WebhookVerificationError ? error.message : 'unverifiable';
      this.log.warn(`livekit webhook: rejected, ${reason}`);
      return this.unauthorized();
    }

    if (
      event.event !== MEDIA_WEBHOOK_EVENTS.PARTICIPANT_JOINED &&
      event.event !== MEDIA_WEBHOOK_EVENTS.PARTICIPANT_LEFT
    ) {
      // room_started, room_finished, track_published, egress… all verified and
      // all ignored. W5 consumes presence; consuming more would be a media
      // analytics system nobody asked for.
      this.log.debug(`livekit webhook: ignored event ${event.event}`);
      return { ok: true };
    }

    if (!event.roomName || !event.identity) {
      // A presence event has to say who, and where. One that does not is
      // malformed, not an invitation to guess.
      this.log.warn(
        `livekit webhook: ${event.event} without a room or identity, ignored`,
      );
      return { ok: true };
    }

    // RT-037. A join by someone who is no longer live -- with a token issued
    // before their deactivation, or one LiveKit refreshed for them -- is undone
    // at once. Presence is still recorded below (it happened), and LiveKit's
    // participant_left follows the removal. If the removal fails the webhook
    // answers 503, so LiveKit delivers it again rather than us forgetting it.
    if (
      event.event === MEDIA_WEBHOOK_EVENTS.PARTICIPANT_JOINED &&
      this.prisma && this.media &&
      !(await actorIsLive(this.prisma, event.identity))
    ) {
      try {
        await this.media.removeParticipant(event.roomName, event.identity);
        realtimeMetrics.mediaJoinsRefused++;
        this.log.warn('livekit webhook: a join by an identity that is no longer live was undone');
      } catch (e) {
        realtimeMetrics.mediaRemovalFailed++;
        this.log.error(`livekit webhook: could not undo a join by an inactive identity (${(e as Error).name}); LiveKit will retry`);
        throw new ServiceUnavailableException();
      }
    }

    const started = Date.now();
    const outcome =
      event.event === MEDIA_WEBHOOK_EVENTS.PARTICIPANT_JOINED
        ? await this.presence.participantJoined({
            roomName: event.roomName,
            identity: event.identity,
            at: event.at,
          })
        : await this.presence.participantLeft({
            roomName: event.roomName,
            identity: event.identity,
            at: event.at,
          });

    // Enough to diagnose a call whose presence looks wrong, and no identifiers:
    // the event name, what the reconciliation decided, and how long it took.
    // No room name (it is a media handle), no actor id, no token, no header.
    this.log.log(
      `livekit webhook: ${event.event} -> ${outcome} in ${Date.now() - started}ms`,
    );

    return { ok: true };
  }

  /**
   * 401, and no state touched.
   *
   * Says nothing beyond the status. An unverified caller learns that their
   * credential was refused and not which part of it was wrong, nor whether the
   * room or the participant would have existed — a verifier that answered those
   * would be an oracle.
   */
  private unauthorized(): never {
    throw new UnauthorizedException();
  }
}
