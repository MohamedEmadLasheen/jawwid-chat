import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Actor } from '../types';
import { AuthError, AuthErrorCode } from './auth.errors';

/**
 * The authenticated actor, as resolved by AuthGuard.
 *
 * This replaces the Phase 0 `@ActorId()` decorator, which read the `x-actor-id`
 * header -- a bring-up seam that let any caller name any active actor
 * (red-team RT-001 / NF-08). The shape controllers see is unchanged: services
 * still take an actor id and still re-resolve it through IdentityService, so a
 * forged value could never have granted a permission the matrix would refuse.
 * What changes is that there is no value to forge.
 *
 * It throws rather than returning empty when no actor is present: a handler
 * reachable without authentication is a bug, and it should fail loudly at the
 * first request rather than quietly treat the caller as nobody.
 */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const request = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  if (!request.actor) {
    throw new AuthError(AuthErrorCode.MISSING_TOKEN, 'authentication required');
  }
  return request.actor;
});

/** The authenticated actor's id. Convenience for the many services that take one. */
export const ActorId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  if (!request.actor) {
    throw new AuthError(AuthErrorCode.MISSING_TOKEN, 'authentication required');
  }
  return request.actor.actorId;
});

/** The current session id, for "log out this device" and session listings. */
export const CurrentSessionId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ sessionId?: string }>();
    return request.sessionId ?? '';
  },
);
