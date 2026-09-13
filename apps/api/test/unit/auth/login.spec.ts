/**
 * POST /auth/login (API-CONTRACT §3.1).
 *
 * The positive path is one test. The rest are the refusals, because a login
 * endpoint is defined by what it will not do.
 */
import { AuthErrorCode } from '@platform/auth/auth.errors';
import type { AuthService } from '@platform/auth/auth.service';
import {
  buildAuth,
  contactActor,
  FakeDb,
  FakeIdentity,
  ORG_A,
  staffActor,
  teacherActor,
  withAuthEnv,
} from './support/fake-db';

jest.setTimeout(60_000);

const PASSWORD = 'a-correct-password-1';

async function expectCode(promise: Promise<unknown>, code: AuthErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('login', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;

  beforeEach(() => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
  });

  it('valid credentials issue a token pair bound to a new session', async () => {
    const account = await db.addAccount({ subject: 'parent-0001' }, PASSWORD);
    const actor = identity.give(account.id, contactActor());

    const pair = await auth.login('parent-0001', PASSWORD);

    expect(pair.accessToken.split('.')).toHaveLength(3);
    expect(pair.refreshToken).toBeTruthy();
    expect(pair.expiresInSeconds).toBe(900);
    expect(pair.actor.actorId).toBe(actor.actorId);

    expect(db.sessions).toHaveLength(1);
    expect(db.sessions[0]).toMatchObject({ accountId: account.id, revokedAt: null });
    // The refresh token is stored hashed, never in the clear.
    expect(db.sessions[0].refreshTokenHash).not.toBe(pair.refreshToken);
  });

  it('records the login on the account, which is what lastLoginAt is for', async () => {
    const account = await db.addAccount({ subject: 'parent-0002' }, PASSWORD);
    identity.give(account.id, contactActor());

    expect(db.accounts[0].lastLoginAt).toBeNull();
    await auth.login('parent-0002', PASSWORD);
    expect(db.accounts[0].lastLoginAt).toBeInstanceOf(Date);
  });

  it('the wrong password is refused, and the password is never echoed back', async () => {
    const account = await db.addAccount({ subject: 'parent-0003' }, PASSWORD);
    identity.give(account.id, contactActor());

    await expectCode(auth.login('parent-0003', 'wrong-password'), AuthErrorCode.INVALID_CREDENTIALS);
    await auth.login('parent-0003', 'wrong-password').catch((e: Error) => {
      expect(e.message).not.toContain('wrong-password');
      expect(e.message).not.toContain('parent-0003');
    });
    expect(db.sessions).toHaveLength(0);
  });

  it('an unknown subject fails with the SAME code and message as a wrong password', async () => {
    const account = await db.addAccount({ subject: 'parent-0004' }, PASSWORD);
    identity.give(account.id, contactActor());

    const unknown = await auth.login('nobody-at-all', PASSWORD).catch((e: Error) => e);
    const wrong = await auth.login('parent-0004', 'nope').catch((e: Error) => e);

    // Identical, because any difference enumerates accounts.
    expect((unknown as unknown as { code: string }).code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
    expect((wrong as unknown as { code: string }).code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
    expect((unknown as unknown as Error).message).toBe((wrong as unknown as Error).message);
  });

  it('an account with no credential row cannot log in -- that is "provisioned"', async () => {
    const account = await db.addAccount({ subject: 'teacher-0001', kind: 'teacher', status: 'provisioned', isActive: false });
    identity.give(account.id, teacherActor());

    await expectCode(auth.login('teacher-0001', PASSWORD), AuthErrorCode.INVALID_CREDENTIALS);
  });

  it('an empty username or password is refused without touching the database', async () => {
    await expectCode(auth.login('', PASSWORD), AuthErrorCode.INVALID_CREDENTIALS);
    await expectCode(auth.login('   ', PASSWORD), AuthErrorCode.INVALID_CREDENTIALS);
    expect(db.sessions).toHaveLength(0);
  });
});

describe('accounts that may not hold a session', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;

  beforeEach(() => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
  });

  it.each([
    ['suspended', 'suspended'],
    ['deactivated', 'deactivated'],
    ['provisioned', 'provisioned'],
  ])('a %s account is refused with ACCOUNT_DISABLED even with the right password', async (_label, status) => {
    const account = await db.addAccount({ subject: `staff-${status}`, kind: 'staff', status, isActive: false }, PASSWORD);
    identity.give(account.id, staffActor());

    await expectCode(auth.login(`staff-${status}`, PASSWORD), AuthErrorCode.ACCOUNT_DISABLED);
    expect(db.sessions).toHaveLength(0);
  });

  it('an inactive TEACHER cannot log in even though the account is active', async () => {
    // IDENTITY-MODEL §8.5: a teacher actor is resolvable only from chat.teacher
    // with is_active = true. Offboarding sets the teacher row, and that alone
    // must end the ability to authenticate.
    const account = await db.addAccount({ subject: 'teacher-left', kind: 'teacher' }, PASSWORD);
    identity.give(account.id, teacherActor({ isActive: false }));

    await expectCode(auth.login('teacher-left', PASSWORD), AuthErrorCode.ACCOUNT_DISABLED);
    expect(db.sessions).toHaveLength(0);
  });

  it('an account whose principal does not exist cannot log in', async () => {
    // A credential with no staff/contact/teacher row is a provisioning defect.
    // It must not produce a session with an unresolvable actor.
    await db.addAccount({ subject: 'orphan', kind: 'staff' }, PASSWORD);
    await expectCode(auth.login('orphan', PASSWORD), AuthErrorCode.ACCOUNT_DISABLED);
    expect(db.sessions).toHaveLength(0);
  });

  it('an account whose kind disagrees with its principal cannot log in', async () => {
    // account.kind decides which principal table is consulted, so a
    // family-kind account linked to a staff principal resolves to nothing.
    const account = await db.addAccount({ subject: 'mismatched', kind: 'family' }, PASSWORD);
    identity.give(account.id, staffActor());

    await expectCode(auth.login('mismatched', PASSWORD), AuthErrorCode.ACCOUNT_DISABLED);
  });
});

describe('lockout', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;

  beforeEach(() => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
  });

  it('counts failures on the credential row, not in a cache that can restart', async () => {
    const account = await db.addAccount({ subject: 'parent-lock', organizationId: ORG_A }, PASSWORD);
    identity.give(account.id, contactActor());

    await expectCode(auth.login('parent-lock', 'no'), AuthErrorCode.INVALID_CREDENTIALS);
    expect(db.credentialFor(account.id).failedAttempts).toBe(1);

    await expectCode(auth.login('parent-lock', 'no'), AuthErrorCode.INVALID_CREDENTIALS);
    expect(db.credentialFor(account.id).failedAttempts).toBe(2);
    expect(db.credentialFor(account.id).lockedUntil).toBeNull();
  });

  it('locks the account after ten failures, and then refuses even the RIGHT password', async () => {
    const account = await db.addAccount({ subject: 'parent-brute' }, PASSWORD);
    identity.give(account.id, contactActor());

    for (let i = 0; i < 10; i++) {
      await expectCode(auth.login('parent-brute', `guess-${i}`), AuthErrorCode.INVALID_CREDENTIALS);
    }

    const credential = db.credentialFor(account.id);
    expect(credential.failedAttempts).toBe(10);
    expect(credential.lockedUntil).toBeInstanceOf(Date);
    expect(credential.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // The lock is the point: a correct password during the lockout is still refused.
    await expectCode(auth.login('parent-brute', PASSWORD), AuthErrorCode.ACCOUNT_LOCKED);
    expect(db.sessions).toHaveLength(0);
  });

  it('a locked account is not a free password oracle', async () => {
    const account = await db.addAccount({ subject: 'parent-locked' }, PASSWORD);
    identity.give(account.id, contactActor());
    db.credentialFor(account.id).lockedUntil = new Date(Date.now() + 60_000);
    db.credentialFor(account.id).failedAttempts = 10;

    // Both a right and a wrong password get ACCOUNT_LOCKED, so the lockout
    // cannot be used to test candidate passwords for free.
    await expectCode(auth.login('parent-locked', PASSWORD), AuthErrorCode.ACCOUNT_LOCKED);
    await expectCode(auth.login('parent-locked', 'wrong'), AuthErrorCode.ACCOUNT_LOCKED);
    // and the counter is not pushed further by an attacker who is already locked
    expect(db.credentialFor(account.id).failedAttempts).toBe(10);
  });

  it('an expired lock lets a correct password through again', async () => {
    const account = await db.addAccount({ subject: 'parent-unlocked' }, PASSWORD);
    identity.give(account.id, contactActor());
    db.credentialFor(account.id).lockedUntil = new Date(Date.now() - 1000);
    db.credentialFor(account.id).failedAttempts = 10;

    await expect(auth.login('parent-unlocked', PASSWORD)).resolves.toBeTruthy();
  });

  it('a successful login clears the failure counter', async () => {
    const account = await db.addAccount({ subject: 'parent-recover' }, PASSWORD);
    identity.give(account.id, contactActor());

    await expectCode(auth.login('parent-recover', 'no'), AuthErrorCode.INVALID_CREDENTIALS);
    await auth.login('parent-recover', PASSWORD);

    expect(db.credentialFor(account.id).failedAttempts).toBe(0);
    expect(db.credentialFor(account.id).lockedUntil).toBeNull();
  });
});

describe('device binding', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;

  beforeEach(() => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
  });

  it('records the device and binds the session to it', async () => {
    const account = await db.addAccount({ subject: 'parent-device' }, PASSWORD);
    identity.give(account.id, contactActor());

    await auth.login('parent-device', PASSWORD, { device: { platform: 'ios', name: 'iPhone' } });

    expect(db.devices).toHaveLength(1);
    expect(db.devices[0]).toMatchObject({ platform: 'ios', name: 'iPhone' });
    expect(db.sessions[0].deviceId).toBe(db.devices[0].id);
  });

  it('a returning device reuses its row instead of accumulating one per login', async () => {
    const account = await db.addAccount({ subject: 'parent-return' }, PASSWORD);
    identity.give(account.id, contactActor());

    await auth.login('parent-return', PASSWORD, { device: { platform: 'ios', name: 'iPhone' } });
    await auth.login('parent-return', PASSWORD, { device: { platform: 'ios', name: 'iPhone' } });

    expect(db.devices).toHaveLength(1);
    expect(db.sessions).toHaveLength(2);
    expect(db.sessions[0].deviceId).toBe(db.sessions[1].deviceId);
  });

  it('a different device gets its own row, so multi-device sign-in is real', async () => {
    const account = await db.addAccount({ subject: 'parent-multi' }, PASSWORD);
    identity.give(account.id, contactActor());

    await auth.login('parent-multi', PASSWORD, { device: { platform: 'ios', name: 'iPhone' } });
    await auth.login('parent-multi', PASSWORD, { device: { platform: 'android', name: 'Tablet' } });

    expect(db.devices).toHaveLength(2);
    expect(db.sessions[0].deviceId).not.toBe(db.sessions[1].deviceId);
    // Both sessions stay live: signing in on a second device must not end the first.
    expect(db.sessions.every((s) => s.revokedAt === null)).toBe(true);
  });

  it('refuses an unknown platform rather than storing it', async () => {
    const account = await db.addAccount({ subject: 'parent-bogus' }, PASSWORD);
    identity.give(account.id, contactActor());

    await auth.login('parent-bogus', PASSWORD, { device: { platform: 'nintendo-switch' } });

    expect(db.devices).toHaveLength(0);
    expect(db.sessions[0].deviceId).toBeNull();
  });

  it('never stores a raw IP -- only a hash (IDENTITY-MODEL §6)', async () => {
    const account = await db.addAccount({ subject: 'parent-ip' }, PASSWORD);
    identity.give(account.id, contactActor());

    await auth.login('parent-ip', PASSWORD, { ip: '203.0.113.7' });

    expect(db.sessions[0].ipHash).toBeTruthy();
    expect(db.sessions[0].ipHash).not.toContain('203.0.113.7');
  });
});
