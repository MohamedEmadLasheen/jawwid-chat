import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';
import { RateLimited } from '../../platform/auth/action-throttle.guard';
import { ActionScope } from '../../platform/auth/throttle.service';
import { SuggestionService } from '../suggestions/suggestion.service';
import { SummaryService } from '../summaries/summary.service';

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
  @RateLimited(ActionScope.AI_GENERATE)
  @Post()
  async generate(@ActorId() actorId: string, @Body() body: { conversationId: string }) {
    return { suggestion: await this.suggestions.generate(actorId, body.conversationId) };
  }

  /**
   * Send it. `body` present means the manager edited it first, which is
   * recorded distinctly because the edit rate is how you find out whether the
   * drafts are any good.
   */
  /**
   * MESSAGE_SEND, not AI_GENERATE, and that is the point.
   *
   * This route reaches MessageService.send -- the same pipeline POST /messages
   * uses -- but the throttle Phase 8 added lives on the message CONTROLLER, not
   * in the service. Without this decorator the assistant would be an
   * unthrottled path to sending messages while the ordinary one was bounded,
   * which is a rate-limit bypass wearing an AI badge.
   *
   * Sharing the scope means a staff member has ONE send budget, whichever
   * surface they send from. That is the only model that cannot be gamed by
   * alternating between the two.
   */
  @RateLimited(ActionScope.MESSAGE_SEND)
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

/**
 * Conversation summaries.
 *
 * Mounted next to suggestions because they share one property: both are
 * gated by the CONVERSATION's authorization, resolved server-side, and neither
 * accepts a hint from the client about who is asking (§14, §32).
 */
@Controller('ai/summaries')
@UseFilters(CommErrorFilter)
export class SummaryController {
  constructor(private readonly summaries: SummaryService) {}

  /**
   * Summarise. Returns `summary: null` when the assistant is unavailable or
   * returned an incomplete answer -- the conversation itself is still there to
   * read, which is the graceful degradation §28 asks for.
   *
   * `refresh=true` bypasses the cache; without it, a repeat request on an
   * unchanged conversation costs nothing.
   */
  @RateLimited(ActionScope.AI_GENERATE)
  @Post()
  async summarize(
    @ActorId() actorId: string,
    @Body() body: { conversationId: string; refresh?: boolean },
  ) {
    return this.summaries.summarize(actorId, body.conversationId, { refresh: body.refresh });
  }
}
