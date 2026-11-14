/**
 * App Store / Google Play review accounts (src/cli/review-cohort.ts).
 *
 * Section 1 checks the database the command leaves behind: two logins and only
 * two, in their own organization, staff with no login, upcoming lessons, the
 * chats, no password anywhere but as a hash, nothing written into the default
 * organization, and a second run that changes nothing -- or repairs a locked
 * or deleted parent account, or a teacher account erased at its 30-day
 * deadline (the child moves to the teacher created again).
 *
 * Section 3 (last, it leaves the child elsewhere): a child moved to a live
 * teacher is refused, never moved back.
 *
 * Section 2 signs both accounts in through the real POST /auth/login (no
 * WhatsApp code, no bypass) and checks what each sees and may do over HTTP:
 * their own chats and lessons, and a refusal from every admin route.
 *
 * Synthetic people only (G-20).
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { hashPassword, verifyPassword } from '@platform/auth/password';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { LessonModule } from '../../src/lessons/lesson.module';
import { AdminModule } from '../../src/admin/admin.module';
import { AccountAdminModule } from '../../src/account-admin/account-admin.module';
import {
  REVIEW_AUDIT_ACTION, REVIEW_ORG_SLUG, REVIEW_PEOPLE, REVIEW_REVOKE_REASON, REVIEW_SCHEDULE, ReviewCohortRefusal, provisionReviewCohort, type ReviewCohortManifest, type ReviewCohortOptions,
} from '../../src/cli/review-cohort';
import { parseArgs, publicSummary } from '../../src/cli/provision-review-cohort';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

// Sign-in needs Redis (the login limiter refuses every login without a store).
// Named here, and given back as found, like org-scope-pd8.spec.ts.
const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;

const DOMAIN = 'review.qa.jawwid.test';
const PARENT_PW = 'review-parent-spec-pw-1';
const TEACHER_PW = 'review-teacher-spec-pw-2';

const g = buildGraph();
let opts: ReviewCohortOptions;
let m: ReviewCohortManifest;
let defaultOrg: string;

async function cleanup() {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug = '${REVIEW_ORG_SLUG}')`);
  // Push tokens are stamped with the review organization (registerDevice) and
  // are not among the tables truncate() empties.
  await g.prisma.$executeRawUnsafe(`delete from chat.device_token where organization_id in (select id from chat.organization where slug = '${REVIEW_ORG_SLUG}')`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug = '${REVIEW_ORG_SLUG}'`);
}

/** Row counts, per chat table that carries organization_id, for one organization. */
async function countsFor(organizationId: string): Promise<Record<string, number>> {
  const tables = await g.prisma.$queryRawUnsafe<Array<{ t: string }>>(
    `select table_name as t from information_schema.columns
      where table_schema = 'chat' and column_name = 'organization_id'
        and table_name in (select table_name from information_schema.tables where table_schema = 'chat' and table_type = 'BASE TABLE')
      order by 1`,
  );
  const out: Record<string, number> = {};
  for (const { t } of tables) {
    const [{ n }] = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int as n from chat."${t}" where organization_id = $1::uuid`, organizationId,
    );
    if (n > 0) out[t] = n;
  }
  return out;
}

beforeAll(async () => {
  await g.prisma.$connect();
  await cleanup();
  defaultOrg = (await g.prisma.$queryRaw<{ id: string }[]>`select chat.default_organization_id()::text as id`)[0].id;
  opts = {
    emailDomain: DOMAIN,
    parentPassword: PARENT_PW,
    teacherPassword: TEACHER_PW,
    parentPasswordHash: await hashPassword(PARENT_PW),
    teacherPasswordHash: await hashPassword(TEACHER_PW),
  };
}, 60_000);

afterAll(async () => {
  await cleanup();
  await g.prisma.$disconnect();
}, 60_000);

// ===========================================================================
describe('1. what the command leaves in the database', () => {
  let defaultBefore: Record<string, number>;

  beforeAll(async () => {
    defaultBefore = await countsFor(defaultOrg);
    m = await provisionReviewCohort(g.prisma, opts);
  });

  it('refuses short, shared or command-line passwords and a malformed domain', async () => {
    const refusal = (o: Partial<ReviewCohortOptions>) =>
      provisionReviewCohort(g.prisma, { ...opts, ...o }).then(() => null, (e: unknown) => (e as ReviewCohortRefusal).code);
    expect(await refusal({ parentPassword: 'short' })).toBe('PASSWORD');
    expect(await refusal({ teacherPassword: PARENT_PW })).toBe('PASSWORD');
    expect(await refusal({ emailDomain: 'not a domain' })).toBe('USAGE');
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code: number) => { throw new Error(`exit ${code}`); }) as never);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const secret = 'Distinctive-Secret-77';
      expect(() => parseArgs(['--parent-password', secret])).toThrow('exit 2');
      expect(() => parseArgs(['--password', secret])).toThrow('exit 2');
      // A password typed where no flag is expected is not echoed either.
      expect(() => parseArgs(['--teacher-password-file', '/f', secret])).toThrow('exit 2');
      expect(stderr.mock.calls.length).toBe(3);
      for (const [line] of stderr.mock.calls) expect(String(line)).not.toContain(secret);
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
    }
  });

  it('a separate organization, not the default one', async () => {
    const org = await g.prisma.organization.findUniqueOrThrow({ where: { slug: REVIEW_ORG_SLUG } });
    expect(org.id).toBe(m.organizationId);
    expect(org.id).not.toBe(defaultOrg);
  });

  it('exactly two logins, a parent and a teacher; no staff login and no super admin', async () => {
    const accounts = await g.prisma.account.findMany({ where: { organizationId: m.organizationId } });
    expect(accounts.map((a) => [a.subject, a.kind]).sort()).toEqual([
      [`parent@${DOMAIN}`, 'family'],
      [`teacher@${DOMAIN}`, 'teacher'],
    ]);
    const staff = await g.prisma.staff.findMany({ where: { organizationId: m.organizationId } });
    expect(staff.length).toBe(3);
    expect(staff.every((s) => s.accountId === null)).toBe(true);
    expect(staff.some((s) => s.role === 'super_admin')).toBe(false);
  });

  it('each password is stored only as its own hash', async () => {
    const parent = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: m.parent.accountId } });
    const teacher = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: m.teacher.accountId } });
    expect(await verifyPassword(PARENT_PW, parent.passwordHash)).toBe(true);
    expect(await verifyPassword(TEACHER_PW, teacher.passwordHash)).toBe(true);
    expect(await verifyPassword(TEACHER_PW, parent.passwordHash)).toBe(false);
  });

  it('no password appears in any row the command wrote, nor in what it prints', async () => {
    const tables = Object.keys(await countsFor(m.organizationId));
    for (const t of [...tables, 'audit_log', 'outbox_event']) {
      const [{ n }] = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `select count(*)::int as n from chat."${t}" x where x::text like $1 or x::text like $2`, `%${PARENT_PW}%`, `%${TEACHER_PW}%`,
      );
      expect([t, n]).toEqual([t, 0]);
    }
    const printed = JSON.stringify(publicSummary('localhost:5432/x', m));
    expect(printed).not.toContain(PARENT_PW);
    expect(printed).not.toContain(TEACHER_PW);
    expect(printed).not.toMatch(/argon2/);
  });

  it('the child is taught by the teacher review account, supervised, with no subscription (so never locked)', async () => {
    const learner = await g.prisma.learner.findUniqueOrThrow({ where: { id: m.learnerId } });
    expect(learner.teacherId).toBe(m.teacher.teacherId);
    expect(learner.organizationId).toBe(m.organizationId);
    const supervision = await g.prisma.learnerSupervision.findUniqueOrThrow({ where: { learnerId: m.learnerId } });
    expect(supervision.supervisorId).toBe(m.staff.supervisorId);
    const [{ state }] = await g.prisma.$queryRaw<Array<{ state: string }>>`
      select state from chat.compute_learner_access(${m.learnerId}::uuid)`;
    expect(state).toBe('open');
  });

  it('a standing weekly timetable, and upcoming lessons materialized from it', async () => {
    const slots = await g.prisma.learnerScheduleSlot.findMany({ where: { learnerId: m.learnerId, validTo: null } });
    expect(slots.map((s) => s.weekday).sort()).toEqual(REVIEW_SCHEDULE.slots.map((s) => s.weekday));
    const upcoming = await g.prisma.lesson.findMany({
      where: { learnerId: m.learnerId, startsAt: { gt: new Date() }, outcome: null },
    });
    expect(upcoming.length).toBeGreaterThanOrEqual(3);
    expect(upcoming.every((l) => l.teacherId === m.teacher.teacherId && l.organizationId === m.organizationId)).toBe(true);
  });

  it('the family group seats the parent and the teacher; both have a 1:1 with the supervisor; each has messages', async () => {
    const seats = await g.prisma.conversationMember.findMany({ where: { conversationId: m.familyGroupId, leftAt: null } });
    expect(seats.map((s) => s.actorId)).toEqual(expect.arrayContaining([m.parent.contactId, m.teacher.teacherId, m.staff.supervisorId]));
    for (const id of [m.familyGroupId, m.parentDirectId, m.teacherDirectId]) {
      expect(await g.prisma.message.count({ where: { conversationId: id, type: 'text' } })).toBeGreaterThanOrEqual(2);
    }
  });

  it('nothing was written into the default organization', async () => {
    expect(await countsFor(defaultOrg)).toEqual(defaultBefore);
  });

  it('a second run changes nothing', async () => {
    const before = await countsFor(m.organizationId);
    const again = await provisionReviewCohort(g.prisma, opts);
    expect(again).toEqual({ ...m, parent: { ...m.parent, created: false }, teacher: { ...m.teacher, created: false } });
    expect(await countsFor(m.organizationId)).toEqual(before);
    expect(await countsFor(defaultOrg)).toEqual(defaultBefore);
  });

  it('the production path hashes the passwords itself; an unchanged password writes no new hash', async () => {
    const before = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: m.parent.accountId } });
    await provisionReviewCohort(g.prisma, { emailDomain: DOMAIN, parentPassword: PARENT_PW, teacherPassword: TEACHER_PW });
    const after = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: m.parent.accountId } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('refuses a different login domain before writing anything', async () => {
    const before = await countsFor(m.organizationId);
    await expect(provisionReviewCohort(g.prisma, { ...opts, emailDomain: 'other.qa.jawwid.test' }))
      .rejects.toMatchObject({ code: 'DOMAIN_CHANGED' });
    expect(await countsFor(m.organizationId)).toEqual(before);
  });

  it('every credential change is audited -- that it happened, never what', async () => {
    const rows = await g.prisma.auditLog.findMany({ where: { action: REVIEW_AUDIT_ACTION } });
    expect(rows.map((r) => r.entityId).sort()).toEqual([m.parent.accountId, m.teacher.accountId].sort());
    expect(rows.every((r) => r.actorId === null && (r.after as { passwordSet: boolean }).passwordSet)).toBe(true);
  });

  it('a run clears a lockout and re-sets the password from the file', async () => {
    await g.prisma.accountCredential.update({
      where: { accountId: m.parent.accountId },
      data: { failedAttempts: 10, lockedUntil: new Date(Date.now() + 15 * 60_000), passwordHash: await hashPassword('someone-else-set-this') },
    });
    await provisionReviewCohort(g.prisma, opts);
    const cred = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: m.parent.accountId } });
    expect(cred.failedAttempts).toBe(0);
    expect(cred.lockedUntil).toBeNull();
    expect(await verifyPassword(PARENT_PW, cred.passwordHash)).toBe(true);
  });

  it('a changed password ends the sessions signed in with the old one; an unchanged one ends none', async () => {
    const session = () => g.prisma.session.create({
      data: { organizationId: m.organizationId, accountId: m.teacher.accountId, refreshTokenHash: `review-spec-${Date.now()}-${Math.random()}`, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const kept = await session();
    await provisionReviewCohort(g.prisma, opts);
    expect((await g.prisma.session.findUniqueOrThrow({ where: { id: kept.id } })).revokedAt).toBeNull();
    const rotated = 'review-teacher-spec-pw-rotated';
    await provisionReviewCohort(g.prisma, { ...opts, teacherPassword: rotated, teacherPasswordHash: await hashPassword(rotated) });
    expect((await g.prisma.session.findUniqueOrThrow({ where: { id: kept.id } })).revokedReason).toBe(REVIEW_REVOKE_REASON);
    await provisionReviewCohort(g.prisma, opts);
    const cred = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: m.teacher.accountId } });
    expect(await verifyPassword(TEACHER_PW, cred.passwordHash)).toBe(true);
  });

  it('a parent account a reviewer deleted is created again, with its seats back; the child and the family stay', async () => {
    await g.prisma.$queryRaw`select chat.erase_account(${m.parent.accountId}::uuid, 'review spec', '{}'::text[])`;
    const after = await provisionReviewCohort(g.prisma, opts);
    expect(after.parent.created).toBe(true);
    expect(after.parent.accountId).not.toBe(m.parent.accountId);
    expect(after.parent.contactId).not.toBe(m.parent.contactId);
    expect(after.familyId).toBe(m.familyId);
    expect(after.learnerId).toBe(m.learnerId);
    expect(after.familyGroupId).toBe(m.familyGroupId);
    const seat = await g.prisma.conversationMember.findFirst({
      where: { conversationId: m.familyGroupId, actorId: after.parent.contactId, leftAt: null },
    });
    expect(seat).not.toBeNull();
    const family = await g.prisma.family.findUniqueOrThrow({ where: { id: m.familyId } });
    expect(family.primaryContactId).toBe(after.parent.contactId);
    expect(await g.prisma.account.count({ where: { organizationId: m.organizationId, isActive: true } })).toBe(2);
    // The sample lines are not sent a second time by the new parent.
    const lines = await g.prisma.message.findMany({ where: { conversationId: m.familyGroupId, clientMessageId: { startsWith: 'review-' } } });
    expect(new Set(lines.map((l) => l.clientMessageId)).size).toBe(lines.length);
    expect(await countsFor(defaultOrg)).toEqual(defaultBefore);
    m = after;
  });

  it('the teacher review account is not deleted at once while the child is assigned to it', async () => {
    await expect(
      g.prisma.$queryRaw`select chat.erase_account(${m.teacher.accountId}::uuid, 'review spec', '{}'::text[])`,
    ).rejects.toThrow(/TEACHER_DELETION_BLOCKED/);
  });

  it('a teacher account erased at its 30-day deadline is created again, and the child moves to it', async () => {
    // A reviewer's request (PD-56 O-3), made 31 days ago so it is due: written
    // with the guard off, as the PD-56 suite writes its past requests, and its
    // task raised the normal way. Then the worker's own completion.
    const requestId = await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      const [r] = await tx.$queryRaw<Array<{ id: string }>>`
        insert into chat.account_deletion_request (organization_id, account_id, teacher_id, requested_at, deadline_at, open_items)
        values (${m.organizationId}::uuid, ${m.teacher.accountId}::uuid, ${m.teacher.teacherId}::uuid,
                now() - interval '744 hours', now() - interval '24 hours', '{future_lessons,assigned_learners}')
        returning id::text as id`;
      return r!.id;
    });
    await g.prisma.$queryRaw`
      select chat.work_task_raise(${m.organizationId}::uuid, 'teacher_deletion_request', ${requestId}::uuid,
                                  ${m.staff.teachersManagerId}::uuid, null, 'high', 'operational', 'generic',
                                  now() - interval '24 hours')::text`;
    await g.prisma.$queryRaw`select chat.complete_account_deletion_request(${requestId}::uuid, null, 'deadline')::text`;
    const erased = await g.prisma.account.findUniqueOrThrow({ where: { id: m.teacher.accountId } });
    expect(erased.subject).toBe(`erased:${erased.id}`);
    // The erasure leaves the child on the erased teacher ("Deleted user").
    expect((await g.prisma.learner.findUniqueOrThrow({ where: { id: m.learnerId } })).teacherId).toBe(m.teacher.teacherId);

    const after = await provisionReviewCohort(g.prisma, opts);
    expect(after.teacher.created).toBe(true);
    expect(after.teacher.accountId).not.toBe(m.teacher.accountId);
    expect(after.teacher.teacherId).not.toBe(m.teacher.teacherId);
    expect(after.learnerId).toBe(m.learnerId);
    expect(after.familyGroupId).toBe(m.familyGroupId);
    expect((await g.prisma.learner.findUniqueOrThrow({ where: { id: m.learnerId } })).teacherId).toBe(after.teacher.teacherId);

    // Moved the way a Teachers manager moves a learner, and recorded as such.
    const transfers = await g.prisma.learnerTransfer.findMany({ where: { learnerId: m.learnerId } });
    expect(transfers).toEqual([expect.objectContaining({
      fromTeacherId: m.teacher.teacherId, toTeacherId: after.teacher.teacherId, decidedBy: m.staff.teachersManagerId,
    })]);

    // The family group seats the new teacher; the erased one's seat stays closed.
    const seats = await g.prisma.conversationMember.findMany({ where: { conversationId: m.familyGroupId, leftAt: null } });
    expect(seats.map((s) => s.actorId)).toEqual(expect.arrayContaining([after.teacher.teacherId, after.parent.contactId]));
    expect(seats.map((s) => s.actorId)).not.toContain(m.teacher.teacherId);

    // Weekly times again, with the new teacher; every lesson ahead is theirs, none twice.
    const slots = await g.prisma.learnerScheduleSlot.findMany({ where: { learnerId: m.learnerId, validTo: null } });
    expect(slots.map((s) => s.weekday).sort()).toEqual(REVIEW_SCHEDULE.slots.map((s) => s.weekday));
    expect(slots.every((s) => s.teacherId === after.teacher.teacherId)).toBe(true);
    const upcoming = await g.prisma.lesson.findMany({ where: { learnerId: m.learnerId, startsAt: { gt: new Date() }, outcome: null } });
    expect(upcoming.length).toBeGreaterThanOrEqual(3);
    expect(upcoming.every((l) => l.teacherId === after.teacher.teacherId)).toBe(true);
    expect(new Set(upcoming.map((l) => l.startsAt.toISOString())).size).toBe(upcoming.length);

    // The erasure's learner_needs_teacher task settles itself on the next sweep.
    const [{ r }] = await g.prisma.$queryRaw<Array<{ r: { handoversSettled: number } }>>`select chat.erased_teacher_sweep(50) as r`;
    expect(r.handoversSettled).toBeGreaterThanOrEqual(1);

    expect(await g.prisma.account.count({ where: { organizationId: m.organizationId, isActive: true } })).toBe(2);
    expect(await countsFor(defaultOrg)).toEqual(defaultBefore);

    // And the run after it changes nothing.
    const before = await countsFor(m.organizationId);
    const again = await provisionReviewCohort(g.prisma, opts);
    expect(again).toEqual({ ...after, parent: { ...after.parent, created: false }, teacher: { ...after.teacher, created: false } });
    expect(await countsFor(m.organizationId)).toEqual(before);
    m = after;
  });
});

// ===========================================================================
describe('2. over HTTP, as a store reviewer', () => {
  let app: INestApplication;
  let base: string;
  const tokens = new Map<string, string>();
  let defaultBefore: Record<string, number>;

  beforeAll(async () => {
    if (!m) m = await provisionReviewCohort(g.prisma, opts);
    defaultBefore = await countsFor(defaultOrg);
    process.env.REDIS_URL = REDIS_URL;
    const moduleRef = await Test.createTestingModule({
      imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, AdminModule, AccountAdminModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false, rawBody: true });
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
    app.useGlobalFilters(new CommErrorFilter());
    applyInfrastructure(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
  });

  afterAll(async () => {
    const presence = app?.get<Redis>(REDIS_CLIENT);
    await app?.close();
    for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
    if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = inheritedRedisUrl;
  });

  async function login(username: string, password: string) {
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  }
  async function as(who: 'parent' | 'teacher', method: string, path: string, body?: unknown) {
    if (!tokens.has(who)) {
      const r = await login(`${who}@${DOMAIN}`, who === 'parent' ? PARENT_PW : TEACHER_PW);
      expect(r.status).toBe(200);
      tokens.set(who, r.json.accessToken as string);
    }
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${tokens.get(who)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  }
  const ids = (json: Record<string, unknown>) => (json.conversations as Array<{ id: string }>).map((c) => c.id);

  it('both sign in with email and password alone -- no code is asked for', async () => {
    for (const [who, pw] of [['parent', PARENT_PW], ['teacher', TEACHER_PW]] as const) {
      const r = await login(`${who}@${DOMAIN}`, pw);
      expect(r.status).toBe(200);
      expect(String(r.json.accessToken).split('.')).toHaveLength(3);
    }
    expect((await login(`parent@${DOMAIN}`, TEACHER_PW)).status).toBe(401);
  });

  it('the parent sees the family group and the 1:1 with the supervisor, and nothing else', async () => {
    const r = await as('parent', 'GET', '/conversations');
    expect(r.status).toBe(200);
    expect(new Set(ids(r.json))).toEqual(new Set([m.familyGroupId, m.parentDirectId]));
  });

  it('the teacher sees the family group and the 1:1 with the supervisor, and nothing else', async () => {
    const r = await as('teacher', 'GET', '/conversations');
    expect(r.status).toBe(200);
    expect(new Set(ids(r.json))).toEqual(new Set([m.familyGroupId, m.teacherDirectId]));
  });

  it("both see the child's upcoming lessons", async () => {
    for (const who of ['parent', 'teacher'] as const) {
      const r = await as(who, 'GET', `/lessons?learnerId=${m.learnerId}`);
      expect(r.status).toBe(200);
      const lessons = (r.json.lessons ?? r.json) as Array<{ startsAt: string }>;
      expect(lessons.filter((l) => Date.parse(l.startsAt) > Date.now()).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('the parent and the teacher can message each other in the family group', async () => {
    for (const who of ['parent', 'teacher'] as const) {
      const r = await as(who, 'POST', `/conversations/${m.familyGroupId}/messages`, {
        body: `hello from the ${who}`, clientMessageId: `review-spec-${who}`,
      });
      expect([200, 201]).toContain(r.status);
    }
  });

  it('every admin route refuses both accounts', async () => {
    for (const who of ['parent', 'teacher'] as const) {
      for (const path of ['/admin/overview', '/admin/users', '/admin/conversations']) {
        const r = await as(who, 'GET', path);
        expect([who, path, r.status]).toEqual([who, path, 403]);
      }
    }
  });

  it('both register a phone for push, stamped with the review organization', async () => {
    for (const who of ['parent', 'teacher'] as const) {
      const token = `review-spec-device-${who}`;
      const r = await as(who, 'POST', '/notifications/devices', { token, platform: 'ios', isVoip: false });
      expect([200, 201, 204]).toContain(r.status);
      const row = await g.prisma.deviceToken.findUniqueOrThrow({ where: { token } });
      expect(row.organizationId).toBe(m.organizationId);
    }
  });

  it('account administration and staff-only lesson routes refuse both accounts', async () => {
    for (const who of ['parent', 'teacher'] as const) {
      const other = who === 'parent' ? m.teacher.accountId : m.parent.accountId;
      for (const [method, path, body] of [
        ['GET', '/admin/accounts', undefined],
        ['POST', `/admin/accounts/${other}/password-reset`, { reason: 'review spec' }],
        ['GET', '/admin/family-access-grants', undefined],
        ['POST', `/teachers/${m.teacher.teacherId}/availability`, { timezone: 'Africa/Cairo', windows: [] }],
        ['POST', `/learners/${m.learnerId}/schedule`, { slots: [] }],
      ] as const) {
        const r = await as(who, method, path, body);
        expect([who, path, r.status >= 400 && r.status < 500 && r.status !== 404 ? 'refused' : r.status])
          .toEqual([who, path, 'refused']);
      }
    }
  });

  it("nothing the reviewers did (sign-in, reading, messaging, push) wrote into the default organization", async () => {
    expect(await countsFor(defaultOrg)).toEqual(defaultBefore);
  });
});

// ===========================================================================
// Last: it leaves the child with another teacher.
describe('3. a child moved to a live teacher is never moved back by a run', () => {
  // B10 P3-3: TEACHER_CHANGED (moveChildFromErasedTeacher) must stay exercised even where an earlier guard refuses
  // most live teachers. A live teacher that merely carries the review teacher's NAME (and has no login) is not an
  // erased teacher of the review organization, so the run refuses it with TEACHER_CHANGED, before moving anyone.
  it('a live teacher with the review teacher\u2019s name is not an erased one: the run refuses (TEACHER_CHANGED)', async () => {
    if (!m) m = await provisionReviewCohort(g.prisma, opts);
    const same = await g.prisma.teacher.create({
      data: { organizationId: m.organizationId, name: REVIEW_PEOPLE.teacher, isActive: true },
    });
    await g.prisma.$queryRaw`
      select count(*)::int as n
        from chat.transfer_learner(${m.learnerId}::uuid, ${same.id}::uuid, 'other', 'review spec', null, ${m.staff.teachersManagerId}::uuid)`;
    try {
      await expect(provisionReviewCohort(g.prisma, opts)).rejects.toMatchObject({ code: 'TEACHER_CHANGED' });
      expect((await g.prisma.learner.findUniqueOrThrow({ where: { id: m.learnerId } })).teacherId).toBe(same.id);
    } finally {
      // Put the child back with the real review teacher so the next test starts from the cohort's own state.
      await g.prisma.$queryRaw`
        select count(*)::int as n
          from chat.transfer_learner(${m.learnerId}::uuid, ${m.teacher.teacherId}::uuid, 'other', 'review spec restore', null, ${m.staff.teachersManagerId}::uuid)`;
    }
    expect((await g.prisma.learner.findUniqueOrThrow({ where: { id: m.learnerId } })).teacherId).toBe(m.teacher.teacherId);
  });

  it('the run refuses (TEACHER_CHANGED) and changes no assignment', async () => {
    if (!m) m = await provisionReviewCohort(g.prisma, opts);
    const other = await g.prisma.teacher.create({
      data: { organizationId: m.organizationId, name: 'Live Other Teacher', isActive: true },
    });
    await g.prisma.$queryRaw`
      select count(*)::int as n
        from chat.transfer_learner(${m.learnerId}::uuid, ${other.id}::uuid, 'other', 'review spec', null, ${m.staff.teachersManagerId}::uuid)`;
    await expect(provisionReviewCohort(g.prisma, opts)).rejects.toMatchObject({ code: 'TEACHER_CHANGED' });
    expect((await g.prisma.learner.findUniqueOrThrow({ where: { id: m.learnerId } })).teacherId).toBe(other.id);
  });
});
