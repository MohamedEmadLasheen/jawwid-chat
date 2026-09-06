import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { CallService } from '../calls/call.service';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

@Controller('calls')
@UseFilters(CommErrorFilter)
export class CallController {
  constructor(private readonly calls: CallService) {}

  /**
   * Start a call. The participant set comes from conversation membership and
   * the room name is minted server-side; neither is client-supplied.
   */
  @Post()
  async start(@ActorId() actorId: string, @Body() body: { conversationId: string }) {
    return this.calls.start(body.conversationId, actorId);
  }

  /**
   * Mint a short-lived media token. Re-runs the full authorization chain, so a
   * revoked permission takes effect on the next join even mid-call.
   */
  @Post(':id/token')
  async token(@ActorId() actorId: string, @Param('id') id: string) {
    return this.calls.issueToken(id, actorId);
  }

  @Post(':id/accept')
  async accept(@ActorId() actorId: string, @Param('id') id: string) {
    await this.calls.accept(id, actorId);
    return { ok: true };
  }

  @Post(':id/decline')
  async decline(@ActorId() actorId: string, @Param('id') id: string) {
    await this.calls.decline(id, actorId);
    return { ok: true };
  }

  @Post(':id/end')
  async end(@ActorId() actorId: string, @Param('id') id: string, @Body() body: { outcome?: string }) {
    await this.calls.end(id, actorId, body?.outcome);
    return { ok: true };
  }

  @Get('history/:conversationId')
  async history(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return { calls: await this.calls.history(conversationId, actorId) };
  }
}
