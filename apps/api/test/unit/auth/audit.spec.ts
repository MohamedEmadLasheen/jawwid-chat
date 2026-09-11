/**
 * The authentication audit trail (IDENTITY-MODEL §6, API-CONTRACT §3.1).
 *
 * §6 is unusually absolute: "**Every** login, refresh, logout, revocation ...
 * writes chat.audit_log ... **in the same transaction**". These pin both
 * halves. The atomicity half matters most: before PR-B's audit work, refresh
 * reuse revoked every session on an account and recorded nothing but a
 * Logger.warn -- a theft detected, acted on, and then forgotten.
 */
import { AUDIT_ACTION, AUTH_EVENT, REUSE_REASON } from '@platform/auth/auth.service';
import type { AuthService } from '@platform/auth/auth.service';
import { subjectHash } from '@platform/auth/subject-hash';
import {
  buildAuth,
  contactActor,
  FakeDb,
  FakeIdentity,
  teacherActor,
  withAuthEnv,
} from './support/fake-db';

jest.setTimeout(60_000);

const PASSWORD = 'a-correct-password-1';

describe('login', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;
  let accountId: string;

  beforeEach(async () => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
    const account = await db.addAccount({ subject: 'parent-audit' }, PASSWORD);
    accountId = account.id;
    identity.give(account.id, contactActor());
  });

  it('a successful login writes the canonical session.created audit row', async () => {
    const pair = await auth.login('parent-audit', PASSWORD);

    expect(db.auditLogs).toHaveLength(1);
    expect(db.auditLogs[0]).toMatchObject({
      actorId: pair.actor.actorId,
      action: AUDIT_ACTION.SESSION_CREATED,
      entity: 'session',
      entityId: pair.sessionId,
      reason: 'login',
    });
  });

  it('the audit row names the session that actually exists', async () => {
    const pair = await auth.login('parent-audit', PASSWORD);
    expect(db.sessions.map((s) => s.id)).toContain(db.auditLogs[0].entityId);
    expect(db.auditLogs[0].entityId).toBe(pair.sessionId);
  });

  it('a wrong password writes auth.login_failed, with a HASHED subject', async () => {
    await auth.login('parent-audit', 'wrong').catch(() => undefined);

    expect(db.eventLogs).toHaveLength(1);
    const event = db.eventLogs[0];
    expect(event.type).toBe(AUTH_EVENT.LOGIN_FAILED);
    expect(event.actorKind).toBe('system');
    expect(event.actorId).toBeNull();
    expect(event.payload).toMatchObject({
      subjectHash: subjectHash('parent-audit'),
      reason: 'invalid_credentials',
      accountId,
    });
  });

  it('an UNKNOWN subject is recorded too — that is the row a spray shows up in', async () => {
    await auth.login('no-such-account', PASSWORD).catch(() => undefined);

    expect(db.eventLogs).toHaveLength(1);
    expect(db.eventLogs[0].payload).toMatchObject({
      subjectHash: subjectHash('no-such-account'),
      reason: 'invalid_credentials',
      accountId: null,
    });
  });

  it('NEVER records the raw subject, the password, or any hash of the password', async () => {
    await auth.login('parent-audit', 'hunter2-the-password').catch(() => undefined);
    const serialised = JSON.stringify(db.eventLogs);

    expect(serialised).not.toContain('hunter2-the-password');
    expect(serialised).not.toContain('parent-audit');
    expect(serialised).not.toContain('argon2id');
    expect(serialised).not.toContain(db.credentialFor(accountId).passwordHash);
  });

  it('a disabled account records WHY it was refused, distinctly from a bad password', async () => {
    db.accounts[0].status = 'suspended';
    db.accounts[0].isActive = false;

    await auth.login('parent-audit', PASSWORD).catch(() => undefined);

    expect(db.eventLogs[0].payload).toMatchObject({ reason: 'account_disabled' });
  });

  it('a locked account records its own reason', async () => {
    db.credentialFor(accountId).lockedUntil = new Date(Date.now() + 60_000);
    await auth.login('parent-audit', PASSWORD).catch(() => undefined);
    expect(db.eventLogs[0].payload).toMatchObject({ reason: 'account_locked' });
  });

  it('the lockout counter and its event move together, in one transaction', async () => {
    await auth.login('parent-audit', 'wrong').catch(() => undefined);

    expect(db.credentialFor(accountId).failedAttempts).toBe(1);
    expect(db.eventLogs).toHaveLength(1);

    // A counter that advances without the event that explains it is how a
    // lockout becomes unexplainable at 3am.
    await auth.login('parent-audit', 'wrong').catch(() => undefined);
    expect(db.credentialFor(accountId).failedAttempts).toBe(2);
    expect(db.eventLogs).toHaveLength(2);
  });
});

describe('logout', () => {
  let db: FakeDb;
  let auth: AuthService;

  beforeEach(async () => {
    withAuthEnv();
    db = new FakeDb();
    const identity = new FakeIdentity();
    auth = buildAuth(db, identity);
    const account = await db.addAccount({ subject: 'parent-logout' }, PASSWORD);
    identity.give(account.id, contactActor());
  });

  it('writes the canonical session.revoked row with reason logout', async () => {
    const pair = await auth.login('parent-logout', PASSWORD);
    db.auditLogs.length = 0;

    await auth.logout(pair.sessionId, pair.actor.actorId);

    expect(db.auditLogs).toHaveLength(1);
    expect(db.auditLogs[0]).toMatchObject({
      actorId: pair.actor.actorId,
      action: AUDIT_ACTION.SESSION_REVOKED,
      entity: 'session',
      entityId: pair.sessionId,
      reason: 'logout',
    });
  });

  it('a SECOND logout writes no second row — nothing changed, so nothing is recorded', async () => {
    const pair = await auth.login('parent-logout', PASSWORD);
    await auth.logout(pair.sessionId);
    db.auditLogs.length = 0;

    await auth.logout(pair.sessionId);

    // An audit trail that records revocations that did not happen is worse than
    // one that is quiet. The response stays {ok:true} either way (§3.1).
    expect(db.auditLogs).toHaveLength(0);
    expect(db.sessions[0].revokedReason).toBe('logout');
  });

  it('logging out one device leaves the other session untouched and unaudited', async () => {
    const phone = await auth.login('parent-logout', PASSWORD, { device: { platform: 'ios' } });
    const web = await auth.login('parent-logout', PASSWORD, { device: { platform: 'web' } });
    db.auditLogs.length = 0;

    await auth.logout(phone.sessionId);

    expect(db.auditLogs).toHaveLength(1);
    expect(db.auditLogs[0].entityId).toBe(phone.sessionId);
    expect(db.sessions.find((s) => s.id === web.sessionId)!.revokedAt).toBeNull();
  });
});

describe('refresh', () => {
  let db: FakeDb;
  let auth: AuthService;

  beforeEach(async () => {
    withAuthEnv();
    db = new FakeDb();
    const identity = new FakeIdentity();
    auth = buildAuth(db, identity);
    const account = await db.addAccount({ subject: 'parent-refresh' }, PASSWORD);
    identity.give(account.id, contactActor());
  });

  it('a rotation records BOTH halves: the session retired and the one created', async () => {
    const first = await auth.login('parent-refresh', PASSWORD);
    db.auditLogs.length = 0;

    const second = await auth.refresh(first.refreshToken);

    const revoked = db.auditLogs.find((a) => a.action === AUDIT_ACTION.SESSION_REVOKED);
    const created = db.auditLogs.find((a) => a.action === AUDIT_ACTION.SESSION_CREATED);

    expect(revoked).toMatchObject({ entityId: first.sessionId, reason: 'rotated' });
    expect(created).toMatchObject({ entityId: second.sessionId, reason: 'refresh' });
  });

  it('a refresh refused for a disabled account records the revocation it performed', async () => {
    const pair = await auth.login('parent-refresh', PASSWORD);
    db.accounts[0].status = 'deactivated';
    db.accounts[0].isActive = false;
    db.auditLogs.length = 0;

    await auth.refresh(pair.refreshToken).catch(() => undefined);

    expect(db.auditLogs).toHaveLength(1);
    expect(db.auditLogs[0]).toMatchObject({
      action: AUDIT_ACTION.SESSION_REVOKED,
      entityId: pair.sessionId,
      reason: 'account is not active',
    });
  });
});

describe('refresh reuse — the security event that must never be lost', () => {
  let db: FakeDb;
  let auth: AuthService;
  let accountId: string;

  beforeEach(async () => {
    withAuthEnv();
    db = new FakeDb();
    const identity = new FakeIdentity();
    auth = buildAuth(db, identity);
    const account = await db.addAccount({ subject: 'parent-reuse' }, PASSWORD);
    accountId = account.id;
    identity.give(account.id, contactActor());
  });

  it('the full transition: rotate, replay, detect, revoke, RECORD', async () => {
    // 1. a valid refresh token works
    const first = await auth.login('parent-reuse', PASSWORD);
    const alsoLive = await auth.login('parent-reuse', PASSWORD, { device: { platform: 'web' } });

    // 2. rotation occurs
    const second = await auth.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    db.auditLogs.length = 0;
    db.eventLogs.length = 0;

    // 3. the old refresh token is replayed
    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({
      code: 'AUTH.SESSION_REVOKED',
    });

    // 4 + 5. reuse is detected and EVERY live session on the account is revoked
    expect(db.sessions.every((s) => s.revokedAt !== null)).toBe(true);
    expect(await auth.authenticate(second.accessToken)).toBeNull();
    expect(await auth.authenticate(alsoLive.accessToken)).toBeNull();

    // 6. the canonical event is persisted
    expect(db.eventLogs).toHaveLength(1);
    expect(db.eventLogs[0]).toMatchObject({
      type: AUTH_EVENT.REFRESH_REUSE_DETECTED,
      actorKind: 'system',
      actorId: null,
    });
    expect(db.eventLogs[0].payload).toMatchObject({ accountId, sessionId: first.sessionId });
    expect(db.eventLogs[0].payload!.revokedSessions).toBeGreaterThan(0);

    // 7. the audit record is persisted
    const audit = db.auditLogs.find((a) => a.reason === REUSE_REASON);
    expect(audit).toMatchObject({
      action: AUDIT_ACTION.SESSION_REVOKED,
      entity: 'account',
      entityId: accountId,
    });
  });

  it('records no token, and no hash of one', async () => {
    const first = await auth.login('parent-reuse', PASSWORD);
    await auth.refresh(first.refreshToken);
    await auth.refresh(first.refreshToken).catch(() => undefined);

    const serialised = JSON.stringify([db.eventLogs, db.auditLogs]);
    expect(serialised).not.toContain(first.refreshToken);
    for (const session of db.sessions) {
      expect(serialised).not.toContain(session.refreshTokenHash);
    }
  });

  it('8. THE WHOLE TRANSITION IS ATOMIC — no revocation without its record', async () => {
    const first = await auth.login('parent-reuse', PASSWORD);
    await auth.refresh(first.refreshToken);

    const liveBefore = db.sessions.filter((s) => s.revokedAt === null).length;
    expect(liveBefore).toBeGreaterThan(0);

    // Make the event write fail the way a constraint violation would.
    const audit = (auth as unknown as { audit: { event: unknown } }).audit;
    const original = audit.event;
    (audit as { event: unknown }).event = async () => {
      throw new Error('event_log write failed');
    };

    await expect(auth.refresh(first.refreshToken)).rejects.toThrow('event_log write failed');

    // THE SESSIONS ARE STILL LIVE. The revocation rolled back with the event,
    // so the system never reaches a state where the sweep happened and the
    // reason for it does not exist.
    expect(db.sessions.filter((s) => s.revokedAt === null)).toHaveLength(liveBefore);
    expect(db.eventLogs).toHaveLength(0);
    expect(db.auditLogs.filter((a) => a.reason === REUSE_REASON)).toHaveLength(0);

    (audit as { event: unknown }).event = original;
  });
});

describe('a failed audit write rolls the security state back with it', () => {
  it('no session is created when the login audit row cannot be written', async () => {
    withAuthEnv();
    const db = new FakeDb();
    const identity = new FakeIdentity();
    const auth = buildAuth(db, identity);
    const account = await db.addAccount({ subject: 'parent-atomic' }, PASSWORD);
    identity.give(account.id, teacherActor({ kind: 'contact' }));

    const audit = (auth as unknown as { audit: { audit: unknown } }).audit;
    (audit as { audit: unknown }).audit = async () => {
      throw new Error('audit_log write failed');
    };

    await expect(auth.login('parent-atomic', PASSWORD)).rejects.toThrow('audit_log write failed');

    // A session nobody can account for is worse than a login that must be
    // retried, so this is the correct direction to fail.
    expect(db.sessions).toHaveLength(0);
    expect(db.accounts[0].lastLoginAt).toBeNull();
  });
});
