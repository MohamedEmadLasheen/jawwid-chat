import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
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

  /**
   * Hang up. THE OUTCOME IS NOT A REQUEST FIELD.
   *
   * This used to pass `body.outcome` straight through, so a participant could
   * POST `{"outcome": "answered"}` and have history record a conversation that
   * never happened -- the exact class of defect the accept/decline
   * authorization chain exists to prevent -- or send any other string and turn a
   * check-constraint violation into a 500. The outcome is derived from the
   * call's own locked state: ACTIVE ends `answered`, RINGING ends `missed`, and
   * `declined` comes only from the decline endpoint.
   */
  @Post(':id/end')
  async end(@ActorId() actorId: string, @Param('id') id: string) {
    await this.calls.end(id, actorId);
    return { ok: true };
  }

  @Get('history/:conversationId')
  async history(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return { calls: await this.calls.history(conversationId, actorId) };
  }

  /**
   * `GET /calls/history` — THIS ACTOR'S calls, across every conversation they may
   * read (W8-W2).
   *
   * NOT A FAMILY QUERY. The account scope is derived from the conversations the
   * actor is authorized to read, never from `family_id`: one family holds
   * conversations a given parent is not a member of, so a family-wide query
   * would hand them somebody else's calls. Family-scoped history is a separate,
   * currently UNDEFINED authorization contract — see the W8-W2 closeout.
   *
   * Paged by the server. `cursor` is the opaque value from the previous
   * response's `nextCursor`; `limit` is clamped server-side, so a client cannot
   * ask for the whole table.
   */
  @Get('history')
  async accountHistory(
    @ActorId() actorId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = Number.parseInt(limit ?? '', 10);
    return this.calls.historyForActor(actorId, {
      cursor,
      limit: Number.isFinite(parsed) ? parsed : undefined,
    });
  }
}
