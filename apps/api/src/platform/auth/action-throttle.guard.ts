import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActionScope, ThrottleService } from './throttle.service';
import type { AuthenticatedRequest } from './auth.guard';

export const RATE_LIMITED_ACTION = 'jawwid:rate-limited-action';

/**
 * Bound how often one authenticated actor may perform this action.
 *
 *   @RateLimited(ActionScope.MESSAGE_SEND)
 *   @Post()
 *   async send(...) { ... }
 *
 * Limits live in chat.config (`abuse.throttle.<scope>`), so changing one is an
 * operations change rather than a deploy. docs/security/AUTH-THROTTLING.md 5.1
 * lists the scopes and the reasoning behind each number.
 */
export const RateLimited = (scope: ActionScope): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMITED_ACTION, scope);

/**
 * The authenticated-abuse gate.
 *
 * OPT-IN, and deliberately the opposite arrangement from AuthGuard.
 * Authentication must be default-on because a route nobody remembered to
 * protect is a hole. Rate limiting must be default-off because the cost is a
 * database round trip per request, and putting one on `GET /health` or on
 * paging through message history buys nothing and slows everything. So the
 * decorator names the handful of actions that are expensive to repeat, and the
 * cost lands only there.
 *
 * ORDER MATTERS. This is registered after AuthGuard, so `request.actor` is
 * already resolved from the signed token by the time it runs. Registering it
 * first would leave it counting against an identity nothing had verified --
 * which an attacker chooses freely, making the counter worthless.
 *
 * It counts the ATTEMPT, before the handler runs. Counting successes instead
 * would let a client that fails validation retry without limit, and a rejected
 * request still costs the parsing, the authorization query and the round trip.
 */
@Injectable()
export class ActionThrottleGuard implements CanActivate {
  constructor(
    private readonly throttle: ThrottleService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket frames are bounded in the gateway, per socket, in memory --
    // a typing indicator fires per keystroke and must not reach the database.
    if (context.getType() !== 'http') return true;

    const scope = this.reflector.getAllAndOverride<ActionScope | undefined>(
      RATE_LIMITED_ACTION,
      [context.getHandler(), context.getClass()],
    );
    if (!scope) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await this.throttle.hitAction(scope, request.actor?.actorId);
    return true;
  }
}
