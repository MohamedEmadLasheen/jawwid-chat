import { Body, Controller, Param, Post, UseFilters } from '@nestjs/common';
import { CommError, CommErrorCode } from '../../platform/errors';
import { ActionScope, RateLimited } from '../../platform/auth/action-throttle.guard';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

/**
 * PD-37: "typing" over HTTP, for a client whose realtime transport only
 * receives (the app: its socket is the closed call transport, which sends no
 * frames). Exactly the socket's rules -- the gateway decides: debounced in Redis
 * first, then the seat and PD-7, then delivered to seated members only.
 */
@Controller('conversations/:conversationId/typing')
@UseFilters(CommErrorFilter)
export class TypingController {
  constructor(private readonly gateway: RealtimeGateway) {}

  /** `{ typing: true }` while the draft changes (clients ping every 3 s), `{ typing: false }` to stop. */
  @RateLimited(ActionScope.TYPING)
  @Post()
  async typing(
    @ActorId() actorId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: { typing?: unknown },
  ) {
    if (typeof body?.typing !== 'boolean') {
      throw new CommError(CommErrorCode.VALIDATION, 'typing must be true or false', 400);
    }
    return this.gateway.typingFromHttp(actorId, conversationId, body.typing);
  }
}
