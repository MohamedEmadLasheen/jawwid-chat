import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * AI #1 SEAM: the authenticated actor id.
 *
 * Today it is read from a header so the engine is runnable and testable before
 * auth lands. When AI #1 provides a guard, this decorator reads
 * `request.user.actorId` instead and NOTHING else in the engine changes -- every
 * service already takes an actorId and re-resolves it through IdentityService,
 * so a forged header cannot grant a permission the matrix would refuse.
 */
export const ActorId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  return String(request.headers['x-actor-id'] ?? '');
});
