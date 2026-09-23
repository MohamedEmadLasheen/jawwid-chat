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
   *
   * PD-6: a teacher/parent pair is permitted only where the server-resolved
   * relationship authorizes it, and refused otherwise with
   * COMM.TEACHER_PARENT_NOT_AUTHORIZED. `withActorId` selects the other party;
   * it asserts nothing about the relationship with them.
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

  @Post('student-group/:learnerId/sync')
  async sync(@Param('learnerId') learnerId: string) {
    const conv = await this.conversations.syncStudentGroup(learnerId);
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
