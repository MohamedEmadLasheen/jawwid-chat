/**
 * PD-23: session lifetimes per role, and the Devices & sessions operations.
 *
 * The properties under test:
 *   - the policy table is what the owner decided, and the super admin is never
 *     "kept signed in";
 *   - a refresh can never buy a longer session than the login it continues
 *     (authenticated_at, client and remembered come from the row);
 *   - reaching the absolute limit ends the session WITHOUT leaving a 'rotated'
 *     row behind, which a later presentation would read as theft;
 *   - the holder can end another of their sessions, never someone else's.
 */
import { AuthErrorCode } from '@platform/auth/auth.errors';
import { LIFETIME_REASON, type AuthService } from '@platform/auth/auth.service';
import { SESSION_POLICIES, sessionPolicyFor, sessionWindow } from '@platform/auth/session-policy';
import {
  buildAuth,
  contactActor,
  FakeDb,
  FakeIdentity,
  staffActor,
  teacherActor,
  withAuthEnv,
} from './support/fake-db';

jest.setTimeout(60_000);

const PASSWORD = 'a-correct-password-1';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe('PD-23 session policy table', () => {
  it.each([
    ['parent on the app', contactActor(), 'app', false, 'family_app'],
    ['teacher on the app', teacherActor(), 'app', false, 'family_app'],
    ['staff on the app', staffActor(), 'app', false, 'staff_app'],
    ['staff on the web, kept signed in', staffActor(), 'web', true, 'staff_web_remembered'],
    ['staff on the web, this tab', staffActor(), 'web', false, 'staff_web'],
    ['staff naming no platform, asking to be remembered', staffActor(), null, true, 'staff_web'],
    ['super admin on the web, asking to be remembered', staffActor({ staffRole: 'super_admin' }), 'web', true, 'super_admin'],
    ['super admin on the app', staffActor({ staffRole: 'super_admin' }), 'app', false, 'super_admin'],
    ['parent asking to be remembered', contactActor(), 'web', true, 'family_app'],
  ] as const)('%s -> %s', (_label, actor, client, remember, expected) => {
    expect(sessionPolicyFor(actor, client, remember).name).toBe(expected);
  });

  it('matches the owner decision of 2026-10-22, limit by limit', () => {
    expect(SESSION_POLICIES.family_app).toMatchObject({ idleSeconds: 30 * 86400, absoluteSeconds: null });
    expect(SESSION_POLICIES.staff_app).toMatchObject({ idleSeconds: 14 * 86400, absoluteSeconds: 30 * 86400 });
    expect(SESSION_POLICIES.staff_web_remembered).toMatchObject({ idleSeconds: 7 * 86400, absoluteSeconds: 30 * 86400, remembered: true });
    expect(SESSION_POLICIES.staff_web).toMatchObject({ idleSeconds: 12 * 3600, absoluteSeconds: 7 * 86400 });
    expect(SESSION_POLICIES.super_admin).toMatchObject({ idleSeconds: 12 * 3600, absoluteSeconds: 7 * 86400, remembered: false });
  });

  it('the window is the earlier of idle and absolute, and JWT_REFRESH_TTL only ever shortens it', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    const loggedIn = new Date(now.getTime() - 25 * DAY);
    // staff_app: 14 d idle would pass the 30 d absolute -> capped at login + 30 d.
    const capped = sessionWindow(SESSION_POLICIES.staff_app, loggedIn, now, 30 * 86400);
    expect(capped.expiresAt.toISOString()).toBe(new Date(loggedIn.getTime() + 30 * DAY).toISOString());
    // A short deployment cap wins over the policy's idle window.
    const short = sessionWindow(SESSION_POLICIES.family_app, now, now, 3600);
    expect(short.expiresAt.getTime()).toBe(now.getTime() + HOUR);
    expect(short.absoluteExpiresAt).toBeNull();
  });
});

describe('PD-23 policy at login and refresh', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;

  beforeEach(() => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
  });

  async function account(subject: string, actor: ReturnType<typeof staffActor>) {
    const row = await db.addAccount({ subject, kind: actor.kind === 'contact' ? 'family' : actor.kind }, PASSWORD);
    identity.give(row.id, actor);
    return row;
  }

  function near(actual: Date, expectedMs: number) {
    expect(Math.abs(actual.getTime() - expectedMs)).toBeLessThan(5_000);
  }

  it('a parent on the app gets 30 days idle and no absolute limit', async () => {
    await account('parent-1', contactActor());
    const pair = await auth.login('parent-1', PASSWORD, { device: { platform: 'ios', name: 'iPhone' } });
    near(pair.expiresAt, Date.now() + 30 * DAY);
    expect(pair.absoluteExpiresAt).toBeNull();
    expect(pair.remembered).toBe(false);
    expect(db.sessions[0]).toMatchObject({ client: 'app', remembered: false });
  });

  it('staff on the web who ask to be kept signed in get 7 days idle, 30 days absolute', async () => {
    await account('staff-web', staffActor());
    const pair = await auth.login('staff-web', PASSWORD, { device: { platform: 'web', name: 'Chrome on macOS' }, remember: true });
    expect(pair.remembered).toBe(true);
    near(pair.expiresAt, Date.now() + 7 * DAY);
    near(pair.absoluteExpiresAt!, Date.now() + 30 * DAY);
  });

  it('the super admin is never kept signed in, whatever the client asks', async () => {
    await account('owner', staffActor({ staffRole: 'super_admin' }));
    const pair = await auth.login('owner', PASSWORD, { device: { platform: 'web' }, remember: true });
    expect(pair.remembered).toBe(false);
    near(pair.expiresAt, Date.now() + 12 * HOUR);
    near(pair.absoluteExpiresAt!, Date.now() + 7 * DAY);
    expect(db.sessions[0].remembered).toBe(false);
  });

  it('a refresh carries the login time, client and remember flag forward from the row', async () => {
    await account('staff-carry', staffActor());
    const first = await auth.login('staff-carry', PASSWORD, { device: { platform: 'web' }, remember: true });
    const loggedInAt = db.sessions[0].authenticatedAt;

    const second = await auth.refresh(first.refreshToken, { userAgent: 'anything' });
    const successor = db.sessions.find((s) => s.id === second.sessionId)!;
    expect(successor.authenticatedAt.getTime()).toBe(loggedInAt.getTime());
    expect(successor).toMatchObject({ client: 'web', remembered: true });
    expect(second.remembered).toBe(true);
  });

  it('a refresh near the absolute limit is capped at it, not given a fresh idle window', async () => {
    await account('staff-app', staffActor());
    const first = await auth.login('staff-app', PASSWORD, { device: { platform: 'android', name: 'Pixel' } });
    // The password was entered 29 days ago: 1 day of the 30 d absolute remains.
    const loggedIn = new Date(Date.now() - 29 * DAY);
    db.sessions[0].authenticatedAt = loggedIn;
    db.sessions[0].createdAt = loggedIn;

    const second = await auth.refresh(first.refreshToken);
    near(second.expiresAt, loggedIn.getTime() + 30 * DAY);
    expect(second.expiresAt.getTime()).toBeLessThan(Date.now() + 14 * DAY);
  });

  it('past the absolute limit, refresh ends the session as a LIFETIME, never as a rotation', async () => {
    const actor = staffActor();
    const row = await account('staff-promoted', actor);
    const first = await auth.login('staff-promoted', PASSWORD, { device: { platform: 'ios' } });
    const other = await auth.login('staff-promoted', PASSWORD, { device: { platform: 'web' } });
    // Signed in 8 days ago on the app (fine for staff_app), then promoted to
    // super admin, whose absolute limit is 7 days.
    db.sessions[0].authenticatedAt = new Date(Date.now() - 8 * DAY);
    db.sessions[0].createdAt = db.sessions[0].authenticatedAt;
    identity.mutate(actor.actorId, { staffRole: 'super_admin' });

    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({ code: AuthErrorCode.SESSION_REVOKED });
    expect(db.sessions[0]).toMatchObject({ revokedReason: LIFETIME_REASON });

    // Presenting it again is NOT reuse: the account's other session survives.
    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({ code: AuthErrorCode.SESSION_REVOKED });
    expect(db.sessions.find((s) => s.id === other.sessionId)!.revokedAt).toBeNull();
    expect(row.id).toBeDefined();
  });
});

describe('PD-23 devices & sessions', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;

  beforeEach(() => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
  });

  it('lists only live sessions of the account, with their device and login time', async () => {
    const acct = await db.addAccount({ subject: 'teacher-devices', kind: 'teacher' }, PASSWORD);
    const actor = identity.give(acct.id, teacherActor());
    const phone = await auth.login('teacher-devices', PASSWORD, { device: { platform: 'ios', name: 'iPhone', appVersion: '1.4.0' } });
    const tablet = await auth.login('teacher-devices', PASSWORD, { device: { platform: 'android', name: 'Tab' } });
    await auth.logout(tablet.sessionId, actor.actorId);

    const list = await auth.listLiveSessions(acct.id);
    expect(list.map((s) => s.id)).toEqual([phone.sessionId]);
    expect(list[0]).toMatchObject({ platform: 'ios', deviceName: 'iPhone', appVersion: '1.4.0', remembered: false });
    expect(list[0].signedInAt).toBeInstanceOf(Date);
  });

  it('the holder ends another of their sessions; another account cannot end it', async () => {
    const mine = await db.addAccount({ subject: 'parent-a', kind: 'family' }, PASSWORD);
    const me = identity.give(mine.id, contactActor());
    const theirs = await db.addAccount({ subject: 'parent-b', kind: 'family' }, PASSWORD);
    const them = identity.give(theirs.id, contactActor());

    await auth.login('parent-a', PASSWORD, { device: { platform: 'ios' } });
    const old = await auth.login('parent-a', PASSWORD, { device: { platform: 'android' } });

    expect(await auth.revokeSessionOf(theirs.id, old.sessionId, 'x', { revokedBy: theirs.id, actorId: them.actorId })).toBe(false);
    expect(db.sessions.find((s) => s.id === old.sessionId)!.revokedAt).toBeNull();

    expect(await auth.revokeSessionOf(mine.id, old.sessionId, 'signed out from another device', { revokedBy: mine.id, actorId: me.actorId })).toBe(true);
    expect(await auth.authenticate(old.accessToken)).toBeNull();
    // Ending it again finds nothing live.
    expect(await auth.revokeSessionOf(mine.id, old.sessionId, 'x', { revokedBy: mine.id, actorId: me.actorId })).toBe(false);
  });

  it('"sign out all other devices" keeps the device that asked', async () => {
    const acct = await db.addAccount({ subject: 'staff-many', kind: 'staff' }, PASSWORD);
    const actor = identity.give(acct.id, staffActor());
    const here = await auth.login('staff-many', PASSWORD, { device: { platform: 'web' } });
    const a = await auth.login('staff-many', PASSWORD, { device: { platform: 'ios' } });
    const b = await auth.login('staff-many', PASSWORD, { device: { platform: 'android' } });

    const revoked = await auth.revokeOtherSessions(acct.id, here.sessionId, 'signed out from another device', {
      revokedBy: acct.id,
      actorId: actor.actorId,
    });
    expect(revoked).toBe(2);
    expect(await auth.authenticate(here.accessToken)).not.toBeNull();
    expect(await auth.authenticate(a.accessToken)).toBeNull();
    expect(await auth.authenticate(b.accessToken)).toBeNull();
    // Their refresh tokens are dead too, and not as a rotation (no reuse sweep).
    await expect(auth.refresh(a.refreshToken)).rejects.toMatchObject({ code: AuthErrorCode.SESSION_REVOKED });
    expect(await auth.authenticate(here.accessToken)).not.toBeNull();
  });
});
