import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ActorId } from './actor.decorator';
import { StaffToolsService } from '../staff-tools/staff-tools.service';
import { Requires } from '../../platform/permissions/route-access';

/** Staff tools: private labels and quick replies. Teachers and families get 403. */
@Controller()
export class StaffToolsController {
  constructor(private readonly tools: StaffToolsService) {}

  @Requires('chat.use')
  @Get('me/labels')
  labels(@ActorId() actorId: string) {
    return this.tools.labels(actorId);
  }

  @Requires('chat.use')
  @Post('me/labels')
  createLabel(@ActorId() actorId: string, @Body() body: { name?: unknown; color?: unknown }) {
    return this.tools.createLabel(actorId, body ?? {});
  }

  @Requires('chat.use')
  @Patch('me/labels/:id')
  updateLabel(@ActorId() actorId: string, @Param('id') id: string, @Body() body: { name?: unknown; color?: unknown }) {
    return this.tools.updateLabel(actorId, id, body ?? {});
  }

  @Requires('chat.use')
  @Delete('me/labels/:id')
  async deleteLabel(@ActorId() actorId: string, @Param('id') id: string) {
    await this.tools.deleteLabel(actorId, id);
    return { ok: true };
  }

  /** Replace the caller's own labels on a conversation they can open. */
  @Requires('chat.use')
  @Put('conversations/:id/labels')
  setLabels(@ActorId() actorId: string, @Param('id') id: string, @Body() body: { labelIds?: unknown }) {
    return this.tools.setConversationLabels(actorId, id, body?.labelIds);
  }

  @Requires('chat.use')
  @Get('quick-replies')
  quickReplies(@ActorId() actorId: string) {
    return this.tools.quickReplies(actorId);
  }

  @Requires('chat.use')
  @Post('quick-replies')
  createQuickReply(@ActorId() actorId: string, @Body() body: { shortcut?: unknown; body?: unknown; scope?: unknown }) {
    return this.tools.createQuickReply(actorId, body ?? {});
  }

  @Requires('chat.use')
  @Patch('quick-replies/:id')
  updateQuickReply(@ActorId() actorId: string, @Param('id') id: string, @Body() body: { shortcut?: unknown; body?: unknown }) {
    return this.tools.updateQuickReply(actorId, id, body ?? {});
  }

  @Requires('chat.use')
  @Delete('quick-replies/:id')
  async deleteQuickReply(@ActorId() actorId: string, @Param('id') id: string) {
    await this.tools.deleteQuickReply(actorId, id);
    return { ok: true };
  }
}
