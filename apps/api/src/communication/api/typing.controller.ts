import { Body, Controller, Param, Post, UseFilters } from '@nestjs/common';
import { CommError, CommErrorCode } from '../../platform/errors';
import { ActionScope, RateLimited } from '../../platform/auth/action-throttle.guard';
import { Requires } from '../../platform/permissions/route-access';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { Actor } from '../../platform/types';
import { CurrentActor } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

/**
 * PD-37: "typing" over HTTP, for a client whose realtime transport only
 * receives (the app: its socket is the closed call transport, which sends no
 * frames). Exactly the socket's rules -- the gateway decides: debounced in Redis
 * first, then the seat and PD-7, then delivered to seated members only.
 *
 * THE COST, honestly: unlike a socket frame, every ping is a request, and the
 * global guards authenticate it -- 2 to 4 queries (session, account, actor,
 * staff permissions) before the Redis debounce is reached. Accepted as the
 * trade-off for not reopening the closed transport: the client sends at most
 * one start every 3 s while the text changes, plus one stop, and the
 * `typing_actor` budget bounds the rest.
 */
@Controller('conversations/:conversationId/typing')
@UseFilters(CommErrorFilter)
export class TypingController {
  constructor(private readonly gateway: RealtimeGateway) {}

  /** `{ typing: true }` while the draft changes (clients ping every 3 s), `{ typing: false }` to stop. */
  // PD-40: a chat action, as the read and delivered cursors are.
  @Requires('chat.use')
  @RateLimited(ActionScope.TYPING)
  @Post()
  async typing(
    @CurrentActor() actor: Actor,
    @Param('conversationId') conversationId: string,
    @Body() body: { typing?: unknown },
  ) {
    if (typeof body?.typing !== 'boolean') {
      throw new CommError(CommErrorCode.VALIDATION, 'typing must be true or false', 400);
    }
    return this.gateway.typingFromHttp(actor, conversationId, body.typing);
  }
}
