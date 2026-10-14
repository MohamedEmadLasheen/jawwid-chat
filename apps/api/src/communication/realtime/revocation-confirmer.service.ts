import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from '../../platform/prisma.service';
import { RealtimeRevocationHub } from '../../platform/realtime-revocation';
import { realtimeMetrics } from '../../platform/realtime-metrics';
import { MEDIA_ROOM_CONTROL } from '../../platform/tokens';
import type { MediaRoomControl } from '../calls/media-room-control';

/** How often an API node looks for deactivations to confirm. */
export const REVOCATION_CONFIRM_INTERVAL_MS = Number(process.env.REVOCATION_CONFIRM_INTERVAL_MS ?? 1_000);
const BATCH = 50;

interface Claimed {
  id: string;
  accountId: string | null;
}

export interface RevocationConfirmerStats {
  /** Revocations this node confirmed. */
  confirmed: number;
  /** Barrier attempts that did not confirm (each left its rows for a retry). */
  unconfirmedAttempts: number;
  lastError: string | null;
  lastConfirmedAt: string | null;
}

/**
 * RT-032 -- the CONFIRM half of a deactivation.
 *
 * Every transaction that takes an account, contact, staff member or teacher out
 * of service -- whoever wrote it: chat.deactivate_principal(),
 * chat.offboard_staff(), an operator -- also wrote a chat.principal_revocation
 * row (an ENABLE ALWAYS trigger; see 20261014150000). A row is only visible
 * once that transaction COMMITTED, so the barrier this runs for it necessarily
 * starts after the commit.
 *
 * For each batch: claim the rows (SKIP LOCKED + a claim lease, so one node
 * works a row at a time), push the cleanup (every socket of the login
 * disconnects -- best-effort), run the RT-009 completion barrier, and only when
 * it CONFIRMS stamp confirmed_at. A deactivation is COMPLETE at that stamp: no
 * event decided before its commit can be emitted after it, on any node. A
 * barrier that does not confirm (a node that does not acknowledge, Redis or the
 * database unreachable) stamps nothing: the claim is released, the error
 * recorded, and the row is retried -- never confirmed by a timeout.
 *
 * Runs only in an API process with a realtime server (the gateway starts it):
 * the worker has no server, and the hub's barrier refuses there.
 */
@Injectable()
export class RevocationConfirmer {
  private readonly log = new Logger(RevocationConfirmer.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  readonly node = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  /**
   * How long a claim keeps other nodes off a row. It outlives one barrier (its
   * steps time out at 6 s) with room to stamp; a node that dies holding a claim
   * delays that row by at most this. A test may shorten it.
   */
  claimSeconds = 30;
  readonly stats: RevocationConfirmerStats = {
    confirmed: 0,
    unconfirmedAttempts: 0,
    lastError: null,
    lastConfirmedAt: null,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly revocation: RealtimeRevocationHub,
    // RT-037. Optional only so a test or a process without media can build it;
    // the application always provides LiveKitRoomControl.
    @Optional() @Inject(MEDIA_ROOM_CONTROL) private readonly media?: MediaRoomControl,
  ) {}

  /** (Re)starts the periodic pass; a test may shorten the interval. */
  start(intervalMs = REVOCATION_CONFIRM_INTERVAL_MS): void {
    this.stop();
    this.timer = setInterval(() => void this.confirmPending(), intervalMs);
    this.timer.unref?.();
    void this.confirmPending();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * RT-037. Every (room, identity) of a call that has not ended in which one of
   * these revocations' people is a participant -- whether or not they ever
   * joined: a token may be in their hands -- is emptied through LiveKit's
   * control plane. 'absent' is success; anything else throws.
   */
  private async removeFromCallRooms(revocationIds: readonly string[]): Promise<void> {
    if (!this.media) return;
    const seats = await this.prisma.$queryRaw<{ room_name: string; actor_id: string }[]>`
      SELECT DISTINCT c.room_name, cp.actor_id::text AS actor_id
        FROM chat.call c JOIN chat.call_participant cp ON cp.call_id = c.id
       WHERE c.status <> 'ended'
         AND cp.actor_id IN (
           SELECT r.principal_id FROM chat.principal_revocation r
            WHERE r.id = ANY(${[...revocationIds]}::uuid[]) AND r.principal_kind <> 'account'
           UNION
           SELECT p.id FROM chat.principal_revocation r
             JOIN (SELECT id, account_id FROM chat.contact UNION ALL SELECT id, account_id FROM chat.staff
                   UNION ALL SELECT id, account_id FROM chat.teacher) p ON p.account_id = r.principal_id
            WHERE r.id = ANY(${[...revocationIds]}::uuid[]) AND r.principal_kind = 'account')`;
    for (const seat of seats) {
      try {
        if ((await this.media.removeParticipant(seat.room_name, seat.actor_id)) === 'removed') {
          realtimeMetrics.mediaParticipantsRemoved++;
        }
      } catch (e) {
        realtimeMetrics.mediaRemovalFailed++;
        throw new Error(`media: a call room could not be emptied (${(e as Error).name})`);
      }
    }
  }

  /**
   * Cleanup after confirmation: notifications still SCHEDULED for the people
   * these revocations took out of service are cancelled, so a later
   * re-activation does not replay them. Not the control -- dispatch re-checks
   * liveness at send time regardless -- so a failure here is only logged.
   */
  private async cancelPendingNotifications(revocationIds: readonly string[]): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE chat.notification n
         SET status = 'cancelled', failure_code = 'RECIPIENT_INACTIVE'
       WHERE n.status = 'scheduled'
         AND n.recipient_id IN (
           SELECT r.principal_id FROM chat.principal_revocation r
            WHERE r.id = ANY(${[...revocationIds]}::uuid[]) AND r.principal_kind <> 'account'
           UNION
           SELECT p.id FROM chat.principal_revocation r
             JOIN (SELECT id, account_id FROM chat.contact UNION ALL SELECT id, account_id FROM chat.staff
                   UNION ALL SELECT id, account_id FROM chat.teacher) p ON p.account_id = r.principal_id
            WHERE r.id = ANY(${[...revocationIds]}::uuid[]) AND r.principal_kind = 'account')`
      .catch((e: Error) => this.log.warn(`pending notifications not cancelled (dispatch still refuses them): ${e.name}`));
  }

  /**
   * One pass. Returns how many revocations this call confirmed. Never throws:
   * a failure is recorded on the rows and in the log, and the next pass retries.
   */
  async confirmPending(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const claimed = await this.prisma.$queryRaw<Claimed[]>`
        UPDATE chat.principal_revocation r
           SET claimed_until = now() + make_interval(secs => ${this.claimSeconds}),
               claimed_by = ${this.node},
               attempts = r.attempts + 1
         WHERE r.id IN (SELECT id FROM chat.principal_revocation
                         WHERE confirmed_at IS NULL
                           AND (claimed_until IS NULL OR claimed_until < now())
                         ORDER BY recorded_at
                         LIMIT ${BATCH}
                         FOR UPDATE SKIP LOCKED)
        RETURNING r.id::text AS id, r.account_id::text AS "accountId"`;
      if (claimed.length === 0) return 0;
      const ids = claimed.map((c) => c.id);

      // Cleanup, not the control: delivery-time checks already refuse these
      // people; this just stops their sockets idling until the sweep.
      for (const accountId of new Set(claimed.map((c) => c.accountId).filter((a): a is string => !!a))) {
        this.revocation.disconnectAccount(accountId);
      }

      try {
        await this.revocation.confirmRevoked();
        // RT-037: completion also means "out of every live call room". A room
        // that cannot be emptied (LiveKit unreachable, refused) keeps the
        // deactivation unconfirmed, exactly like a node that did not fence.
        await this.removeFromCallRooms(ids);
      } catch (e) {
        const reason = (e as Error).message.slice(0, 500);
        this.stats.unconfirmedAttempts++;
        this.stats.lastError = reason;
        realtimeMetrics.barrierUnconfirmed++;
        this.log.warn(`deactivation not confirmed (${ids.length} pending, will retry): ${reason}`);
        await this.prisma.$executeRaw`
          UPDATE chat.principal_revocation
             SET claimed_until = NULL, claimed_by = NULL, last_error = ${reason}
           WHERE id = ANY(${ids}::uuid[]) AND confirmed_at IS NULL AND claimed_by = ${this.node}`
          .catch(() => undefined); // the claim lease expires on its own
        return 0;
      }

      const stamped = await this.prisma.$executeRaw`
        UPDATE chat.principal_revocation
           SET confirmed_at = now(), confirmed_by = ${this.node}, claimed_until = NULL, last_error = NULL
         WHERE id = ANY(${ids}::uuid[]) AND confirmed_at IS NULL AND claimed_by = ${this.node}`;
      this.stats.confirmed += stamped;
      realtimeMetrics.deactivationsConfirmed += stamped;
      await this.cancelPendingNotifications(ids);
      this.stats.lastConfirmedAt = new Date().toISOString();
      this.log.log(`confirmed ${stamped} deactivation(s) after the realtime completion barrier`);
      return stamped;
    } catch (e) {
      // The database itself: nothing was stamped; the claim lease expires.
      this.stats.unconfirmedAttempts++;
      this.stats.lastError = (e as Error).message.slice(0, 500);
      this.log.warn(`deactivation confirmation pass failed (will retry): ${(e as Error).name}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
