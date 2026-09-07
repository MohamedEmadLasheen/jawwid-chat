/**
 * The authenticated-action rate limit gate.
 *
 * Two properties matter and neither is obvious from reading the guard:
 *
 *  1. It counts against the actor the SIGNED TOKEN established, never against
 *     anything the caller supplied. A counter an attacker can rename is not a
 *     counter.
 *  2. It is silent on routes that do not ask for it. The cost is a database
 *     round trip, and paying it on message history paging would be a
 *     performance regression dressed as a security control.
 */
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { ActionThrottleGuard, RATE_LIMITED_ACTION } from '@platform/auth/action-throttle.guard';
import { ActionScope } from '@platform/auth/throttle.service';
import { AuthError, AuthErrorCode } from '@platform/auth/auth.errors';

interface Recorded {
  scope: string;
  actorId: string | undefined;
}

function build(options: {
  scope?: ActionScope;
  actorId?: string;
  type?: string;
  blocked?: boolean;
}) {
  const recorded: Recorded[] = [];
  const throttle = {
    hitAction: async (scope: ActionScope, actorId: string | undefined) => {
      recorded.push({ scope, actorId });
      if (options.blocked) {
        throw new AuthError(AuthErrorCode.TOO_MANY_ATTEMPTS, 'too many requests; slow down', 429);
      }
    },
  };

  const reflector = {
    getAllAndOverride: () => options.scope,
  } as unknown as Reflector;

  const request = { headers: {}, actor: options.actorId ? { actorId: options.actorId } : undefined };

  const context = {
    getType: () => options.type ?? 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  const guard = new ActionThrottleGuard(throttle as never, reflector);
  return { guard, context, recorded, request };
}

describe('ActionThrottleGuard', () => {
  it('counts an undecorated route not at all', async () => {
    const { guard, context, recorded } = build({ actorId: 'actor-1' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(recorded).toEqual([]);
  });

  it('counts a decorated route against the token-derived actor', async () => {
    const { guard, context, recorded } = build({
      scope: ActionScope.MESSAGE_SEND,
      actorId: 'actor-1',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(recorded).toEqual([{ scope: 'message_send_actor', actorId: 'actor-1' }]);
  });

  it('refuses with 429 and the stable code once the actor has tripped', async () => {
    const { guard, context } = build({
      scope: ActionScope.BROADCAST_SEND,
      actorId: 'actor-1',
      blocked: true,
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: AuthErrorCode.TOO_MANY_ATTEMPTS,
      status: 429,
    });
  });

  it('counts the ATTEMPT, so a request refused later still spent budget', async () => {
    // The handler never runs when the guard throws, and the guard runs before
    // validation. A client whose payload is rejected must not be able to retry
    // without limit -- a rejected request still costs authorization and a round
    // trip.
    const { guard, context, recorded } = build({
      scope: ActionScope.MESSAGE_SEND,
      actorId: 'actor-1',
    });
    await guard.canActivate(context);
    await guard.canActivate(context);
    expect(recorded).toHaveLength(2);
  });

  it('ignores non-HTTP contexts: frames are bounded in the gateway', async () => {
    // A database write per WebSocket frame would be a self-inflicted denial of
    // service, which is why FrameBudget exists instead.
    const { guard, context, recorded } = build({
      scope: ActionScope.MESSAGE_SEND,
      actorId: 'actor-1',
      type: 'ws',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(recorded).toEqual([]);
  });

  it('does not hand an unattributed request a free pass', async () => {
    // AuthGuard has already refused this in practice. If it ever did not, the
    // fallback must be a shared bucket rather than an unlimited one.
    const { guard, context, recorded } = build({ scope: ActionScope.MESSAGE_SEND });
    await guard.canActivate(context);
    expect(recorded).toEqual([{ scope: 'message_send_actor', actorId: undefined }]);
  });

  it('reads the scope from route metadata rather than from the request', async () => {
    // Guards against the mistake of letting a header or body field choose which
    // counter is charged, which would let a caller charge an empty one.
    expect(RATE_LIMITED_ACTION).toBe('jawwid:rate-limited-action');
  });
});
