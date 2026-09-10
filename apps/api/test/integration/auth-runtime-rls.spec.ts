/**
 * AUTHENTICATION THROUGH THE LEAST-PRIVILEGED ROLE.
 *
 * Every other authentication suite runs against the database OWNER, which
 * bypasses row-level security -- so it proves the service layer and says nothing
 * about whether authentication can resolve a principal at all on the connection
 * a deployment actually uses.
 *
 * That gap hid a real defect. chat.staff, chat.teacher and chat.contact are
 * readable only to the account they belong to, and resolving that principal is
 * exactly what login, token authentication and refresh do -- before any actor
 * context exists. As `chat_app` every one of those lookups saw zero rows, so a
 * correct password produced "that username or password is not correct".
 *
 * The fix declares the identity the caller has already PROVEN, via
 * `PrismaService.runAsSubject()`. This suite asserts both halves, because either
 * alone is worthless:
 *
 *   1. authentication WORKS through `chat_app`, for all three principal kinds;
 *   2. nothing was widened to achieve it -- with no context the principal tables
 *      are still empty, and another organization's principal stays invisible.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService, withRequestScopedTransaction } from '@platform/prisma.service';
import { buildGraphOn, seed, truncate, Scenario, appDatabaseUrl } from './harness';

/** Fixtures are written as the owner: they are not the thing under test. */
const owner = new PrismaService();
const fixtures = buildGraphOn(owner);

/**
 * The API's connection: chat_app, NOBYPASSRLS -- wrapped in the same
 * request-scoped proxy the application uses, so a query inside a context lands
 * on that context's transaction.
 */
const connection = new PrismaService({ datasources: { db: { url: appDatabaseUrl() } } });
const app = withRequestScopedTransaction(connection);
const g = buildGraphOn(app);

const PASSWORD = 'a-sufficiently-long-password';
const device = (clientKey: string) => ({ clientKey, platform: 'ios', appVersion: '1.0.0' });
const subjectOf = (actorId: string) => `subject_${actorId}`;

let s: Scenario;

/** A principal in a SECOND organization, to prove tenant isolation still holds. */
const foreignOrgId = randomUUID();
const foreignStaffId = randomUUID();
const foreignSubject = `subject_${foreignStaffId}`;

beforeAll(async () => {
  await truncate(owner);
  s = await seed(owner);

  for (const actorId of [s.ownerId, s.managerId, s.parentId, s.teacherId]) {
    await fixtures.accounts.setPassword(s.accounts[actorId], PASSWORD, {
      reason: 'test fixture',
      invalidateSessions: false,
    });
  }

  const foreignAccountId = randomUUID();
  await owner.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name)
     values ('${foreignOrgId}'::uuid, 'org-beta-${foreignOrgId.slice(0, 8)}', 'org_beta')`,
  );
  await owner.$executeRawUnsafe(
    `insert into chat.account (id, subject, kind, status, organization_id)
     values ('${foreignAccountId}'::uuid, '${foreignSubject}', 'staff', 'active',
             '${foreignOrgId}'::uuid)`,
  );
  await owner.$executeRawUnsafe(
    `insert into chat.staff (id, account_id, organization_id, name, role, is_active)
     values ('${foreignStaffId}'::uuid, '${foreignAccountId}'::uuid, '${foreignOrgId}'::uuid,
             'staff_beta', 'admin', true)`,
  );
  await fixtures.accounts.setPassword(foreignAccountId, PASSWORD, {
    reason: 'test fixture',
    invalidateSessions: false,
  });
});

beforeEach(async () => {
  // Deliberately-failed logins elsewhere in this file must not make an unrelated
  // test flake on rate limiting.
  await owner.$executeRawUnsafe('delete from chat.auth_throttle');
  // Every test here signs in fresh. Without this the accumulated sessions trip
  // the device limit, and a suite about RLS starts failing on device policy.
  await owner.$executeRawUnsafe('delete from chat.session');
  await owner.$executeRawUnsafe('delete from chat.device');
});

afterAll(async () => {
  await connection.$disconnect();
  await owner.$disconnect();
});

// -------------------------------------------------------------------------
describe('authentication resolves a principal through chat_app', () => {
  it('signs in a CONTACT (the parent app) and resolves the contact actor', async () => {
    const result = await g.auth.login(subjectOf(s.parentId), PASSWORD, device('rls-contact'));

    expect(result.actor.kind).toBe('contact');
    expect(result.actor.actorId).toBe(s.parentId);
    expect(result.accessToken).toBeTruthy();
  });

  it('signs in STAFF and resolves the staff actor', async () => {
    const result = await g.auth.login(subjectOf(s.managerId), PASSWORD, device('rls-staff'));

    expect(result.actor.kind).toBe('staff');
    expect(result.actor.actorId).toBe(s.managerId);
  });

  it('signs in a TEACHER and resolves the teacher actor', async () => {
    const result = await g.auth.login(subjectOf(s.teacherId), PASSWORD, device('rls-teacher'));

    expect(result.actor.kind).toBe('teacher');
    expect(result.actor.actorId).toBe(s.teacherId);
  });

  it('authenticates a token on a later request', async () => {
    const { accessToken } = await g.auth.login(
      subjectOf(s.parentId),
      PASSWORD,
      device('rls-authenticate'),
    );

    // The path every authenticated request and every socket frame takes: it
    // re-resolves the principal from the database, with no actor context yet.
    const identity = await g.auth.authenticate(accessToken);

    expect(identity).not.toBeNull();
    expect(identity!.actor.actorId).toBe(s.parentId);
    expect(identity!.actor.kind).toBe('contact');
  });

  it('writes the login audit row', async () => {
    const result = await g.auth.login(subjectOf(s.parentId), PASSWORD, device('rls-audit'));

    // Read as the OWNER: chat.audit_log is manager-only to read, and what
    // matters here is that the row EXISTS -- the insert used to be refused by
    // audit_log_organization_isolation, which failed the whole login.
    const [row] = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*)::bigint as n from chat.audit_log
        where action = 'auth.login' and entity_id = '${result.actor.sessionId}'::uuid`,
    );

    expect(Number(row.n)).toBe(1);
  });

  it('refreshes a session', async () => {
    const { refreshToken } = await g.auth.login(
      subjectOf(s.parentId),
      PASSWORD,
      device('rls-refresh'),
    );

    const renewed = await g.auth.refresh(refreshToken, device('rls-refresh'));

    expect(renewed.accessToken).toBeTruthy();
    expect(renewed.actor.actorId).toBe(s.parentId);
  });
});

// -------------------------------------------------------------------------
describe('nothing was widened to make that work', () => {
  it('shows no principal at all without a context', async () => {
    // Unwrapped and outside any context: exactly what a forgotten
    // runAsSubject/runWithActor would produce. If a permissive chat_app policy
    // is ever added to these tables, this is the test that fails.
    const [seen] = await connection.$queryRawUnsafe<
      Array<{ staff: bigint; teacher: bigint; contact: bigint }>
    >(
      `select (select count(*) from chat.staff)   as staff,
              (select count(*) from chat.teacher) as teacher,
              (select count(*) from chat.contact) as contact`,
    );

    expect(Number(seen.staff)).toBe(0);
    expect(Number(seen.teacher)).toBe(0);
    expect(Number(seen.contact)).toBe(0);
  });

  it('keeps another organization invisible inside a subject context', async () => {
    const seen = await app.runAsSubject(subjectOf(s.parentId), async () => ({
      own: await app.contact.count({ where: { id: s.parentId } }),
      foreign: await app.staff.count({ where: { id: foreignStaffId } }),
    }));

    expect(seen.own).toBe(1);
    expect(seen.foreign).toBe(0);
  });

});

// -------------------------------------------------------------------------
describe('login is atomic', () => {
  it('leaves no live session behind when a step after issuance fails', async () => {
    // A principal in the SECOND organization is the honest failure injection
    // here: chat.audit_log.organization_id defaults to
    // chat.default_organization_id(), a CONSTANT, so the table's RESTRICTIVE
    // organization policy refuses the row for any other tenant. That mismatch
    // is a separate migration-level defect and is NOT what this test is about
    // -- it is simply a real failure that happens AFTER the session has been
    // issued, which is exactly the case the single transaction must cover.
    //
    // Before the fix, issuance committed first and the orphan survived: a live
    // session the caller never received and cannot revoke, and enough of them
    // lock the account out on the device limit.
    await expect(
      g.auth.login(foreignSubject, PASSWORD, device('rls-atomic')),
    ).rejects.toThrow();

    const [row] = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*)::bigint as n
         from chat.session s
         join chat.account a on a.id = s.account_id
        where a.subject = '${foreignSubject}' and s.revoked_at is null`,
    );

    expect(Number(row.n)).toBe(0);
  });
});
