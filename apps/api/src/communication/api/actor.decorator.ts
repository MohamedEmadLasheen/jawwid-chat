import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Actor } from '../../platform/types';

/**
 * The authenticated actor id.
 *
 * This file used to read `x-actor-id` from the request headers, as a seam until
 * authentication landed. It has landed (D-6): AuthGuard verifies the bearer
 * token, confirms the session is still live, re-resolves the actor, and is the
 * only thing that may attach `request.actor`.
 *
 * The header is no longer read anywhere, by anything. Sending `x-actor-id` now
 * has exactly the same effect as sending nothing at all.
 *
 * Nothing else in the engine changed, exactly as the seam predicted: every
 * service still takes an actorId and re-resolves it through IdentityService, so
 * authorization was never relying on this decorator for its guarantees.
 */
export const ActorId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  const actor = request.actor;
  if (!actor?.actorId) {
    // Unreachable through the guard; a controller reachable without it would be
    // a configuration mistake, and must fail closed rather than act as nobody.
    throw new UnauthorizedException({
      error: { code: 'AUTH.MISSING_TOKEN', message: 'authentication required' },
    });
  }
  return actor.actorId;
});

/** The full authenticated actor, for handlers that need more than the id. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const request = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  if (!request.actor) {
    throw new UnauthorizedException({
      error: { code: 'AUTH.MISSING_TOKEN', message: 'authentication required' },
    });
  }
  return request.actor;
});
