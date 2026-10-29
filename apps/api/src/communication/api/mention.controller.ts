import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ActorId } from './actor.decorator';
import { MentionService } from '../mentions/mention.service';
import { Requires } from '../../platform/permissions/route-access';

/**
 * PD-36 @mentions. Sending one rides on the message send (`mentions` in its
 * body); these routes are the picker, "seen" and "not for me". Answering a
 * summons is PD-35's seat route (`POST conversations/:id/join`, reason
 * `mention`, sourceId = the mention): a member row in a group, an effective
 * seat in a family 1:1.
 */
@Controller()
export class MentionController {
  constructor(private readonly mentions: MentionService) {}

  /**
   * The @ picker: the members, plus -- for staff and teachers -- the staff in
   * charge of this conversation who are not members, plus -- for parents --
   * the @supervisor / @admin roles. Exactly who a send would accept.
   */
  @Requires('chat.use')
  @Get('conversations/:id/mention-candidates')
  candidates(@ActorId() actorId: string, @Param('id') id: string, @Query('q') q?: string) {
    return this.mentions.candidates(actorId, id, q);
  }

  /** The caller opened the conversation: their "Mentioned" badges there go. */
  @Requires('chat.use')
  @Post('conversations/:id/mentions/seen')
  @HttpCode(204)
  async seen(@ActorId() actorId: string, @Param('id') id: string): Promise<void> {
    await this.mentions.markSeen(actorId, id);
  }

  /** The caller's open summonses. */
  @Requires('chat.use')
  @Get('me/mentions')
  mine(@ActorId() actorId: string) {
    return this.mentions.openFor(actorId);
  }

  /** "Not for me": the caller's open summonses in that conversation close. */
  @Requires('chat.use')
  @Post('mentions/:id/dismiss')
  dismiss(@ActorId() actorId: string, @Param('id') id: string) {
    return this.mentions.dismiss(actorId, id);
  }
}
