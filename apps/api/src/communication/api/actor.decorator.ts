import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The authenticated actor id.
 *
 * Set by AuthenticatedGuard from a verified access token, never by the client.
 * The previous implementation read an `x-actor-id` request header, which let any
 * caller claim any identity (NF-08); that header is now ignored entirely, and a
 * request that reaches a controller has already been authenticated.
 *
 * Services still re-resolve the id through IdentityService and still ask
 * AuthorizationService for permission -- authentication narrows who is asking,
 * it does not decide what they may do.
 */
export const ActorId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  return String(request.user?.actorId ?? '');
});
