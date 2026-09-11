/**
 * Session lifecycle: refresh, rotation, reuse detection, revocation, logout
 * (API-CONTRACT §3.1, IDENTITY-MODEL §2).
 *
 * The property under test throughout: a session's authority lives in a row, so
 * ending the row ends the session -- on the next request, not at token expiry.
 */
import { AuthErrorCode } from '@platform/auth/auth.errors';
import type { AuthService } from '@platform/auth/auth.service';
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

describe('session lifecycle', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;
  let accountId: string;

  beforeEach(async () => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
    const account = await db.addAccount({ subject: 'parent-session' }, PASSWORD);
    accountId = account.id;
    identity.give(account.id, contactActor());
  });

  it('a fresh access token authenticates, and resolves the same actor', async () => {
    const pair = await auth.login('parent-session', PASSWORD);
    const authenticated = await auth.authenticate(pair.accessToken);

    expect(authenticated).not.toBeNull();
    expect(authenticated!.actor.actorId).toBe(pair.actor.actorId);
    expect(authenticated!.sessionId).toBe(pair.sessionId);
    expect(authenticated!.accountId).toBe(accountId);
    // `sub` is the account SUBJECT, the canonical login identifier.
    expect(authenticated!.claims.sub).toBe('parent-session');
  });

  it('refresh rotates: the new token works and the presented one never works again', async () => {
    const first = await auth.login('parent-session', PASSWORD);
    const second = await auth.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.sessionId).not.toBe(first.sessionId);

    // The rotated session is retired with a reason, as the DB check requires.
    const rotated = db.sessions.find((s) => s.id === first.sessionId)!;
    expect(rotated.revokedAt).toBeInstanceOf(Date);
    expect(rotated.revokedReason).toBe('rotated');

    // The new one is live.
    expect(await auth.authenticate(second.accessToken)).not.toBeNull();
  });

  it('the OLD access token dies with its session, not at its own expiry', async () => {
    const first = await auth.login('parent-session', PASSWORD);
    expect(await auth.authenticate(first.accessToken)).not.toBeNull();

    await auth.refresh(first.refreshToken);

    // The token is still cryptographically valid and unexpired. It is refused
    // because its session row is gone -- which is the whole design.
    expect(await auth.authenticate(first.accessToken)).toBeNull();
  });

  it('replaying a rotated refresh token revokes EVERY session on the account', async () => {
    // Two parties holding one token means one of them stole it. Ending every
    // session is how the theft stops being useful.
    const first = await auth.login('parent-session', PASSWORD);
    const other = await auth.login('parent-session', PASSWORD, { device: { platform: 'web' } });
    const second = await auth.refresh(first.refreshToken);

    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_REVOKED,
    });

    expect(db.sessions.every((s) => s.revokedAt !== null)).toBe(true);
    expect(await auth.authenticate(second.accessToken)).toBeNull();
    expect(await auth.authenticate(other.accessToken)).toBeNull();
  });

  it('an unknown refresh token is refused without revealing that it is unknown', async () => {
    await expect(auth.refresh('not-a-real-refresh-token')).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_REVOKED,
    });
    await expect(auth.refresh('')).rejects.toMatchObject({ code: AuthErrorCode.SESSION_REVOKED });
  });

  it('an expired refresh token is refused, and does not renew itself', async () => {
    const pair = await auth.login('parent-session', PASSWORD);
    db.sessions[0].expiresAt = new Date(Date.now() - 1000);

    await expect(auth.refresh(pair.refreshToken)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_REVOKED,
    });
    expect(db.sessions).toHaveLength(1);
  });

  it('an expired session refuses its access token too', async () => {
    const pair = await auth.login('parent-session', PASSWORD);
    db.sessions[0].expiresAt = new Date(Date.now() - 1000);
    expect(await auth.authenticate(pair.accessToken)).toBeNull();
  });

  it('logout revokes the session, and the access token stops working at once', async () => {
    const pair = await auth.login('parent-session', PASSWORD);
    await auth.logout(pair.sessionId);

    expect(db.sessions[0].revokedReason).toBe('logout');
    expect(await auth.authenticate(pair.accessToken)).toBeNull();
    await expect(auth.refresh(pair.refreshToken)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_REVOKED,
    });
  });

  it('logout is idempotent and does not overwrite the original reason', async () => {
    const pair = await auth.login('parent-session', PASSWORD);
    await auth.logout(pair.sessionId);
    const revokedAt = db.sessions[0].revokedAt;

    await expect(auth.logout(pair.sessionId)).resolves.toBeUndefined();
    expect(db.sessions[0].revokedAt).toBe(revokedAt);
    expect(db.sessions[0].revokedReason).toBe('logout');
  });

  it('logging out one device leaves the other signed in', async () => {
    const phone = await auth.login('parent-session', PASSWORD, { device: { platform: 'ios' } });
    const web = await auth.login('parent-session', PASSWORD, { device: { platform: 'web' } });

    await auth.logout(phone.sessionId);

    expect(await auth.authenticate(phone.accessToken)).toBeNull();
    expect(await auth.authenticate(web.accessToken)).not.toBeNull();
  });

  it('a revoked session is refused on the NEXT request, not at token expiry', async () => {
    const pair = await auth.login('parent-session', PASSWORD);
    expect(await auth.authenticate(pair.accessToken)).not.toBeNull();

    await auth.revoke(pair.sessionId, 'revoked by a manager');

    expect(await auth.authenticate(pair.accessToken)).toBeNull();
  });

  it('revocation always records a reason, because the database requires one', async () => {
    const pair = await auth.login('parent-session', PASSWORD);
    await auth.revoke(pair.sessionId, 'revoked by user');

    const row = db.sessions[0];
    expect((row.revokedAt === null) === (row.revokedReason === null)).toBe(true);
    expect(row.revokedReason).toBe('revoked by user');
  });
});

describe('deactivation ends live sessions', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;

  beforeEach(() => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
  });

  it('suspending the ACCOUNT stops an existing access token immediately', async () => {
    const account = await db.addAccount({ subject: 'parent-suspend' }, PASSWORD);
    identity.give(account.id, contactActor());
    const pair = await auth.login('parent-suspend', PASSWORD);
    expect(await auth.authenticate(pair.accessToken)).not.toBeNull();

    db.accounts[0].status = 'suspended';
    db.accounts[0].isActive = false;

    expect(await auth.authenticate(pair.accessToken)).toBeNull();
  });

  it('deactivating the PRINCIPAL stops an existing access token immediately', async () => {
    const account = await db.addAccount({ subject: 'teacher-offboard', kind: 'teacher' }, PASSWORD);
    const actor = identity.give(account.id, teacherActor());
    const pair = await auth.login('teacher-offboard', PASSWORD);
    expect(await auth.authenticate(pair.accessToken)).not.toBeNull();

    // Offboarding sets the teacher row; the account row is untouched.
    identity.mutate(actor.actorId, { isActive: false });

    expect(await auth.authenticate(pair.accessToken)).toBeNull();
  });

  it('a disabled account cannot refresh, and its session is revoked when it tries', async () => {
    const account = await db.addAccount({ subject: 'parent-disabled' }, PASSWORD);
    identity.give(account.id, contactActor());
    const pair = await auth.login('parent-disabled', PASSWORD);

    db.accounts[0].status = 'deactivated';
    db.accounts[0].isActive = false;

    await expect(auth.refresh(pair.refreshToken)).rejects.toMatchObject({
      code: AuthErrorCode.ACCOUNT_DISABLED,
    });
    expect(db.sessions[0].revokedAt).toBeInstanceOf(Date);
  });

  it('a deactivated principal cannot refresh either', async () => {
    const account = await db.addAccount({ subject: 'teacher-refresh', kind: 'teacher' }, PASSWORD);
    const actor = identity.give(account.id, teacherActor());
    const pair = await auth.login('teacher-refresh', PASSWORD);

    identity.mutate(actor.actorId, { isActive: false });

    await expect(auth.refresh(pair.refreshToken)).rejects.toMatchObject({
      code: AuthErrorCode.ACCOUNT_DISABLED,
    });
    expect(db.sessions[0].revokedAt).toBeInstanceOf(Date);
  });
});
