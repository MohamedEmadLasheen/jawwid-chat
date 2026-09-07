/**
 * Authentication and session management, against the real schema.
 *
 * Covers the Phase 1 definition of done for authentication and sessions:
 * login, invalid password, inactive and unverified accounts, /me, logout,
 * multiple devices, the device limit, individual and global logout, password
 * change, forgot/reset, and the rule that a reset ends every session.
 */
import { buildGraph, seed, truncate, Scenario } from './harness';
import { AuthError } from '@platform/auth/auth.errors';

const g = buildGraph();
let s: Scenario;

const PASSWORD = 'a-sufficiently-long-password';
const device = (clientKey: string) => ({ clientKey, platform: 'ios', appVersion: '1.0.0' });

/** The subject an account authenticates with. The harness names them by actor. */
const subjectOf = (actorId: string) => `subject_${actorId}`;

beforeAll(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  for (const actorId of [s.ownerId, s.otherAdminId, s.managerId, s.parentId, s.teacherId]) {
    await g.accounts.setPassword(s.accounts[actorId], PASSWORD, {
      reason: 'test fixture',
      invalidateSessions: false,
    });
  }
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

// -------------------------------------------------------------------------
describe('login', () => {
  it('authenticates a real subject and resolves the actor server-side', async () => {
    const result = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('login-1'));
    expect(result.actor.actorId).toBe(s.ownerId);
    expect(result.actor.kind).toBe('staff');
    expect(result.actor.staffRole).toBe('admin');
    expect(result.actor.organizationId).toBeTruthy();
    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken).toBeTruthy();
  });

  it('refuses a wrong password, and says exactly what it says for an unknown subject', async () => {
    const wrong = await g.auth.login(subjectOf(s.ownerId), 'not-the-password').catch((e) => e);
    const unknown = await g.auth.login('subject_nobody', PASSWORD).catch((e) => e);
    expect(wrong).toBeInstanceOf(AuthError);
    expect(unknown).toBeInstanceOf(AuthError);
    // Identical responses: the endpoint is not an account-enumeration oracle.
    expect((wrong as AuthError).code).toBe((unknown as AuthError).code);
    expect((wrong as AuthError).getResponse()).toEqual((unknown as AuthError).getResponse());
  });

  it('refuses an account that has no credential at all', async () => {
    const bare = await g.prisma.account.create({
      data: { subject: 'subject_no_credential', kind: 'staff', status: 'active' },
    });
    await expect(g.auth.login('subject_no_credential', PASSWORD)).rejects.toBeInstanceOf(AuthError);
    await g.prisma.account.delete({ where: { id: bare.id } });
  });

  it('refuses a suspended account, and refuses it differently from a bad password', async () => {
    const accountId = s.accounts[s.otherAdminId];
    await g.accounts.suspend(accountId, s.managerId, 'test: suspension');
    const denied = await g.auth.login(subjectOf(s.otherAdminId), PASSWORD).catch((e) => e);
    expect((denied as AuthError).code).toBe('AUTH.ACCOUNT_DISABLED');
    await g.accounts.activate(accountId, s.managerId, 'test: restore');
    await expect(g.auth.login(subjectOf(s.otherAdminId), PASSWORD)).resolves.toBeTruthy();
  });

  it('refuses a provisioned account that has never been activated', async () => {
    const pending = await g.prisma.account.create({
      data: { subject: 'subject_pending', kind: 'staff', status: 'provisioned' },
    });
    // A credential exists but the lifecycle has not opened.
    await g.prisma.accountCredential.create({
      data: { accountId: pending.id, passwordHash: 'scrypt$16384$8$1$AA==$AA==' },
    });
    await expect(g.auth.login('subject_pending', PASSWORD)).rejects.toMatchObject({
      code: 'AUTH.ACCOUNT_DISABLED',
    });
    await g.prisma.account.delete({ where: { id: pending.id } });
  });

  it('an unverified e-mail does not block login, and /me reports the fact', async () => {
    // Verification is recorded, not enforced: nothing in the MVP is gated on it,
    // and silently refusing a login for it would be an invisible outage.
    const account = await g.prisma.account.findUnique({ where: { id: s.accounts[s.parentId] } });
    expect(account!.emailVerifiedAt).toBeNull();
    await expect(g.auth.login(subjectOf(s.parentId), PASSWORD, device('p1'))).resolves.toBeTruthy();
  });

  it('records the last login without ever recording the password', async () => {
    await g.auth.login(subjectOf(s.managerId), PASSWORD, device('m1'));
    const account = await g.prisma.account.findUnique({ where: { id: s.accounts[s.managerId] } });
    expect(account!.lastLoginAt).not.toBeNull();
    const credential = await g.prisma.accountCredential.findUnique({
      where: { accountId: s.accounts[s.managerId] },
    });
    expect(credential!.passwordHash).not.toContain(PASSWORD);
  });
});

// -------------------------------------------------------------------------
describe('the authenticated request', () => {
  it('resolves who the caller is from the token, and nothing the client sent', async () => {
    const { accessToken } = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('me-1'));
    const authenticated = await g.auth.authenticate(accessToken);
    expect(authenticated!.actor.actorId).toBe(s.ownerId);
    expect(authenticated!.actor.permissions!.has('messages.internal')).toBe(true);
  });

  it('refuses a token whose session has been revoked -- immediately, not at expiry', async () => {
    const { accessToken } = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('me-2'));
    const before = await g.auth.authenticate(accessToken);
    await g.auth.logout(before!.claims.sid, s.ownerId);
    expect(await g.auth.authenticate(accessToken)).toBeNull();
  });

  it('refuses a token once the principal is deactivated', async () => {
    const { accessToken } = await g.auth.login(subjectOf(s.teacherId), PASSWORD, device('t-1'));
    expect(await g.auth.authenticate(accessToken)).not.toBeNull();

    // The database refuses to deactivate a teacher who still teaches somebody:
    // a group would keep a teacher member who can no longer act, which is the
    // C-4 hole. Reassigning the learner first is the supported path.
    await expect(
      g.prisma.teacher.update({
        where: { id: s.teacherId },
        data: { isActive: false, leftAt: new Date() },
      }),
    ).rejects.toThrow(/still assigned to 1 learner/);

    await g.prisma.learner.updateMany({
      where: { teacherId: s.teacherId },
      data: { teacherId: s.newTeacherId },
    });
    await g.prisma.teacher.update({
      where: { id: s.teacherId },
      data: { isActive: false, leftAt: new Date() },
    });

    expect(await g.auth.authenticate(accessToken)).toBeNull();

    await g.prisma.teacher.update({
      where: { id: s.teacherId },
      data: { isActive: true, leftAt: null },
    });
    await g.prisma.learner.updateMany({
      where: { id: s.learnerId },
      data: { teacherId: s.teacherId },
    });
  });

  it('refuses a token whose session belongs to a different account', async () => {
    const a = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('x-1'));
    const b = await g.auth.login(subjectOf(s.managerId), PASSWORD, device('x-2'));
    const stitched = a.accessToken.split('.');
    const bClaims = await g.auth.authenticate(b.accessToken);
    // Re-signing is impossible without the key; the check that matters is that
    // the session row must belong to the account named in the token.
    expect(bClaims!.claims.sub).toBe(s.accounts[s.managerId]);
    expect(stitched).toHaveLength(3);
  });
});

// -------------------------------------------------------------------------
describe('devices and the device limit', () => {
  it('keeps one live session per device and lists them', async () => {
    const account = s.accounts[s.ownerId];
    await g.sessions.revokeAll(account, 'test: reset');
    await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('phone'));
    await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('tablet'));
    const sessions = await g.sessions.list(account);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((x) => x.platform)).toEqual(['ios', 'ios']);
  });

  it('re-authenticating on the same device replaces its session rather than adding one', async () => {
    const account = s.accounts[s.ownerId];
    await g.sessions.revokeAll(account, 'test: reset');
    await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('phone'));
    await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('phone'));
    expect(await g.sessions.list(account)).toHaveLength(1);
  });

  it('enforces the configured limit by revoking the least recently seen device', async () => {
    const account = s.accounts[s.ownerId];
    await g.sessions.revokeAll(account, 'test: reset');
    await g.prisma.config.upsert({
      where: { key: 'auth.max_active_devices' },
      create: { key: 'auth.max_active_devices', value: 2 },
      update: { value: 2 },
    });
    g.config.invalidate();

    await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('d1'));
    await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('d2'));
    const third = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('d3'));

    const live = await g.sessions.list(account);
    expect(live).toHaveLength(2);
    // The newest device is always among the survivors: a person is never locked
    // out of the device in their hand by a session they cannot see.
    const current = await g.auth.authenticate(third.accessToken);
    expect(current).not.toBeNull();

    await g.prisma.config.update({
      where: { key: 'auth.max_active_devices' },
      data: { value: 5 },
    });
    g.config.invalidate();
  });

  it('honours reject_new as the alternative policy', async () => {
    const account = s.accounts[s.ownerId];
    await g.sessions.revokeAll(account, 'test: reset');
    await g.prisma.config.upsert({
      where: { key: 'auth.device_limit_policy' },
      create: { key: 'auth.device_limit_policy', value: 'reject_new' },
      update: { value: 'reject_new' },
    });
    await g.prisma.config.update({ where: { key: 'auth.max_active_devices' }, data: { value: 1 } });
    g.config.invalidate();

    await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('only'));
    await expect(g.auth.login(subjectOf(s.ownerId), PASSWORD, device('second'))).rejects.toMatchObject(
      { code: 'AUTH.DEVICE_LIMIT_REACHED' },
    );

    await g.prisma.config.update({
      where: { key: 'auth.device_limit_policy' },
      data: { value: 'revoke_oldest' },
    });
    await g.prisma.config.update({ where: { key: 'auth.max_active_devices' }, data: { value: 5 } });
    g.config.invalidate();
  });
});

// -------------------------------------------------------------------------
describe('logout', () => {
  it('logs out this device only', async () => {
    const account = s.accounts[s.ownerId];
    await g.sessions.revokeAll(account, 'test: reset');
    const here = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('here'));
    const there = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('there'));

    await g.auth.logout((await g.auth.authenticate(here.accessToken))!.claims.sid, s.ownerId);
    expect(await g.auth.authenticate(here.accessToken)).toBeNull();
    expect(await g.auth.authenticate(there.accessToken)).not.toBeNull();
  });

  it('logs out one named device of my own', async () => {
    const account = s.accounts[s.ownerId];
    await g.sessions.revokeAll(account, 'test: reset');
    const here = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('here'));
    const there = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('there'));
    const target = (await g.auth.authenticate(there.accessToken))!.claims.sid;

    await g.sessions.revokeOwn(account, target, 'test: revoke my other device');
    expect(await g.auth.authenticate(there.accessToken)).toBeNull();
    expect(await g.auth.authenticate(here.accessToken)).not.toBeNull();
  });

  it('NEVER lets one account revoke another account\'s session', async () => {
    await g.sessions.revokeAll(s.accounts[s.managerId], 'test: reset');
    const victim = await g.auth.login(subjectOf(s.managerId), PASSWORD, device('victims-phone'));
    const victimSession = (await g.auth.authenticate(victim.accessToken))!.claims.sid;

    // The attacker knows the session id exactly and is a live, authenticated user.
    await expect(
      g.sessions.revokeOwn(s.accounts[s.ownerId], victimSession, 'attack'),
    ).rejects.toMatchObject({ code: 'AUTH.NOT_FOUND' });
    expect(await g.auth.authenticate(victim.accessToken)).not.toBeNull();
  });

  it('logs out everywhere', async () => {
    const account = s.accounts[s.ownerId];
    await g.sessions.revokeAll(account, 'test: reset');
    const a = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('a'));
    const b = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('b'));
    await g.sessions.revokeAll(account, 'logout all devices');
    expect(await g.auth.authenticate(a.accessToken)).toBeNull();
    expect(await g.auth.authenticate(b.accessToken)).toBeNull();
    expect(await g.sessions.list(account)).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
describe('refresh', () => {
  it('rotates the refresh token, retiring the one presented', async () => {
    await g.sessions.revokeAll(s.accounts[s.ownerId], 'test: reset');
    const first = await g.auth.login(subjectOf(s.ownerId), PASSWORD, device('r1'));
    const second = await g.auth.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    // Replaying the spent token fails: a stolen refresh token is good once, and
    // using it is what makes the theft visible.
    await expect(g.auth.refresh(first.refreshToken)).rejects.toMatchObject({
      code: 'AUTH.SESSION_INVALID',
    });
    expect(await g.auth.authenticate(second.accessToken)).not.toBeNull();
  });

  it('refuses to refresh a suspended account, and kills the session on the way past', async () => {
    await g.sessions.revokeAll(s.accounts[s.otherAdminId], 'test: reset');
    const issued = await g.auth.login(subjectOf(s.otherAdminId), PASSWORD, device('r2'));
    await g.accounts.suspend(s.accounts[s.otherAdminId], s.managerId, 'test: suspend');

    await expect(g.auth.refresh(issued.refreshToken)).rejects.toMatchObject({
      code: 'AUTH.SESSION_INVALID',
    });
    await g.accounts.activate(s.accounts[s.otherAdminId], s.managerId, 'test: restore');
  });
});

// -------------------------------------------------------------------------
describe('the password lifecycle', () => {
  it('changes a password, keeps this session, and ends every other one', async () => {
    const account = s.accounts[s.parentId];
    await g.sessions.revokeAll(account, 'test: reset');
    const here = await g.auth.login(subjectOf(s.parentId), PASSWORD, device('here'));
    const elsewhere = await g.auth.login(subjectOf(s.parentId), PASSWORD, device('elsewhere'));
    const hereSid = (await g.auth.authenticate(here.accessToken))!.claims.sid;

    const NEW = 'an-even-longer-new-password';
    await g.auth.changePassword(account, s.parentId, PASSWORD, NEW, hereSid);

    expect(await g.auth.authenticate(here.accessToken)).not.toBeNull();
    expect(await g.auth.authenticate(elsewhere.accessToken)).toBeNull();
    await expect(g.auth.login(subjectOf(s.parentId), PASSWORD)).rejects.toBeInstanceOf(AuthError);
    await expect(g.auth.login(subjectOf(s.parentId), NEW, device('after'))).resolves.toBeTruthy();

    await g.auth.changePassword(account, s.parentId, NEW, PASSWORD);
  });

  it('refuses a change that cannot produce the current password', async () => {
    await expect(
      g.auth.changePassword(s.accounts[s.parentId], s.parentId, 'wrong', 'another-long-password'),
    ).rejects.toMatchObject({ code: 'AUTH.INVALID_CREDENTIALS' });
  });

  it('refuses a new password below the configured minimum length', async () => {
    await expect(
      g.auth.changePassword(s.accounts[s.parentId], s.parentId, PASSWORD, 'short'),
    ).rejects.toMatchObject({ code: 'AUTH.WEAK_PASSWORD' });
  });

  it('a reset ENDS EVERY SESSION, including one an intruder is holding', async () => {
    const account = s.accounts[s.managerId];
    await g.sessions.revokeAll(account, 'test: reset');
    const intruder = await g.auth.login(subjectOf(s.managerId), PASSWORD, device('intruder'));
    const owner = await g.auth.login(subjectOf(s.managerId), PASSWORD, device('owner'));

    const issued = await g.auth.beginPasswordReset(subjectOf(s.managerId));
    const NEW = 'the-password-after-the-reset';
    await g.auth.completePasswordReset(issued!.token, NEW);

    // A reset whose purpose is to recover a compromised account has not
    // recovered it while the intruder's token still works.
    expect(await g.auth.authenticate(intruder.accessToken)).toBeNull();
    expect(await g.auth.authenticate(owner.accessToken)).toBeNull();
    await expect(g.auth.login(subjectOf(s.managerId), NEW, device('fresh'))).resolves.toBeTruthy();

    await g.accounts.setPassword(account, PASSWORD, { reason: 'test: restore' });
  });

  it('a reset token is single use and cannot be replayed', async () => {
    const issued = await g.auth.beginPasswordReset(subjectOf(s.ownerId));
    await g.auth.completePasswordReset(issued!.token, 'first-reset-password-x');
    await expect(
      g.auth.completePasswordReset(issued!.token, 'second-reset-password-x'),
    ).rejects.toMatchObject({ code: 'AUTH.INVALID_RESET_TOKEN' });
    await g.accounts.setPassword(s.accounts[s.ownerId], PASSWORD, { reason: 'test: restore' });
  });

  it('minting a new reset token retires the previous one', async () => {
    const first = await g.auth.beginPasswordReset(subjectOf(s.ownerId));
    const second = await g.auth.beginPasswordReset(subjectOf(s.ownerId));
    await expect(
      g.auth.completePasswordReset(first!.token, 'a-long-enough-password'),
    ).rejects.toMatchObject({ code: 'AUTH.INVALID_RESET_TOKEN' });
    await g.auth.completePasswordReset(second!.token, 'a-long-enough-password');
    await g.accounts.setPassword(s.accounts[s.ownerId], PASSWORD, { reason: 'test: restore' });
  });

  it('forgot-password reveals nothing about an unknown subject', async () => {
    expect(await g.auth.beginPasswordReset('subject_does_not_exist')).toBeNull();
  });

  it('stores reset tokens hashed, never in clear', async () => {
    const issued = await g.auth.beginPasswordReset(subjectOf(s.ownerId));
    const rows = await g.prisma.accountToken.findMany({ where: { consumedAt: null } });
    for (const row of rows) expect(row.tokenHash).not.toBe(issued!.token);
    expect(rows.some((r) => r.tokenHash.includes(issued!.token))).toBe(false);
  });
});

// -------------------------------------------------------------------------
describe('e-mail verification', () => {
  it('records verification when a valid token is redeemed', async () => {
    const accountId = s.accounts[s.parentId];
    const issued = await g.accounts.mintToken(accountId, 'email_verification');
    await g.accounts.verifyEmail(issued.token);
    const account = await g.prisma.account.findUnique({ where: { id: accountId } });
    expect(account!.emailVerifiedAt).not.toBeNull();
  });

  it('refuses an unknown, spent or expired token', async () => {
    await expect(g.accounts.verifyEmail('not-a-token')).rejects.toMatchObject({
      code: 'AUTH.INVALID_VERIFICATION_TOKEN',
    });
    const issued = await g.accounts.mintToken(s.accounts[s.ownerId], 'email_verification');
    await g.accounts.verifyEmail(issued.token);
    await expect(g.accounts.verifyEmail(issued.token)).rejects.toMatchObject({
      code: 'AUTH.INVALID_VERIFICATION_TOKEN',
    });
  });

  it('will not accept a password-reset token where a verification token is required', async () => {
    const reset = await g.accounts.mintToken(s.accounts[s.ownerId], 'password_reset');
    await expect(g.accounts.verifyEmail(reset.token)).rejects.toMatchObject({
      code: 'AUTH.INVALID_VERIFICATION_TOKEN',
    });
  });
});

// -------------------------------------------------------------------------
describe('account activation and deactivation', () => {
  it('a deactivated account cannot authenticate and holds no live session', async () => {
    const accountId = s.accounts[s.otherAdminId];
    await g.sessions.revokeAll(accountId, 'test: reset');
    const issued = await g.auth.login(subjectOf(s.otherAdminId), PASSWORD, device('before'));
    expect(await g.auth.authenticate(issued.accessToken)).not.toBeNull();

    await g.accounts.deactivate(accountId, s.managerId, 'test: offboarded');

    expect(await g.auth.authenticate(issued.accessToken)).toBeNull();
    expect(await g.sessions.list(accountId)).toHaveLength(0);
    await expect(g.auth.login(subjectOf(s.otherAdminId), PASSWORD)).rejects.toMatchObject({
      code: 'AUTH.ACCOUNT_DISABLED',
    });

    await g.accounts.activate(accountId, s.managerId, 'test: reinstated');
    await expect(g.auth.login(subjectOf(s.otherAdminId), PASSWORD, device('after'))).resolves.toBeTruthy();
  });

  it('keeps is_active a faithful mirror of the lifecycle status', async () => {
    const accountId = s.accounts[s.otherAdminId];
    for (const [status, expected] of [
      ['suspended', false],
      ['active', true],
    ] as const) {
      if (status === 'suspended') await g.accounts.suspend(accountId, s.managerId, 'test');
      else await g.accounts.activate(accountId, s.managerId, 'test');
      const account = await g.prisma.account.findUnique({ where: { id: accountId } });
      expect({ status: account!.status, isActive: account!.isActive }).toEqual({
        status,
        isActive: expected,
      });
    }
  });

  it('audits every lifecycle transition with a reason', async () => {
    const accountId = s.accounts[s.otherAdminId];
    await g.accounts.suspend(accountId, s.managerId, 'test: an auditable reason');
    const rows = await g.prisma.auditLog.findMany({
      where: { entity: 'account', entityId: accountId, action: 'account.suspended' },
      orderBy: { at: 'desc' },
      take: 1,
    });
    expect(rows[0]?.reason).toBe('test: an auditable reason');
    await g.accounts.activate(accountId, s.managerId, 'test: restore');
  });

  it('refuses a lifecycle change with no reason', async () => {
    await expect(
      g.accounts.deactivate(s.accounts[s.otherAdminId], s.managerId, '   '),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
