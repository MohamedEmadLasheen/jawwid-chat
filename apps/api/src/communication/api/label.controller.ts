import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseFilters } from '@nestjs/common';
import { LabelService } from '../conversations/label.service';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

/**
 * Chat labels: staff-only shared tags (LabelService). The organization is
 * always the caller's own; no route takes one.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class LabelController {
  constructor(private readonly labels: LabelService) {}

  @Get('chat-labels')
  async list(@ActorId() actorId: string) {
    return this.labels.list(actorId);
  }

  @Post('chat-labels')
  async create(@ActorId() actorId: string, @Body() body: { name?: unknown; color?: unknown }) {
    return this.labels.create(actorId, body ?? {});
  }

  @Patch('chat-labels/:labelId')
  async update(
    @ActorId() actorId: string,
    @Param('labelId') labelId: string,
    @Body() body: { name?: unknown; color?: unknown },
  ) {
    return this.labels.update(actorId, labelId, body ?? {});
  }

  @Delete('chat-labels/:labelId')
  async remove(@ActorId() actorId: string, @Param('labelId') labelId: string) {
    await this.labels.remove(actorId, labelId);
    return { ok: true };
  }

  /** Apply a label to a conversation. Idempotent. */
  @Put('conversations/:conversationId/labels/:labelId')
  async apply(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Param('labelId') labelId: string,
  ) {
    await this.labels.setOnConversation(actorId, conversationId, labelId, true);
    return { ok: true };
  }

  @Delete('conversations/:conversationId/labels/:labelId')
  async unapply(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Param('labelId') labelId: string,
  ) {
    await this.labels.setOnConversation(actorId, conversationId, labelId, false);
    return { ok: true };
  }
}
