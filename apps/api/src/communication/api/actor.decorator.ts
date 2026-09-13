import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthError, AuthErrorCode } from '../../platform/auth/auth.errors';
import type { Actor } from '../../platform/types';

/**
 * The authenticated caller's actor id.
 *
 * WAS the `x-actor-id` header (RT-001 / NF-08: any caller could name any active
 * actor). PR-B replaced it. The header is no longer read here or anywhere else
 * on the HTTP path; this reads `request.actor`, which only AuthenticatedGuard
 * writes, and which only a verified bearer token produces.
 *
 * Nothing else in the engine changed: every service already took an actorId and
 * re-resolved it through IdentityService, so the 29 call sites of this decorator
 * are untouched -- they simply receive an id that is now proven rather than
 * asserted.
 *
 * The throw is defence in depth. The global guard refuses an unauthenticated
 * request before any handler runs, so reaching this branch means a route was
 * marked `@Public()` and then asked for an actor anyway -- a wiring mistake
 * that must fail closed as a 401, never as an empty string that a service would
 * then fail to resolve into a confusing 500 (AUTH-INV-2).
 */
export const ActorId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  const actorId = request.actor?.actorId;
  if (!actorId) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
  return actorId;
});

/** The whole resolved actor, for the rare handler that needs more than the id. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const request = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  if (!request.actor) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
  return request.actor;
});
