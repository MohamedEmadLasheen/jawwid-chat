import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ActorId } from './actor.decorator';
import { StaffToolsService } from '../staff-tools/staff-tools.service';

/** Staff tools: private labels and quick replies. Teachers and families get 403. */
@Controller()
export class StaffToolsController {
  constructor(private readonly tools: StaffToolsService) {}

  @Get('me/labels')
  labels(@ActorId() actorId: string) {
    return this.tools.labels(actorId);
  }

  @Post('me/labels')
  createLabel(@ActorId() actorId: string, @Body() body: { name?: unknown; color?: unknown }) {
    return this.tools.createLabel(actorId, body ?? {});
  }

  @Patch('me/labels/:id')
  updateLabel(@ActorId() actorId: string, @Param('id') id: string, @Body() body: { name?: unknown; color?: unknown }) {
    return this.tools.updateLabel(actorId, id, body ?? {});
  }

  @Delete('me/labels/:id')
  async deleteLabel(@ActorId() actorId: string, @Param('id') id: string) {
    await this.tools.deleteLabel(actorId, id);
    return { ok: true };
  }

  /** Replace the caller's own labels on a conversation they can open. */
  @Put('conversations/:id/labels')
  setLabels(@ActorId() actorId: string, @Param('id') id: string, @Body() body: { labelIds?: unknown }) {
    return this.tools.setConversationLabels(actorId, id, body?.labelIds);
  }

  @Get('quick-replies')
  quickReplies(@ActorId() actorId: string) {
    return this.tools.quickReplies(actorId);
  }

  @Post('quick-replies')
  createQuickReply(@ActorId() actorId: string, @Body() body: { shortcut?: unknown; body?: unknown; scope?: unknown }) {
    return this.tools.createQuickReply(actorId, body ?? {});
  }

  @Patch('quick-replies/:id')
  updateQuickReply(@ActorId() actorId: string, @Param('id') id: string, @Body() body: { shortcut?: unknown; body?: unknown }) {
    return this.tools.updateQuickReply(actorId, id, body ?? {});
  }

  @Delete('quick-replies/:id')
  async deleteQuickReply(@ActorId() actorId: string, @Param('id') id: string) {
    await this.tools.deleteQuickReply(actorId, id);
    return { ok: true };
  }
}
