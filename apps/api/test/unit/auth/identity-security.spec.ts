/**
 * AUTH-INV-1: actor identity derives EXCLUSIVELY from the verified
 * authenticated principal. No `x-actor-id` header, no `actorId` in a body,
 * query parameter or cookie may influence actor selection.
 *
 * This is the suite that closes RT-001 / NF-08 on the HTTP path. Each test is
 * an impersonation attempt that used to succeed.
 */
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedGuard } from '@platform/auth/auth.guard';
import { AuthError, AuthErrorCode } from '@platform/auth/auth.errors';
import { ActorId, CurrentActor } from '@communication/api/actor.decorator';
import { HEADER_IDENTITY_SEAM } from '@platform/identity-seam';
import { loadAuthConfig } from '@platform/auth/auth.config';
import { signAccessToken } from '@platform/auth/jwt';
import type { AuthService } from '@platform/auth/auth.service';
import {
  buildAuth,
  contactActor,
  FakeDb,
  FakeIdentity,
  ORG_A,
  ORG_B,
  staffActor,
  teacherActor,
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
  withAuthEnv,
} from './support/fake-db';

jest.setTimeout(60_000);

const PASSWORD = 'a-correct-password-1';

interface Req {
  headers: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  actor?: unknown;
  sessionId?: string;
}

function httpContext(request: Req): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/**
 * Invokes a param decorator the way Nest does.
 *
 * `createParamDecorator` returns a factory; applying the decorator stores the
 * implementation in ROUTE_ARGS_METADATA on the class. Applying it by hand (no
 * decorator syntax) reaches the REAL implementation, so these tests exercise
 * the shipped decorator rather than a reimplementation of it.
 */
function callParamDecorator<T>(
  decorator: () => ParameterDecorator,
  ctx: ExecutionContext,
): T {
  class Probe {
    handler(_value: unknown): void {
      void _value;
    }
  }
  decorator()(Probe.prototype, 'handler', 0);

  const factories = Reflect.getMetadata('__routeArguments__', Probe, 'handler') as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => T }
  >;
  return Object.values(factories)[0].factory(undefined, ctx);
}

describe('x-actor-id cannot control identity', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;
  let guard: AuthenticatedGuard;
  let victimActorId: string;

  beforeEach(async () => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
    guard = new AuthenticatedGuard(auth, new Reflector());

    const attacker = await db.addAccount({ subject: 'parent-attacker' }, PASSWORD);
    identity.give(attacker.id, contactActor({ displayName: 'attacker' }));

    const victim = await db.addAccount({ subject: 'manager-victim', kind: 'staff' }, PASSWORD);
    victimActorId = identity.give(victim.id, staffActor({ displayName: 'victim' })).actorId;
  });

  it('the header alone authenticates nothing -- it is a 401, exactly as if absent', async () => {
    const withHeader: Req = { headers: { [HEADER_IDENTITY_SEAM]: victimActorId } };
    const withoutHeader: Req = { headers: {} };

    const a = await guard.canActivate(httpContext(withHeader)).catch((e: AuthError) => e);
    const b = await guard.canActivate(httpContext(withoutHeader)).catch((e: AuthError) => e);

    expect(a).toBeInstanceOf(AuthError);
    expect((a as AuthError).code).toBe(AuthErrorCode.UNAUTHENTICATED);
    // Identical treatment: the header is not even an input.
    expect((a as AuthError).code).toBe((b as AuthError).code);
    expect(withHeader.actor).toBeUndefined();
  });

  it('a valid token PLUS a forged header still resolves the token holder', async () => {
    const pair = await auth.login('parent-attacker', PASSWORD);
    const request: Req = {
      headers: {
        authorization: `Bearer ${pair.accessToken}`,
        [HEADER_IDENTITY_SEAM]: victimActorId,
      },
    };

    await guard.canActivate(httpContext(request));

    expect((request.actor as { actorId: string }).actorId).toBe(pair.actor.actorId);
    expect((request.actor as { actorId: string }).actorId).not.toBe(victimActorId);
    expect((request.actor as { kind: string }).kind).toBe('contact');
  });

  it('@ActorId() reads the verified actor, never the header', async () => {
    const pair = await auth.login('parent-attacker', PASSWORD);
    const request: Req = {
      headers: {
        authorization: `Bearer ${pair.accessToken}`,
        [HEADER_IDENTITY_SEAM]: victimActorId,
      },
    };
    await guard.canActivate(httpContext(request));

    expect(callParamDecorator<string>(ActorId, httpContext(request))).toBe(pair.actor.actorId);
  });

  it('@ActorId() fails closed with 401 when no actor was attached', async () => {
    // Reaching this means a route was marked @Public() and then asked for an
    // actor anyway. It must be a 401, not an empty string a service would turn
    // into a confusing 500 (AUTH-INV-2).
    const request: Req = { headers: { [HEADER_IDENTITY_SEAM]: victimActorId } };
    expect(() => callParamDecorator<string>(ActorId, httpContext(request))).toThrow(AuthError);
    expect(() => callParamDecorator(CurrentActor, httpContext(request))).toThrow(AuthError);
  });

  it('an actorId in the body or the query changes nothing', async () => {
    const pair = await auth.login('parent-attacker', PASSWORD);
    const request: Req = {
      headers: { authorization: `Bearer ${pair.accessToken}` },
      body: { actorId: victimActorId, authorId: victimActorId },
      query: { actorId: victimActorId },
    };
    await guard.canActivate(httpContext(request));

    expect(callParamDecorator<string>(ActorId, httpContext(request))).toBe(pair.actor.actorId);
  });

  it('no HTTP source file reads the header any more', () => {
    // A structural check, not a behavioural one: the decorator is the only
    // place it was ever read, and this catches a reintroduction that happens to
    // keep the tests above green.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const source = readFileSync(
      require.resolve('../../../src/communication/api/actor.decorator.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/headers\s*\[\s*['"]x-actor-id['"]/);
    expect(source).toMatch(/request\.actor/);
  });
});

describe('impersonation across principals', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;

  beforeEach(() => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
  });

  it('a parent cannot become another parent by editing the token claims', async () => {
    const mine = await db.addAccount({ subject: 'parent-mine' }, PASSWORD);
    const myActor = identity.give(mine.id, contactActor());
    const theirs = await db.addAccount({ subject: 'parent-theirs' }, PASSWORD);
    const theirActor = identity.give(theirs.id, contactActor());

    const pair = await auth.login('parent-mine', PASSWORD);
    const config = loadAuthConfig({
      JWT_ACCESS_SECRET: TEST_ACCESS_SECRET,
      JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
    });

    // The attacker holds a real session and re-signs with the real key -- the
    // only thing they change is who the token says they act as. This is the
    // strongest form of the attack short of stealing the signing key.
    const forged = signAccessToken(
      { sub: 'parent-mine', sid: pair.sessionId, act: theirActor.actorId, knd: 'contact', org: ORG_A },
      config,
    );

    // The database decides the principal from the ACCOUNT; the claim is only
    // cross-checked. They disagree, so the token is refused outright.
    expect(await auth.authenticate(forged)).toBeNull();
    // and the honest token still resolves to the attacker's own identity
    expect((await auth.authenticate(pair.accessToken))!.actor.actorId).toBe(myActor.actorId);
  });

  it('a teacher cannot become a manager by claiming a staff kind', async () => {
    const account = await db.addAccount({ subject: 'teacher-climber', kind: 'teacher' }, PASSWORD);
    const actor = identity.give(account.id, teacherActor());
    const pair = await auth.login('teacher-climber', PASSWORD);

    const config = loadAuthConfig({
      JWT_ACCESS_SECRET: TEST_ACCESS_SECRET,
      JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
    });
    const forged = signAccessToken(
      { sub: 'teacher-climber', sid: pair.sessionId, act: actor.actorId, knd: 'staff', org: ORG_A },
      config,
    );

    expect(await auth.authenticate(forged)).toBeNull();
    // The honest token carries the kind the database says, and no staffRole.
    const honest = await auth.authenticate(pair.accessToken);
    expect(honest!.actor.kind).toBe('teacher');
    expect(honest!.actor.staffRole).toBeUndefined();
  });

  it('a session id belonging to another account does not transfer identity', async () => {
    const mine = await db.addAccount({ subject: 'parent-a' }, PASSWORD);
    identity.give(mine.id, contactActor());
    const theirs = await db.addAccount({ subject: 'parent-b' }, PASSWORD);
    const theirActor = identity.give(theirs.id, contactActor());

    await auth.login('parent-a', PASSWORD);
    const victimPair = await auth.login('parent-b', PASSWORD);

    const config = loadAuthConfig({
      JWT_ACCESS_SECRET: TEST_ACCESS_SECRET,
      JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
    });
    // My subject, their session. The session must belong to the account the
    // token names, or a stolen session id would be enough.
    const spliced = signAccessToken(
      { sub: 'parent-a', sid: victimPair.sessionId, act: theirActor.actorId, knd: 'contact', org: ORG_A },
      config,
    );

    expect(await auth.authenticate(spliced)).toBeNull();
  });

  it('cross-family: the family on the actor comes from the contact row, not the token', async () => {
    const account = await db.addAccount({ subject: 'parent-family' }, PASSWORD);
    const actor = identity.give(account.id, contactActor({ familyId: 'family-mine' }));
    const pair = await auth.login('parent-family', PASSWORD);

    const authenticated = await auth.authenticate(pair.accessToken);

    expect(authenticated!.actor.familyId).toBe('family-mine');
    expect(actor.familyId).toBe('family-mine');
    // There is no claim a client could set to change it: familyId is not in the
    // token at all, so downstream scope checks cannot be steered from outside.
    expect(Object.keys(authenticated!.claims)).not.toContain('familyId');
    expect(Object.keys(authenticated!.claims)).not.toContain('fam');
  });

  it('cross-organization: a re-signed org claim cannot move the actor to another tenant', async () => {
    const account = await db.addAccount({ subject: 'parent-org-a', organizationId: ORG_A }, PASSWORD);
    const actor = identity.give(account.id, contactActor({ organizationId: ORG_A }));
    const pair = await auth.login('parent-org-a', PASSWORD);

    const config = loadAuthConfig({
      JWT_ACCESS_SECRET: TEST_ACCESS_SECRET,
      JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
    });
    const forged = signAccessToken(
      { sub: 'parent-org-a', sid: pair.sessionId, act: actor.actorId, knd: 'contact', org: ORG_B },
      config,
    );

    // The claim verifies, but the Actor handed downstream is rebuilt from the
    // principal row, so the organization the rest of the system sees is A.
    const authenticated = await auth.authenticate(forged);
    expect(authenticated).not.toBeNull();
    expect(authenticated!.actor.organizationId).toBe(ORG_A);
    expect(authenticated!.actor.organizationId).not.toBe(ORG_B);
  });
});
