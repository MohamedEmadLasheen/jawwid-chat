import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * DEPRECATED SEAM -- the caller's actor id, read from the `x-actor-id` header.
 *
 * This is NOT authentication (red-team RT-001 / NF-08): any caller can name any
 * active actor. It exists so the engine is runnable and testable before Phase 1
 * lands verified credentials, and src/platform/identity-seam.ts refuses to start
 * the process outside a local environment while it is in place.
 *
 * Phase 1 replaces this with a guard that verifies a bearer token and sets
 * `request.user.actorId`; this decorator then reads that and NOTHING else in
 * the engine changes -- every service already takes an actorId and re-resolves
 * it through IdentityService, so a forged header cannot grant a permission the
 * matrix would refuse. See docs/architecture/IDENTITY-MODEL.md.
 */
export const ActorId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  return String(request.headers['x-actor-id'] ?? '');
});
