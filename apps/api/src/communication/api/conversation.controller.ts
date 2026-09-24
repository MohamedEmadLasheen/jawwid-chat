import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ConversationService } from '../conversations/conversation.service';
import { MessageService } from '../messages/message.service';
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
   * One count query for the whole list, not one per row (mobile gap O1).
   */
  @Get()
  async list(@ActorId() actorId: string) {
    const rows = await this.conversations.listForActor(actorId);
    const unread = await this.messages.unreadCountsFor(
      rows.map((c) => c.id),
      actorId,
    );

    return {
      conversations: rows.map((c) =>
        toConversationDto(c, undefined, { unreadCount: unread.get(c.id) ?? 0 }),
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
    // by getOrCreateDirect, so no second read check is needed.
    return toConversationDto(conv, await this.conversations.membersOf(conv.id));
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

    return toConversationDto(conversation, members, {
      unreadCount: await this.messages.unreadCount(id, actorId),
    });
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
