import { Body, Controller, Get, Inject, Param, Post, Query, UseFilters } from '@nestjs/common';
import { OBJECT_STORAGE } from '../../platform/tokens';
import type { ObjectStorage } from '../attachments/object-storage';
import { signActorAvatars, signMemberAvatars } from '../profile/avatar-urls';
import { actorRefKey } from '../../platform/identity.service';
import type { Actor } from '../../platform/types';
import { ConversationService } from '../conversations/conversation.service';
import { MessageService } from '../messages/message.service';
import { CallService } from '../calls/call.service';
import { toConversationDto } from '../contracts/dto';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

@Controller('conversations')
@UseFilters(CommErrorFilter)
export class ConversationController {
  /**
   * Two services, composed here rather than one calling the other.
   *
   * MessageService already depends on ConversationService; having conversations
   * reach back for an unread count would close that loop. The controller is the
   * place the two meet, which is what MessageController already does with
   * AttachmentService.
   */
  constructor(
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
    private readonly calls: CallService,
    // The storage seam, because signing a member's photo is this layer's act: it is the
    // layer that holds the seam AND the one that has just established the reader may see
    // these members at all.
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * The chat list, RBAC-scoped to what this actor may see.
   *
   * Order matters and is load-bearing: `listForActor` establishes the
   * authorization boundary FIRST, and the unread counts are then computed for
   * exactly that set of ids. The count query is never handed an id from the
   * request, so it cannot be asked about a conversation this actor may not see
   * -- and being scoped to their own receipts, it could not answer if it were.
   *
   * One count query for the whole list, not one per row (mobile gap O1). The row FACES
   * follow the same discipline: one membership query, one identity batch and one signing
   * batch for the entire page, deduplicated by actor -- never per conversation.
   */
  @Get()
  async list(@ActorId() actorId: string) {
    const rows = await this.conversations.listForActor(actorId);
    const [unread, counterparts] = await Promise.all([
      this.messages.unreadCountsFor(
        rows.map((c) => c.id),
        actorId,
      ),
      this.conversations.counterpartsFor(rows, actorId),
    ]);

    // Keyed by actorRefKey so one person appearing on two rows is signed ONCE, and so a
    // staff id can never collide with a teacher id that happens to match.
    const unique: Map<string, Actor> = new Map();
    for (const actor of counterparts.values()) {
      unique.set(actorRefKey({ actorId: actor.actorId, actorKind: actor.kind }), actor);
    }
    const signed = await signActorAvatars(this.storage, unique);

    const avatarFor = (conversationId: string): string | null => {
      const actor = counterparts.get(conversationId);
      if (!actor) return null;
      return (
        signed.get(actorRefKey({ actorId: actor.actorId, actorKind: actor.kind })) ?? null
      );
    };

    return {
      conversations: rows.map((c) =>
        toConversationDto(c, undefined, {
          unreadCount: unread.get(c.id) ?? 0,
          avatarUrl: avatarFor(c.id),
        }),
      ),
    };
  }

  /**
   * Get or create the 1:1 channel with another actor.
   *
   * PD-6: a teacher/parent pair is permitted only where the server-resolved
   * relationship authorizes it, and refused otherwise with
   * COMM.TEACHER_PARENT_NOT_AUTHORIZED. `withActorId` selects the other party;
   * it asserts nothing about the relationship with them.
   */
  @Post('direct')
  async direct(@ActorId() actorId: string, @Body() body: { withActorId: string }) {
    const conv = await this.conversations.getOrCreateDirect(actorId, body.withActorId);
    // PD-6: members[] so the client can tell a Parent<->Teacher channel from a
    // Parent<->Admin one. The caller was just authorized into this conversation
    // by getOrCreateDirect, so no second read check is needed -- but the viewer is
    // passed so `canOpenDirect` is answered for THIS caller rather than defaulting
    // to false on the one route that returns a freshly opened channel.
    return toConversationDto(
      conv,
      await this.conversations.membersOf(conv.id, await this.conversations.requireActor(actorId)),
    );
  }

  /** The official group for a learner, created from Core relationships. */
  @Post('student-group')
  async studentGroup(@ActorId() actorId: string, @Body() body: { learnerId: string }) {
    const conv = await this.conversations.ensureStudentGroup(body.learnerId, actorId);
    return toConversationDto(conv);
  }

  @Post('student-group/:learnerId/sync')
  async sync(@Param('learnerId') learnerId: string) {
    const conv = await this.conversations.syncStudentGroup(learnerId);
    return conv ? toConversationDto(conv) : { synced: false };
  }

  /**
   * One conversation, with its membership.
   *
   * `members[]` is required here by API-CONTRACT section 3.4 and is what lets a
   * client classify a `direct` conversation after PD-6. readWithMembers()
   * authorizes the read explicitly rather than leaving it to the preferences
   * upsert below to throw.
   */
  @Get(':id')
  async get(@ActorId() actorId: string, @Param('id') id: string) {
    // Authorization is EXPLICIT here. It used to ride on setPreferences
    // throwing (API-CONTRACT 3.4 recorded the wart), which meant the route was
    // readable only by tracing a side effect. readWithMembers runs canRead
    // against the actor's membership and refuses before anything is read.
    const { conversation, members } = await this.conversations.readWithMembers(id, actorId);

    // setPreferences stays, for what it is actually for: the per-actor
    // preference/read row. It is no longer this route's access control.
    await this.conversations.setPreferences(id, actorId, {});

    // Members carry display names (mobile gap O3); `readWithMembers` resolves
    // them through the one batch primitive. Only on this route: the LIST
    // endpoint deliberately does not load members, because that would be an
    // identity batch per row for a screen that renders none of them.
    // Signed AFTER readWithMembers ran canRead, so a refused reader never reaches a
    // signature. One batch for the whole roster rather than one call per face.
    // The row face comes from the SAME rule the list uses, rather than a second derivation
    // over `members` -- one question, one answer, even though both are available here.
    const [unreadCount, avatarUrls, counterparts] = await Promise.all([
      this.messages.unreadCount(id, actorId),
      signMemberAvatars(this.storage, members),
      this.conversations.counterpartsFor([conversation], actorId),
    ]);

    const counterpart = counterparts.get(conversation.id);
    const avatarUrl = counterpart
      ? (avatarUrls.get(
          actorRefKey({ actorId: counterpart.actorId, actorKind: counterpart.kind }),
        ) ?? null)
      : null;

    return toConversationDto(conversation, members, { unreadCount, avatarUrls, avatarUrl });
  }

  /**
   * May the caller start a call in this conversation? ADVISORY.
   *
   * The interface needs this because it may not work it out for itself:
   * `screens/call.md` section 4 requires the call affordance to be ABSENT
   * where the backend does not authorize the pairing, and forbids the client
   * inferring which pairings those are. Since PD-6 that set is data.
   *
   * NOT AN AUTHORIZATION. `canCall: true` is this instant's answer and does not
   * promise that the POST which follows will succeed -- `POST /calls` decides
   * again, from scratch, and is the only thing that authorizes a call. A
   * relationship revoked in between is refused there, as it should be.
   *
   * Read access is established first, so this cannot be used to probe a
   * conversation the caller cannot open: that case returns the read path's own
   * error, not a capability answer.
   *
   * Response: `{ canCall, code }` -- the code a stable COMM.* value or null,
   * and nothing else. No ids, no names, no relationship detail.
   */
  @Get(':id/call-capability')
  async callCapability(@ActorId() actorId: string, @Param('id') id: string) {
    return this.calls.callCapability(id, actorId);
  }

  /** Membership mutations are staff-only, and always carry a reason. */
  @Post(':id/members')
  async setMember(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body()
    body: {
      action: 'add' | 'remove';
      actorId: string;
      actorKind: string;
      memberRole: string;
      isSilent?: boolean;
      reason: string;
    },
  ) {
    await this.conversations.setMembership(
      id,
      actorId,
      {
        actorId: body.actorId,
        actorKind: body.actorKind,
        memberRole: body.memberRole,
        isSilent: body.isSilent,
      },
      body.action,
      body.reason,
    );
    return { ok: true };
  }

  /** Archive / mute / pin are per-user preferences. */
  @Post(':id/preferences')
  async preferences(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { archived?: boolean; pinned?: boolean; mutedUntil?: string | null },
  ) {
    await this.conversations.setPreferences(id, actorId, {
      archived: body.archived,
      pinned: body.pinned,
      mutedUntil: body.mutedUntil === undefined ? undefined : body.mutedUntil ? new Date(body.mutedUntil) : null,
    });
    return { ok: true };
  }
}
