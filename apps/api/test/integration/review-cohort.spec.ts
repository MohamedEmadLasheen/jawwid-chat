/**
 * App Store / Google Play review accounts (src/cli/review-cohort.ts).
 *
 * Section 1 checks the database the command leaves behind: three logins and
 * only three (a parent, a teacher, and a disposable parent for the deletion
 * test with its own family), in their own organization, staff with no login,
 * upcoming lessons, the chats, no password anywhere but as a hash, nothing
 * written into the default organization, and a second run that changes
 * nothing -- or repairs a locked or deleted parent account.
 *
 * Section 2 signs all three accounts in through the real POST /auth/login (no
 * WhatsApp code, no bypass) and checks what each sees and may do over HTTP:
 * their own chats and lessons, and a refusal from every admin route.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
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
import { BillingModule } from '../../src/billing/billing.module';
import {
  REVIEW_AUDIT_ACTION, REVIEW_DELETION_PEOPLE, REVIEW_ORG_NAME, REVIEW_ORG_SLUG, REVIEW_STAFF, REVIEW_REVOKE_REASON, REVIEW_SCHEDULE, ReviewCohortRefusal, provisionReviewCohort, type ReviewCohortManifest, type ReviewCohortOptions,
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
const DELETION_PW = 'review-parent2-spec-pw-3';

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
    deletionParentPassword: DELETION_PW,
    parentPasswordHash: await hashPassword(PARENT_PW),
    teacherPasswordHash: await hashPassword(TEACHER_PW),
    deletionParentPasswordHash: await hashPassword(DELETION_PW),
  };
}, 60_000);

afterAll(async () => {
  await cleanup();
  await g.prisma.$disconnect();
}, 60_000);

// ===========================================================================
describe('0. it writes only into a review organization, and never takes an account from another', () => {
  // Each case starts and ends with no review organization, so section 1
  // still begins from nothing.
  beforeEach(cleanup);
  afterEach(cleanup);

  const refusalOf = (o: ReviewCohortOptions = opts) =>
    provisionReviewCohort(g.prisma, o).then(() => null, (e: unknown) => {
      if (!(e instanceof ReviewCohortRefusal)) throw e;
      return e.code;
    });

  it('refuses an organization that has the slug but not the name it creates, and writes nothing into it', async () => {
    const org = await g.prisma.organization.create({ data: { slug: REVIEW_ORG_SLUG, displayName: 'Al-Noor Academy' } });
    expect(await refusalOf()).toBe('NOT_REVIEW_ORGANIZATION');
    expect(await countsFor(org.id)).toEqual({});
    expect((await g.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).displayName).toBe('Al-Noor Academy');
    expect(await g.prisma.account.count({ where: { subject: { endsWith: `@${DOMAIN}` } } })).toBe(0);
  });

  it('refuses the right slug and name when the organization holds anyone outside the review cohort', async () => {
    const outsiders: Array<[string, (orgId: string) => Promise<unknown>]> = [
      ['a staff login', (orgId) => g.prisma.account.create({
        data: { organizationId: orgId, subject: 'owner@alnoor.example', kind: 'staff', status: 'active', isActive: true },
      })],
      ['a parent with another email', (orgId) => g.prisma.account.create({
        data: { organizationId: orgId, subject: 'mother@alnoor.example', kind: 'family', status: 'active', isActive: true },
      })],
      ['a review email of the wrong kind', (orgId) => g.prisma.account.create({
        data: { organizationId: orgId, subject: `teacher@${DOMAIN}`, kind: 'family', status: 'active', isActive: true },
      })],
      ['a member of staff the command never makes', (orgId) => g.prisma.staff.create({
        data: { organizationId: orgId, name: 'Real Supervisor', role: 'admin', isActive: true },
      })],
      ['a teacher the command never makes', (orgId) => g.prisma.teacher.create({
        data: { organizationId: orgId, name: 'Real Teacher', isActive: true },
      })],
      // The erased-teacher name alone is not a pass: only an erased account is.
      ['a "Deleted user" teacher with no account', (orgId) => g.prisma.teacher.create({
        data: { organizationId: orgId, name: 'Deleted user', isActive: true },
      })],
      ['a "Deleted user" teacher on a live login', async (orgId) => {
        const live = await g.prisma.account.create({
          data: { organizationId: orgId, subject: `teacher@${DOMAIN}`, kind: 'teacher', status: 'active', isActive: true },
        });
        return g.prisma.teacher.create({ data: { organizationId: orgId, name: 'Deleted user', isActive: true, accountId: live.id } });
      }],
      ['a family the command never makes', async (orgId) => {
        const owner = await g.prisma.staff.create({
          data: { organizationId: orgId, name: REVIEW_STAFF.supervisor.name, role: REVIEW_STAFF.supervisor.role, isActive: true },
        });
        return g.prisma.family.create({ data: { organizationId: orgId, displayName: 'Real family', ownerId: owner.id, language: 'en' } });
      }],
    ];
    for (const [who, add] of outsiders) {
      await cleanup();
      const org = await g.prisma.organization.create({ data: { slug: REVIEW_ORG_SLUG, displayName: REVIEW_ORG_NAME } });
      await add(org.id);
      const before = await countsFor(org.id);
      expect([who, await refusalOf()]).toEqual([who, 'NOT_REVIEW_ORGANIZATION']);
      expect([who, await countsFor(org.id)]).toEqual([who, before]);
      expect([who, await g.prisma.accountCredential.count({ where: { account: { organizationId: org.id } } })]).toEqual([who, 0]);
    }
  });

  it('an organization it made itself, holding only the review cohort, is accepted again', async () => {
    const first = await provisionReviewCohort(g.prisma, opts);
    // A deleted (erased) parent stays behind as an erased account; that is still the cohort.
    await g.prisma.$queryRaw`select chat.erase_account(${first.deletionParent.accountId}::uuid, 'review spec', '{}'::text[])`;
    const again = await provisionReviewCohort(g.prisma, opts);
    expect(again.organizationId).toBe(first.organizationId);
  });

  it('a teacher whose account was erased (kept as "Deleted user") is still the cohort, and the run goes on', async () => {
    // Teacher erasure is not reachable through chat.erase_account here (the
    // review child blocks it), so the state it leaves is set up directly:
    // the row renamed "Deleted user", its login renamed erased:<id> and out of service.
    const org = await g.prisma.organization.create({ data: { slug: REVIEW_ORG_SLUG, displayName: REVIEW_ORG_NAME } });
    const erasedId = randomUUID();
    await g.prisma.account.create({
      data: {
        id: erasedId, organizationId: org.id, subject: `erased:${erasedId}`, kind: 'teacher',
        status: 'deactivated', isActive: false, deactivatedAt: new Date(),
      },
    });
    const gone = await g.prisma.teacher.create({
      data: { organizationId: org.id, name: 'Deleted user', isActive: false, accountId: erasedId },
    });
    const made = await provisionReviewCohort(g.prisma, opts);
    expect(made.organizationId).toBe(org.id);
    expect(made.teacher.teacherId).not.toBe(gone.id);
    // The erased row is left as erasure left it.
    const after = await g.prisma.teacher.findUniqueOrThrow({ where: { id: gone.id } });
    expect([after.name, after.accountId, after.isActive]).toEqual(['Deleted user', erasedId, false]);
  });

  it('refuses, and does not move, a review email that already belongs to another organization (SUBJECT_TAKEN)', async () => {
    const other = await g.prisma.organization.create({ data: { slug: 'review-spec-elsewhere', displayName: 'Elsewhere Academy' } });
    try {
      for (const [key, kind] of [['teacher', 'teacher'], ['parent', 'family'], ['parent2', 'family']] as const) {
        await cleanup();
        const subject = `${key}@${DOMAIN}`;
        const taken = await g.prisma.account.create({
          data: { organizationId: other.id, subject, kind, status: 'active', isActive: true },
        });
        expect([key, await refusalOf()]).toEqual([key, 'SUBJECT_TAKEN']);
        const after = await g.prisma.account.findUniqueOrThrow({ where: { id: taken.id } });
        // Not moved, not activated differently, not given a password, not seated anywhere.
        expect([key, after.organizationId, after.subject, after.kind]).toEqual([key, other.id, subject, kind]);
        expect([key, await g.prisma.accountCredential.count({ where: { accountId: taken.id } })]).toEqual([key, 0]);
        expect([key, await g.prisma.contact.count({ where: { accountId: taken.id } })]).toEqual([key, 0]);
        expect([key, await g.prisma.teacher.count({ where: { accountId: taken.id } })]).toEqual([key, 0]);
        expect([key, await g.prisma.auditLog.count({ where: { action: REVIEW_AUDIT_ACTION, entityId: taken.id } })]).toEqual([key, 0]);
        // The run stopped before the disposable parent: the review organization has no parent2 password.
        expect([key, await g.prisma.accountCredential.count({
          where: { account: { subject: `parent2@${DOMAIN}`, NOT: { organizationId: other.id } } },
        })]).toEqual([key, 0]);
      }
    } finally {
      await g.prisma.account.deleteMany({ where: { organizationId: other.id } });
      await g.prisma.organization.delete({ where: { id: other.id } });
    }
  });
});

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
    expect(await refusal({ deletionParentPassword: 'short' })).toBe('PASSWORD');
    expect(await refusal({ deletionParentPassword: PARENT_PW })).toBe('PASSWORD');
    expect(await refusal({ deletionParentPassword: TEACHER_PW })).toBe('PASSWORD');
    expect(await refusal({ deletionParentPassword: undefined as unknown as string })).toBe('PASSWORD');
    expect(await refusal({ emailDomain: 'not a domain' })).toBe('USAGE');
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code: number) => { throw new Error(`exit ${code}`); }) as never);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const secret = 'Distinctive-Secret-77';
      expect(() => parseArgs(['--parent-password', secret])).toThrow('exit 2');
      expect(() => parseArgs(['--password', secret])).toThrow('exit 2');
      expect(() => parseArgs(['--deletion-parent-password', secret])).toThrow('exit 2');
      // A password typed where no flag is expected is not echoed either.
      expect(() => parseArgs(['--teacher-password-file', '/f', secret])).toThrow('exit 2');
      expect(() => parseArgs(['--deletion-parent-password-file', '/f', secret])).toThrow('exit 2');
      expect(stderr.mock.calls.length).toBe(5);
      for (const [line] of stderr.mock.calls) expect(String(line)).not.toContain(secret);
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
    }
    // The three password files are parsed into their own fields.
    expect(parseArgs([
      '--parent-password-file', '/a', '--teacher-password-file', '/b', '--deletion-parent-password-file', '/c',
    ])).toMatchObject({ parentPasswordFile: '/a', teacherPasswordFile: '/b', deletionParentPasswordFile: '/c' });
  });

  it('a separate organization, not the default one', async () => {
    const org = await g.prisma.organization.findUniqueOrThrow({ where: { slug: REVIEW_ORG_SLUG } });
    expect(org.id).toBe(m.organizationId);
    expect(org.id).not.toBe(defaultOrg);
  });

  it('exactly three logins, two parents and a teacher; no staff login and no super admin', async () => {
    const accounts = await g.prisma.account.findMany({ where: { organizationId: m.organizationId } });
    expect(accounts.map((a) => [a.subject, a.kind]).sort()).toEqual([
      [`parent2@${DOMAIN}`, 'family'],
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
    const deletion = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: m.deletionParent.accountId } });
    expect(await verifyPassword(DELETION_PW, deletion.passwordHash)).toBe(true);
    expect(await verifyPassword(PARENT_PW, deletion.passwordHash)).toBe(false);
  });

  it('no password appears in any row the command wrote, nor in what it prints', async () => {
    const tables = Object.keys(await countsFor(m.organizationId));
    for (const t of [...tables, 'audit_log', 'outbox_event']) {
      const [{ n }] = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `select count(*)::int as n from chat."${t}" x where x::text like $1 or x::text like $2 or x::text like $3`,
        `%${PARENT_PW}%`, `%${TEACHER_PW}%`, `%${DELETION_PW}%`,
      );
      expect([t, n]).toEqual([t, 0]);
    }
    const printed = JSON.stringify(publicSummary('localhost:5432/x', m));
    expect(printed).not.toContain(PARENT_PW);
    expect(printed).not.toContain(TEACHER_PW);
    expect(printed).not.toContain(DELETION_PW);
    expect(printed).not.toMatch(/argon2/);
    expect(printed).toContain(`parent2@${DOMAIN}`);
  });

  it('the disposable parent has its own family and child, no teacher, no lessons, and only a 1:1 with the supervisor', async () => {
    const d = m.deletionParent;
    expect(d.subject).toBe(`parent2@${DOMAIN}`);
    expect(d.created).toBe(true);
    expect(d.familyId).not.toBe(m.familyId);
    const family = await g.prisma.family.findUniqueOrThrow({ where: { id: d.familyId } });
    expect(family.organizationId).toBe(m.organizationId);
    expect(family.displayName).toBe(REVIEW_DELETION_PEOPLE.family);
    expect(family.primaryContactId).toBe(d.contactId);
    const contact = await g.prisma.contact.findUniqueOrThrow({ where: { id: d.contactId } });
    expect([contact.accountId, contact.rolePreset, contact.name]).toEqual([d.accountId, 'primary_guardian', REVIEW_DELETION_PEOPLE.parent]);
    const learner = await g.prisma.learner.findUniqueOrThrow({ where: { id: d.learnerId } });
    expect([learner.familyId, learner.name, learner.teacherId]).toEqual([d.familyId, REVIEW_DELETION_PEOPLE.child, null]);
    expect((await g.prisma.learnerSupervision.findUniqueOrThrow({ where: { learnerId: d.learnerId } })).supervisorId)
      .toBe(m.staff.supervisorId);
    expect(await g.prisma.lesson.count({ where: { learnerId: d.learnerId } })).toBe(0);
    expect(await g.prisma.learnerScheduleSlot.count({ where: { learnerId: d.learnerId } })).toBe(0);
    // Its only conversation is the 1:1 with the supervisor, which has the sample lines.
    const seats = await g.prisma.conversationMember.findMany({ where: { actorId: d.contactId, leftAt: null } });
    expect(seats.map((s) => s.conversationId)).toEqual([d.directId]);
    expect(await g.prisma.message.count({ where: { conversationId: d.directId, type: 'text' } })).toBeGreaterThanOrEqual(2);
    // It shares nothing with the review family's conversations.
    for (const id of [m.familyGroupId, m.parentDirectId, m.teacherDirectId]) {
      expect(await g.prisma.conversationMember.count({ where: { conversationId: id, actorId: d.contactId } })).toBe(0);
    }
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

  it('nothing payable: no package, instalment, payment request or invoice for either review family (OA-12 default)', async () => {
    // The recommended default for OA-12 is no in-app payment step for review:
    // a reviewer sees no amount due, and the review notes say so
    // (docs/release/review-accounts.md, "No payments").
    const familyId = { in: [m.familyId, m.deletionParent.familyId] };
    expect({
      packages: await g.prisma.learnerSubscription.count({ where: { familyId } }),
      instalments: await g.prisma.familyInstalment.count({ where: { familyId } }),
      requests: await g.prisma.paymentRequest.count({ where: { familyId } }),
      invoices: await g.prisma.invoice.count({ where: { familyId } }),
    }).toEqual({ packages: 0, instalments: 0, requests: 0, invoices: 0 });
    // Nor anything in the review organization that names neither family.
    const tables = Object.keys(await countsFor(m.organizationId));
    for (const t of ['learner_subscription', 'family_instalment', 'payment_request', 'invoice', 'payment']) {
      expect([t, tables.includes(t)]).toEqual([t, false]);
    }
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
    expect(again).toEqual({
      ...m,
      parent: { ...m.parent, created: false },
      teacher: { ...m.teacher, created: false },
      deletionParent: { ...m.deletionParent, created: false },
    });
    expect(await countsFor(m.organizationId)).toEqual(before);
    expect(await countsFor(defaultOrg)).toEqual(defaultBefore);
  });

  it('the production path hashes the passwords itself; an unchanged password writes no new hash', async () => {
    const before = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: m.parent.accountId } });
    const deletionBefore = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: m.deletionParent.accountId } });
    await provisionReviewCohort(g.prisma, {
      emailDomain: DOMAIN, parentPassword: PARENT_PW, teacherPassword: TEACHER_PW, deletionParentPassword: DELETION_PW,
    });
    const after = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: m.parent.accountId } });
    expect(after.passwordHash).toBe(before.passwordHash);
    const deletionAfter = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: m.deletionParent.accountId } });
    expect(deletionAfter.passwordHash).toBe(deletionBefore.passwordHash);
  });

  it('refuses a different login domain before writing anything', async () => {
    const before = await countsFor(m.organizationId);
    await expect(provisionReviewCohort(g.prisma, { ...opts, emailDomain: 'other.qa.jawwid.test' }))
      .rejects.toMatchObject({ code: 'DOMAIN_CHANGED' });
    expect(await countsFor(m.organizationId)).toEqual(before);
  });

  it('every credential change is audited -- that it happened, never what', async () => {
    const rows = await g.prisma.auditLog.findMany({ where: { action: REVIEW_AUDIT_ACTION } });
    expect(rows.map((r) => r.entityId).sort())
      .toEqual([m.parent.accountId, m.teacher.accountId, m.deletionParent.accountId].sort());
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
    expect(await g.prisma.account.count({ where: { organizationId: m.organizationId, isActive: true } })).toBe(3);
    // The sample lines are not sent a second time by the new parent.
    const lines = await g.prisma.message.findMany({ where: { conversationId: m.familyGroupId, clientMessageId: { startsWith: 'review-' } } });
    expect(new Set(lines.map((l) => l.clientMessageId)).size).toBe(lines.length);
    expect(await countsFor(defaultOrg)).toEqual(defaultBefore);
    m = after;
  });

  it('the disposable parent, deleted by a reviewer, is created again in its own family; the other two accounts are untouched', async () => {
    const before = m.deletionParent;
    const othersBefore = { parent: m.parent, teacher: m.teacher, familyGroupId: m.familyGroupId };
    await g.prisma.$queryRaw`select chat.erase_account(${before.accountId}::uuid, 'review spec', '{}'::text[])`;
    // Deleted: the login is gone and its email is free.
    expect(await g.prisma.account.findUnique({ where: { subject: `parent2@${DOMAIN}` } })).toBeNull();

    const after = await provisionReviewCohort(g.prisma, opts);
    expect(after.deletionParent.created).toBe(true);
    expect(after.deletionParent.subject).toBe(`parent2@${DOMAIN}`);
    expect(after.deletionParent.accountId).not.toBe(before.accountId);
    expect(after.deletionParent.contactId).not.toBe(before.contactId);
    expect(after.deletionParent.familyId).toBe(before.familyId);
    expect(after.deletionParent.learnerId).toBe(before.learnerId);
    const family = await g.prisma.family.findUniqueOrThrow({ where: { id: before.familyId } });
    expect(family.primaryContactId).toBe(after.deletionParent.contactId);
    const cred = await g.prisma.accountCredential.findUniqueOrThrow({ where: { accountId: after.deletionParent.accountId } });
    expect(await verifyPassword(DELETION_PW, cred.passwordHash)).toBe(true);
    // A fresh 1:1 with the supervisor, with the sample lines, for the new parent.
    const seat = await g.prisma.conversationMember.findFirst({
      where: { conversationId: after.deletionParent.directId, actorId: after.deletionParent.contactId, leftAt: null },
    });
    expect(seat).not.toBeNull();
    expect(await g.prisma.message.count({ where: { conversationId: after.deletionParent.directId, type: 'text' } }))
      .toBeGreaterThanOrEqual(2);
    // The parent and the teacher review accounts are exactly as they were.
    expect({ parent: after.parent, teacher: after.teacher, familyGroupId: after.familyGroupId })
      .toEqual({ ...othersBefore, parent: { ...othersBefore.parent, created: false }, teacher: { ...othersBefore.teacher, created: false } });
    expect(await g.prisma.account.count({ where: { organizationId: m.organizationId, isActive: true } })).toBe(3);
    expect(await countsFor(defaultOrg)).toEqual(defaultBefore);

    // And a run after that changes nothing again.
    const settled = await countsFor(m.organizationId);
    const again = await provisionReviewCohort(g.prisma, opts);
    expect(again.deletionParent).toEqual({ ...after.deletionParent, created: false });
    expect(await countsFor(m.organizationId)).toEqual(settled);
    m = again;
  });

  it('the teacher review account cannot be deleted while the child is assigned to it', async () => {
    await expect(
      g.prisma.$queryRaw`select chat.erase_account(${m.teacher.accountId}::uuid, 'review spec', '{}'::text[])`,
    ).rejects.toThrow(/TEACHER_DELETION_BLOCKED/);
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
      imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, AdminModule, AccountAdminModule, BillingModule],
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
  const PASSWORDS = { parent: PARENT_PW, teacher: TEACHER_PW, parent2: DELETION_PW } as const;
  async function as(who: keyof typeof PASSWORDS, method: string, path: string, body?: unknown) {
    if (!tokens.has(who)) {
      const r = await login(`${who}@${DOMAIN}`, PASSWORDS[who]);
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

  it('all three sign in with email and password alone -- no code is asked for', async () => {
    for (const [who, pw] of Object.entries(PASSWORDS)) {
      const r = await login(`${who}@${DOMAIN}`, pw);
      expect(r.status).toBe(200);
      expect(String(r.json.accessToken).split('.')).toHaveLength(3);
    }
    expect((await login(`parent@${DOMAIN}`, TEACHER_PW)).status).toBe(401);
    expect((await login(`parent2@${DOMAIN}`, PARENT_PW)).status).toBe(401);
  });

  it('the disposable parent sees only its 1:1 with the supervisor', async () => {
    const r = await as('parent2', 'GET', '/conversations');
    expect(r.status).toBe(200);
    expect(ids(r.json)).toEqual([m.deletionParent.directId]);
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

  it("neither parent has an amount due on the payments tab (OA-12 default: no in-app payment step for review)", async () => {
    // GET /me/billing is what the app's payments tab reads; its "Amount due"
    // lists only open requests and unpaid instalments (amount_due.dart).
    for (const who of ['parent', 'parent2'] as const) {
      const r = await as(who, 'GET', '/me/billing');
      expect([who, r.status]).toEqual([who, 200]);
      const subscriptions = (r.json.subscriptions ?? []) as Array<{ hasOpenPayment?: boolean }>;
      expect([who, r.json.instalments, r.json.requests, subscriptions.some((s) => s.hasOpenPayment === true)])
        .toEqual([who, [], [], false]);
    }
  });

  it('every admin route refuses all three accounts', async () => {
    for (const who of ['parent', 'teacher', 'parent2'] as const) {
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

  it('account administration and staff-only lesson routes refuse all three accounts', async () => {
    for (const who of ['parent', 'teacher', 'parent2'] as const) {
      const other = who === 'teacher' ? m.parent.accountId : m.teacher.accountId;
      const routes = [
        ['GET', '/admin/accounts', undefined],
        ['POST', `/admin/accounts/${other}/password-reset`, { reason: 'review spec' }],
        ['GET', '/admin/family-access-grants', undefined],
        ['POST', `/teachers/${m.teacher.teacherId}/availability`, { timezone: 'Africa/Cairo', windows: [] }],
        ['POST', `/learners/${m.learnerId}/schedule`, { slots: [] }],
      ] as const;
      // The disposable parent has no tie to the review teacher or child, so
      // those two routes may rightly answer it 404; the admin routes may not.
      for (const [method, path, body] of who === 'parent2' ? routes.slice(0, 3) : routes) {
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
