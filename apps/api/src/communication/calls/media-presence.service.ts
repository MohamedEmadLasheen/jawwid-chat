import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
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
 * * It does not end calls. An empty media room is not an ending: the lifecycle
 *   ends a call explicitly or through the ring-timeout sweep, and inventing a
 *   third way would be a new lifecycle rule this workstream has no mandate for.
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

    const terminal = call.status === CallStatus.ENDED;

    const changed = await this.prisma.$transaction(async (tx) => {
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
}
