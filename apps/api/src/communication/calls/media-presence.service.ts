import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { CallStatus } from '../contracts/vocab';

/**
 * A uuid, and nothing else, reaches a uuid column.
 *
 * Prisma RAISES on a malformed uuid rather than returning no row, so without
 * this a participant identity of `parent_p` is a 500 out of a webhook handler
 * instead of a clean refusal. Same guard, for the same reason, as
 * `RelationshipService`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a reconciliation attempt did, for the caller and for the log. */
export type MediaPresenceOutcome =
  /** State changed and a domain event was enqueued. */
  | 'reconciled'
  /** Valid, already known, nothing to do. Duplicate or out-of-order delivery. */
  | 'noop'
  /** The room did not resolve to a call. */
  | 'unknown_room'
  /** The actor is not a recorded participant of that call. */
  | 'unknown_participant'
  /** The call is already in a terminal state. Recorded, never revived. */
  | 'call_ended';

/**
 * Reconciling what LiveKit says actually happened in the room.
 *
 * WHY THIS EXISTS. The server has always known when somebody ACCEPTED a call —
 * `POST /calls/:id/accept` is an application act it performs itself. It has
 * never known whether the device then reached the media room. Those are
 * different facts, and the gap between them is where a call that looks answered
 * and carries no audio lives.
 *
 *   accepted        `call_participant.joined_at`, written by HTTP accept
 *   in the room     `call_participant.media_joined_at`, written only from here
 *   publishing      a third fact again, and NOT represented — see the migration
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * * It never creates a call. A room that does not resolve is a diagnostic, not
 *   an invitation to invent one.
 * * It never creates a participant. An identity that is not already on the call
 *   is refused — an orphan participant conjured from a webhook would be a
 *   membership nobody authorized.
 * * It never authorizes anything. Presence is an observation; who may call whom
 *   was decided before a token was ever issued, and this cannot widen it.
 * * It never moves terminal state backwards. A webhook arriving after a call
 *   ended is reconciled into history at most, and cannot revive it.
 * * It does not end calls. An empty media room is not an ending by itself.
 *   CHATSCHED-013 (owner, 2026-10-31) gave a drop a lifecycle of its own, and
 *   this is its EDGE, not its end: presence records when an active call fell
 *   below two people in the room (`interrupted_at`, `call.interrupted`) and
 *   when a rejoin brought it back (`call.resumed`), and keeps the call's
 *   connected time (`connected_since` / `connected_seconds`). The ending is
 *   the worker's sweep, after the grace (CallService.endInterruptedCalls).
 *
 * ORDER-INDEPENDENT BY CONSTRUCTION. Every write uses the event's own timestamp
 * and monotonic arithmetic — earliest join wins, latest leave wins — so
 * duplicate and reordered delivery converge on the same row. Arrival order is
 * never treated as evidence of what happened first, because at-least-once
 * delivery makes it no evidence at all.
 */
@Injectable()
export class MediaPresenceService {
  private readonly log = new Logger(MediaPresenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * LiveKit reports a participant in the room.
   *
   * `media_joined_at` takes the EARLIEST time we have ever been told, so a
   * duplicate or a late-arriving earlier event cannot move it forward. A join
   * newer than a recorded departure clears that departure: they came back.
   */
  async participantJoined(input: {
    roomName: string;
    identity: string;
    at: Date;
  }): Promise<MediaPresenceOutcome> {
    return this.reconcile(input, 'joined');
  }

  /**
   * LiveKit reports a participant gone.
   *
   * `media_left_at` takes the LATEST time we have been told. It does not touch
   * `media_joined_at`: having been in the room is a fact about the past, and a
   * departure is not evidence against it. That is what stops an answered call
   * being reread as never answered once the room empties.
   */
  async participantLeft(input: {
    roomName: string;
    identity: string;
    at: Date;
  }): Promise<MediaPresenceOutcome> {
    return this.reconcile(input, 'left');
  }

  private async reconcile(
    input: { roomName: string; identity: string; at: Date },
    kind: 'joined' | 'left',
  ): Promise<MediaPresenceOutcome> {
    const { roomName, identity, at } = input;

    // ROOM -> CALL, through the server-minted room name and nothing else.
    // `chat.call.room_name` is unique and was generated when the call was
    // created, so it is the one mapping a client never had a hand in. A
    // conversation id would not do: conversations outlive calls and a
    // conversation can have many.
    const call = await this.prisma.call.findUnique({
      where: { roomName },
      select: { id: true, conversationId: true, status: true },
    });
    if (!call) return 'unknown_room';

    // FAIL CLOSED ON A SHAPE WE CANNOT LOOK UP. An identity that is not a uuid
    // cannot be one of ours, and asking the database would raise rather than
    // answer -- turning a refusal into a 500 and, because LiveKit retries a
    // non-2xx, into a retry loop.
    if (!UUID.test(identity ?? '')) return 'unknown_participant';

    // IDENTITY -> PARTICIPANT. The identity in a LiveKit token is the actor id
    // the server put there when it minted the token (`identity: actor.actorId`
    // in CallService.issueToken), so it is canonical. Nothing here looks at a
    // display name or at participant metadata: those are decoration a client
    // can influence, and matching on them would be an impersonation route.
    const participant = await this.prisma.callParticipant.findUnique({
      where: { callId_actorId: { callId: call.id, actorId: identity } },
      select: { id: true, mediaJoinedAt: true, mediaLeftAt: true },
    });
    if (!participant) return 'unknown_participant';

    let terminal = call.status === CallStatus.ENDED;
    const graceSeconds = await this.config.get('call.reconnect_grace_seconds');

    const changed = await this.prisma.$transaction(async (tx) => {
      // CHATSCHED-013: the call row first, locked, and its status read again
      // under the lock. A rejoin and the grace sweep meeting here settle on one
      // outcome: the sweep skips a locked row, and a call the sweep ended
      // first reads `ended` and is not resumed.
      const [locked] = await tx.$queryRaw<Array<{ status: string }>>`
        select status from chat.call where id = ${call.id}::uuid for update`;
      terminal = locked?.status === CallStatus.ENDED;

      // The claim and the write are one conditional UPDATE, so two concurrent
      // deliveries of the same event cannot both decide they changed something.
      // `count` is the claim: 0 means another delivery got there first, or the
      // row already said this, and either way there is nothing to announce.
      const updated =
        kind === 'joined'
          ? await tx.$executeRaw`
              update chat.call_participant
                 set media_joined_at = least(coalesce(media_joined_at, ${at}::timestamptz), ${at}::timestamptz),
                     media_left_at   = case
                                         when media_left_at is not null and media_left_at < ${at}::timestamptz
                                           then null
                                         else media_left_at
                                       end
               where id = ${participant.id}::uuid
                 and (media_joined_at is null
                      or media_joined_at > ${at}::timestamptz
                      or (media_left_at is not null and media_left_at < ${at}::timestamptz))`
          : await tx.$executeRaw`
              update chat.call_participant
                 set media_left_at = greatest(coalesce(media_left_at, ${at}::timestamptz), ${at}::timestamptz)
               where id = ${participant.id}::uuid
                 and (media_left_at is null or media_left_at < ${at}::timestamptz)`;

      if (updated === 0) return false;

      // A call that has already ended is reconciled into history and announced
      // to nobody: there is no live conversation waiting to hear that somebody
      // reached a room the call has finished in, and emitting would invite a
      // consumer to act on a finished call.
      if (terminal) return false;

      if (locked?.status === CallStatus.ACTIVE) await this.connection(tx, call, at, kind, graceSeconds);

      // The existing outbox, in the SAME transaction as the state change, so a
      // published event and the row it describes cannot disagree.
      await this.outbox.enqueue(
        tx,
        kind === 'joined'
          ? CommEvent.CALL_PARTICIPANT_JOINED
          : CommEvent.CALL_PARTICIPANT_LEFT,
        {
          callId: call.id,
          conversationId: call.conversationId,
          actorId: identity,
        },
      );

      return true;
    });

    if (terminal) {
      // Worth a line: it is the shape of a late delivery, and silence here is
      // what makes a missing event hard to explain later.
      this.log.log(`media presence recorded on an ended call (${kind})`);
    }

    return changed ? 'reconciled' : terminal ? 'call_ended' : 'noop';
  }

  /**
   * CHATSCHED-013: an ACTIVE call's connection, after a presence change, under
   * the call's row lock. Connected means two or more participants in the room
   * who have not left the call.
   *
   *   reached two     the connected span opens (`connected_since`); a call
   *                   that was interrupted is resumed (`call.resumed`)
   *   fell below two  the open span is closed into `connected_seconds`; a
   *                   DEPARTURE interrupts the call (`call.interrupted`, with
   *                   the moment it ends unless somebody comes back)
   *
   * A hang-up never reaches here: it ends the call first, and presence on an
   * ended call is history only. Event times are LiveKit's, as everywhere here.
   */
  private async connection(
    tx: Prisma.TransactionClient,
    call: { id: string; conversationId: string },
    at: Date,
    kind: 'joined' | 'left',
    graceSeconds: number,
  ): Promise<void> {
    const [state] = await tx.$queryRaw<Array<{ present: number; connected: boolean; interrupted: boolean }>>`
      select (select count(*)::int from chat.call_participant p
               where p.call_id = c.id and p.left_at is null
                 and p.media_joined_at is not null and p.media_left_at is null) as present,
             c.connected_since is not null as connected,
             c.interrupted_at is not null as interrupted
        from chat.call c where c.id = ${call.id}::uuid`;
    if (!state) return;

    if (state.present >= 2) {
      if (!state.connected) {
        await tx.$executeRaw`update chat.call set connected_since = ${at}::timestamptz where id = ${call.id}::uuid`;
      }
      if (state.interrupted) {
        await tx.$executeRaw`update chat.call set interrupted_at = null where id = ${call.id}::uuid`;
        await this.outbox.enqueue(tx, CommEvent.CALL_RESUMED, { callId: call.id, conversationId: call.conversationId });
      }
      return;
    }

    if (state.connected) {
      await tx.$executeRaw`
        update chat.call
           set connected_seconds = connected_seconds
                 + greatest(0, round(extract(epoch from (${at}::timestamptz - connected_since))))::int,
               connected_since = null
         where id = ${call.id}::uuid`;
    }
    if (kind === 'left' && !state.interrupted) {
      await tx.$executeRaw`update chat.call set interrupted_at = ${at}::timestamptz where id = ${call.id}::uuid`;
      await this.outbox.enqueue(tx, CommEvent.CALL_INTERRUPTED, {
        callId: call.id,
        conversationId: call.conversationId,
        until: new Date(at.getTime() + graceSeconds * 1000).toISOString(),
      });
    }
  }
}
