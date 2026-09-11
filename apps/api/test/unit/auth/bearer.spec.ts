/**
 * Bearer authentication at the guard (API-CONTRACT §3.1, AUTH-INV-2).
 *
 * An unauthenticated request must reach NO controller and must return 401 --
 * never 500, never a default actor. Before PR-B an unauthenticated request
 * returned HTTP 500, which is the defect these pin closed.
 */
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedGuard, bearerToken, PUBLIC_ROUTE } from '@platform/auth/auth.guard';
import { AuthError, AuthErrorCode } from '@platform/auth/auth.errors';
import type { AuthService } from '@platform/auth/auth.service';
import {
  buildAuth,
  contactActor,
  FakeDb,
  FakeIdentity,
  withAuthEnv,
} from './support/fake-db';

jest.setTimeout(60_000);

const PASSWORD = 'a-correct-password-1';

interface Req {
  headers: Record<string, string | string[] | undefined>;
  actor?: unknown;
  accountId?: string;
  sessionId?: string;
}

function httpContext(request: Req, handler: () => void = () => {}): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('the Authorization header parser', () => {
  it('accepts exactly one well-formed Bearer credential', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('refuses every malformed shape rather than guessing', () => {
    for (const header of [
      undefined,
      '',
      'abc.def.ghi', // no scheme
      'bearer abc.def.ghi', // wrong case: two parsers must not disagree
      'BEARER abc.def.ghi',
      'Bearer', // no space, no token
      'Bearer ', // empty token
      'Bearer  abc', // padded -- the token would differ from what was signed
      'Bearer abc ', // trailing space
      'Basic dXNlcjpwYXNz', // wrong scheme
      'Token abc.def.ghi',
    ]) {
      expect(bearerToken(header)).toBeNull();
    }
  });

  it('refuses a DUPLICATED Authorization header instead of picking one', () => {
    // Which one wins is exactly the ambiguity a proxy and an app can answer
    // differently, and request smuggling lives in that gap.
    expect(bearerToken(['Bearer good.token.here', 'Bearer evil.token.here'])).toBeNull();
  });
});

describe('the global guard', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;
  let guard: AuthenticatedGuard;

  beforeEach(async () => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
    guard = new AuthenticatedGuard(auth, new Reflector());
    const account = await db.addAccount({ subject: 'parent-guard' }, PASSWORD);
    identity.give(account.id, contactActor());
  });

  it('a missing Authorization header is 401 UNAUTHENTICATED, not 500', async () => {
    const error = await guard.canActivate(httpContext({ headers: {} })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: AuthErrorCode.UNAUTHENTICATED, status: 401 });
  });

  it('a malformed header is 401, and the request gets no actor', async () => {
    const request: Req = { headers: { authorization: 'Bearer' } };
    await expect(guard.canActivate(httpContext(request))).rejects.toBeInstanceOf(AuthError);
    expect(request.actor).toBeUndefined();
  });

  it('a syntactically valid but unverifiable token is 401', async () => {
    const request: Req = { headers: { authorization: 'Bearer aaa.bbb.ccc' } };
    await expect(guard.canActivate(httpContext(request))).rejects.toMatchObject({
      code: AuthErrorCode.UNAUTHENTICATED,
    });
    expect(request.actor).toBeUndefined();
  });

  it('a verified token attaches the actor, the account and the session -- and nothing else', async () => {
    const pair = await auth.login('parent-guard', PASSWORD);
    const request: Req = { headers: { authorization: `Bearer ${pair.accessToken}` } };

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);

    expect(request.actor).toMatchObject({ actorId: pair.actor.actorId, kind: 'contact' });
    expect(request.sessionId).toBe(pair.sessionId);
    expect(request.accountId).toBeTruthy();
  });

  it('a revoked session is refused on the next request through the guard', async () => {
    const pair = await auth.login('parent-guard', PASSWORD);
    const request: Req = { headers: { authorization: `Bearer ${pair.accessToken}` } };
    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);

    await auth.logout(pair.sessionId);

    const after: Req = { headers: { authorization: `Bearer ${pair.accessToken}` } };
    await expect(guard.canActivate(httpContext(after))).rejects.toMatchObject({
      code: AuthErrorCode.UNAUTHENTICATED,
    });
    expect(after.actor).toBeUndefined();
  });

  it('a @Public() route is allowed through with no token and no actor', async () => {
    const handler = () => {};
    Reflect.defineMetadata(PUBLIC_ROUTE, true, handler);

    const request: Req = { headers: {} };
    await expect(guard.canActivate(httpContext(request, handler))).resolves.toBe(true);
    // Public does not mean "identified": nothing is attached.
    expect(request.actor).toBeUndefined();
  });

  it('protects by default -- a route that declares nothing is still guarded', async () => {
    // This is the property that fixes API-CONTRACT §5 S-2 (three routes with no
    // actor check at all) without those routes being touched.
    await expect(guard.canActivate(httpContext({ headers: {} }))).rejects.toBeInstanceOf(AuthError);
  });

  it('updates last-seen on the session without blocking the request', async () => {
    const pair = await auth.login('parent-guard', PASSWORD);
    db.sessions[0].lastSeenAt = null;

    await guard.canActivate(httpContext({ headers: { authorization: `Bearer ${pair.accessToken}` } }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(db.sessions[0].lastSeenAt).toBeInstanceOf(Date);
  });
});
