import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ConversationService } from '../conversations/conversation.service';
import { toConversationDto } from '../contracts/dto';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

@Controller('conversations')
@UseFilters(CommErrorFilter)
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  /** The chat list, RBAC-scoped to what this actor may see. */
  @Get()
  async list(@ActorId() actorId: string) {
    const rows = await this.conversations.listForActor(actorId);
    return { conversations: rows.map((c) => toConversationDto(c)) };
  }

  /**
   * Get or create the 1:1 channel with another actor.
   * A teacher/parent pair is refused here with COMM.BR1_TEACHER_PARENT_DIRECT.
   */
  @Post('direct')
  async direct(@ActorId() actorId: string, @Body() body: { withActorId: string }) {
    const conv = await this.conversations.getOrCreateDirect(actorId, body.withActorId);
    return toConversationDto(conv);
  }

  /** The official group for a learner, created from Core relationships. */
  @Post('student-group')
  async studentGroup(@ActorId() actorId: string, @Body() body: { learnerId: string }) {
    const conv = await this.conversations.ensureStudentGroup(body.learnerId, actorId);
    return toConversationDto(conv);
  }

  /**
   * Reconcile the group's membership from Core.
   *
   * Takes the actor, and not only for the audit trail: without it this route
   * accepted any learner id from any authenticated session and answered with
   * that learner's conversation. A learner id is in every class notification's
   * push payload, so it is exactly the kind of id a client can hold without
   * being entitled to what it names.
   */
  @Post('student-group/:learnerId/sync')
  async sync(@ActorId() actorId: string, @Param('learnerId') learnerId: string) {
    const conv = await this.conversations.syncStudentGroup(learnerId, actorId);
    return conv ? toConversationDto(conv) : { synced: false };
  }

  @Get(':id')
  async get(@ActorId() actorId: string, @Param('id') id: string) {
    const conv = await this.conversations.requireConversation(id);
    await this.conversations.setPreferences(id, actorId, {});
    return toConversationDto(conv);
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
