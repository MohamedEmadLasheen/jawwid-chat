/**
 * GET /me (API-CONTRACT §3.2) and the DTO boundary.
 *
 * Two properties: the identity is the authenticated one and nothing else, and
 * the body carries no private data. The second is asserted by enumerating the
 * whole key set, because a leak arrives as a field somebody added upstream --
 * not as a field somebody wrote into this file.
 */
import { MeController, AuthController } from '@platform/auth/auth.controller';
import { AuthError, AuthErrorCode } from '@platform/auth/auth.errors';
import { NO_PERMISSIONS, toActorDto, toTokenPairDto } from '@platform/auth/auth.dto';
import { NO_ACCESS, type AccessProfile, type PermissionService } from '@platform/permissions/permission.service';
import type { AuthService } from '@platform/auth/auth.service';
import type { Actor } from '@platform/types';
import { LoginRateLimiter } from '@platform/auth/login-rate-limit';
import {
  buildAuth,
  contactActor,
  FakeDb,
  FakeIdentity,
  FakeRateLimitStore,
  ORG_A,
  staffActor,
  teacherActor,
  withAuthEnv,
} from './support/fake-db';

jest.setTimeout(60_000);

const PASSWORD = 'a-correct-password-1';

const EXPECTED_KEYS = [
  'actorId',
  'kind',
  'displayName',
  'locale',
  'isActive',
  'staffRole',
  'familyId',
  'canMessage',
  'organizationId',
  'permissions',
].sort();

describe('GET /me', () => {
  /** PD-40: the profile chat.staff_access_profile would answer -- staff hold keys, nobody else does. */
  const access = {
    profileOf: async (actor: Actor): Promise<AccessProfile> =>
      actor.kind === 'staff'
        ? { tier: 'manager', departmentKind: 'operations', placement: 'manager', permissions: new Set(['org.view', 'chat.use']) }
        : NO_ACCESS,
  } as unknown as PermissionService;
  const controller = new MeController(access);

  it('returns the actor the guard attached, and nothing else decides it', async () => {
    const actor = contactActor({ displayName: 'أم أحمد', familyId: 'family-7' });
    const dto = await controller.me({ headers: {}, actor });

    expect(dto.actorId).toBe(actor.actorId);
    expect(dto.kind).toBe('contact');
    expect(dto.displayName).toBe('أم أحمد');
    expect(dto.familyId).toBe('family-7');
    expect(dto.organizationId).toBe(ORG_A);
  });

  it('is 401 when no actor was attached -- never an anonymous default', async () => {
    await expect(controller.me({ headers: {} })).rejects.toThrow(AuthError);
    try {
      await controller.me({ headers: {} });
    } catch (e) {
      expect((e as AuthError).code).toBe(AuthErrorCode.UNAUTHENTICATED);
    }
  });

  it('a staff actor carries its server-asserted role; the client never infers one', async () => {
    const dto = await controller.me({ headers: {}, actor: staffActor({ staffRole: 'manager' }) });
    expect(dto.staffRole).toBe('manager');
    expect(dto.familyId).toBeNull();
    expect(dto.canMessage).toBeNull();
  });

  it('a teacher carries no staffRole -- a teacher is not a staff role', async () => {
    const dto = await controller.me({ headers: {}, actor: teacherActor() });
    expect(dto.kind).toBe('teacher');
    expect(dto.staffRole).toBeNull();
  });

  it('PD-40: a staff member gets the keys chat.staff_access_profile answers, sorted; a parent gets none', async () => {
    const dto = await controller.me({ headers: {}, actor: staffActor({ staffRole: 'manager' }) });
    expect(dto.permissions).toEqual(['chat.use', 'org.view']);
    expect((await controller.me({ headers: {}, actor: contactActor() })).permissions).toEqual([]);
    expect((await controller.me({ headers: {}, actor: teacherActor() })).permissions).toEqual([]);
  });

  it('the default permissions array is frozen, so a caller cannot grow it in place', () => {
    expect(NO_PERMISSIONS).toEqual([]);
    expect(Object.isFrozen(NO_PERMISSIONS)).toBe(true);
  });
});

describe('the DTO boundary carries no private data', () => {
  it('publishes exactly the documented keys, and no more', () => {
    expect(Object.keys(toActorDto(contactActor())).sort()).toEqual(EXPECTED_KEYS);
    expect(Object.keys(toActorDto(staffActor())).sort()).toEqual(EXPECTED_KEYS);
  });

  it('a field added to Actor upstream does NOT reach the client', () => {
    // The mapper is explicitly constructed, never spread. This is the test that
    // makes that guarantee real rather than a comment.
    const contaminated = {
      ...contactActor(),
      phone: '+201234567890',
      email: 'parent@example.com',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$abc$def',
      refreshTokenHash: 'c2VjcmV0',
      contactFile: { phones: ['+20100'], emails: ['a@b.c'] },
    } as unknown as Actor;

    const dto = toActorDto(contaminated);
    const serialised = JSON.stringify(dto);

    expect(Object.keys(dto).sort()).toEqual(EXPECTED_KEYS);
    for (const secret of ['phone', 'email', 'passwordHash', 'refreshTokenHash', 'contactFile']) {
      expect(dto).not.toHaveProperty(secret);
    }
    expect(serialised).not.toContain('+201234567890');
    expect(serialised).not.toContain('parent@example.com');
    expect(serialised).not.toContain('argon2id');
  });

  it('the token pair exposes the session id, created-at and its PD-23 lifetime, never the hash', () => {
    const dto = toTokenPairDto({
      accessToken: 'a.b.c',
      refreshToken: 'opaque-refresh',
      expiresInSeconds: 900,
      sessionId: 'session-1',
      sessionCreatedAt: new Date('2026-09-11T00:00:00.000Z'),
      actor: contactActor(),
      remembered: false,
      expiresAt: new Date('2026-10-11T00:00:00.000Z'),
      absoluteExpiresAt: null,
    });

    expect(dto.tokenType).toBe('Bearer');
    expect(dto.expiresIn).toBe(900);
    expect(Object.keys(dto.session).sort()).toEqual(['absoluteExpiresAt', 'createdAt', 'expiresAt', 'id', 'remembered']);
    expect(dto.session.expiresAt).toBe('2026-10-11T00:00:00.000Z');
    expect(dto.session.absoluteExpiresAt).toBeNull();
    expect(dto.session.createdAt).toBe('2026-09-11T00:00:00.000Z');
    expect(Object.keys(dto).sort()).toEqual(
      ['accessToken', 'actor', 'expiresIn', 'refreshToken', 'session', 'tokenType'].sort(),
    );
    expect(JSON.stringify(dto)).not.toContain('refreshTokenHash');
  });
});

describe('the login response', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;
  let controller: AuthController;

  beforeEach(async () => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
    controller = new AuthController(auth, new LoginRateLimiter(new FakeRateLimitStore()));
    const account = await db.addAccount({ subject: 'parent-dto' }, PASSWORD);
    identity.give(account.id, contactActor());
  });

  it('returns a TokenPairDto whose body contains no credential material', async () => {
    const dto = await controller.login({ username: 'parent-dto', password: PASSWORD });
    const serialised = JSON.stringify(dto);

    expect(dto.tokenType).toBe('Bearer');
    expect(dto.actor.permissions).toEqual([]);
    expect(serialised).not.toContain(PASSWORD);
    expect(serialised).not.toContain('$argon2id$');
    expect(serialised).not.toContain(db.sessions[0].refreshTokenHash);
  });

  it('a malformed body is a 401 login failure, not a 400 that fingerprints the parser', async () => {
    for (const body of [{}, { username: 'x' }, { password: 'y' }, { username: 123, password: [] }]) {
      await expect(controller.login(body as never)).rejects.toMatchObject({
        code: AuthErrorCode.INVALID_CREDENTIALS,
      });
    }
  });

  it('logout ends the caller\'s own session, identified by the token, not the body', async () => {
    const pair = await auth.login('parent-dto', PASSWORD);
    const other = await auth.login('parent-dto', PASSWORD, { device: { platform: 'web' } });

    await controller.logout({ headers: {}, sessionId: pair.sessionId });

    expect(db.sessions.find((s) => s.id === pair.sessionId)!.revokedReason).toBe('logout');
    expect(db.sessions.find((s) => s.id === other.sessionId)!.revokedAt).toBeNull();
  });

  it('logout without a session still answers {ok:true}', async () => {
    await expect(controller.logout({ headers: {} })).resolves.toEqual({ ok: true });
  });
});
