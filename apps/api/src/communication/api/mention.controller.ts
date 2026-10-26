import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ActorId } from './actor.decorator';
import { MentionService } from '../mentions/mention.service';

/**
 * PD-36 @mentions. Sending one rides on the message send (`mentions` in its
 * body); these routes are the picker and the answers. Joining a GROUP is
 * PD-35's seat route (`POST conversations/:id/join`, reason `mention`).
 */
@Controller()
export class MentionController {
  constructor(private readonly mentions: MentionService) {}

  /**
   * The @ picker: the members, plus -- for staff and teachers -- the staff in
   * charge of this conversation who are not members, plus -- for parents --
   * the @supervisor / @admin roles. Exactly who a send would accept.
   */
  @Get('conversations/:id/mention-candidates')
  candidates(@ActorId() actorId: string, @Param('id') id: string, @Query('q') q?: string) {
    return this.mentions.candidates(actorId, id, q);
  }

  /** The caller opened the conversation: their "Mentioned" badges there go. */
  @Post('conversations/:id/mentions/seen')
  @HttpCode(204)
  async seen(@ActorId() actorId: string, @Param('id') id: string): Promise<void> {
    await this.mentions.markSeen(actorId, id);
  }

  /** The caller's open summonses (pending, or stepped into a 1:1). */
  @Get('me/mentions')
  mine(@ActorId() actorId: string) {
    return this.mentions.openFor(actorId);
  }

  /** "Not for me" -- or, after stepping into a 1:1, step back out (visible). */
  @Post('mentions/:id/dismiss')
  dismiss(@ActorId() actorId: string, @Param('id') id: string) {
    return this.mentions.dismiss(actorId, id);
  }

  /** Step into a family 1:1 (no seat: a 1:1 never gains a third member). */
  @Post('mentions/:id/step-in')
  stepIn(@ActorId() actorId: string, @Param('id') id: string) {
    return this.mentions.stepIn(actorId, id);
  }
}
