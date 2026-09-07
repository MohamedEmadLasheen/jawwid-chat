import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';
import { SuggestionService } from '../suggestions/suggestion.service';

/**
 * Suggested replies.
 *
 * Note the route names. There is no POST /ai/suggestions/:id/auto-send and no
 * flag on `generate` that delivers -- `send` is a separate request, made by a
 * person, after they have seen the words (§10).
 */
@Controller('ai/suggestions')
@UseFilters(CommErrorFilter)
export class SuggestionController {
  constructor(private readonly suggestions: SuggestionService) {}

  /** The pending drafts for this conversation, for this requester. */
  @Get()
  async list(@ActorId() actorId: string, @Query('conversationId') conversationId: string) {
    return { suggestions: await this.suggestions.listPending(actorId, conversationId) };
  }

  /**
   * Draft a reply. Returns 200 with `suggestion: null` when the assistant has
   * nothing worth proposing -- unavailable, unsure, or a reply that would have
   * needed a promise it is not allowed to make. A manager writing it themselves
   * is a correct outcome, not an error.
   */
  @Post()
  async generate(@ActorId() actorId: string, @Body() body: { conversationId: string }) {
    return { suggestion: await this.suggestions.generate(actorId, body.conversationId) };
  }

  /**
   * Send it. `body` present means the manager edited it first, which is
   * recorded distinctly because the edit rate is how you find out whether the
   * drafts are any good.
   */
  @Post(':id/send')
  async send(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { body?: string },
  ) {
    return this.suggestions.send(actorId, id, body?.body);
  }

  @Post(':id/dismiss')
  async dismiss(@ActorId() actorId: string, @Param('id') id: string) {
    return this.suggestions.dismiss(actorId, id);
  }
}
