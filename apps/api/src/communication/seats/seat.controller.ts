import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../api/actor.decorator';
import { CommErrorFilter } from '../api/http-exception.filter';
import { ConversationService } from '../conversations/conversation.service';
import { ConversationSeatService } from './conversation-seat.service';
import { Requires } from '../../platform/permissions/route-access';

/**
 * PD-35: taking and leaving a visible seat. Behind the global bearer guard; who
 * may sit where is the reason's policy (ConversationSeatService). POST for
 * every change.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class SeatController {
  constructor(
    private readonly seats: ConversationSeatService,
    private readonly conversations: ConversationService,
  ) {}

  /** { reason, sourceId?, note? } */
  @Requires('chat.use')
  @Post('conversations/:id/join')
  async join(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    return this.seats.join(actor, id, body ?? {});
  }

  @Requires('chat.use')
  @Post('conversations/:id/leave')
  async leave(@ActorId() actorId: string, @Param('id') id: string) {
    const actor = await this.conversations.requireActor(actorId);
    return this.seats.leave(actor, id);
  }

  @Requires('chat.use')
  @Get('me/seats')
  async mine(@ActorId() actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    return this.seats.mine(actor);
  }
}
