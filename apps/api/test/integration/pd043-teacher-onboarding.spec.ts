/**
 * PD-43 PR-1 against the real database: adding a teacher and the first sign-in.
 *
 *   1. the catalogue: teachers.create (Teachers manager and supervisors),
 *      teachers.offboard and teacher_files.finance (Teachers manager), as
 *      chat.staff_access_profile answers them; Operations gains nothing;
 *   2. chat.create_teacher: the Teachers manager names any supervisor or none,
 *      a teacher supervisor themselves or none (owner N1), anyone else
 *      nothing; one transaction makes the provisioned login, the teacher, the
 *      Teacher File and the assignment, and audits without the e-mail or phone;
 *      a duplicate sign-in (any kind, any case) or contact is refused without
 *      naming anyone; the same id twice is one teacher;
 *   3. the first sign-in code: 72 hours, only for a provisioned account; the
 *      teacher cannot sign in until they complete it; completing it activates
 *      the login, once; a reset code never does; nothing else moves an account
 *      from provisioned to active, while PD-21's reactivation still works;
 *   4. pay (owner N2): the Teachers manager writes pay terms, payout accounts
 *      and deduction defaults; a supervisor writes none of them, while PD-26's
 *      automatic pricing of a supervisor's deduction still writes its amount.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { hashPassword } from '@platform/auth/password';
import { PasswordResetService } from '@platform/auth/password-reset.service';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd43-onboarding-spec-password-1';
const DOMAIN = 'pd43onboard.qa.jawwid.test';
const SLUG = 'pd43o-';

const g = buildGraph();
let app: INestApplication;
let base: string;
let resets: PasswordResetService;
let m: SeedManifest;
let orgId: string;

async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

const permissions = async (staffId: string) =>
  (await g.prisma.$queryRaw<Array<{ permissions: string[] }>>`SELECT permissions FROM chat.staff_access_profile(${staffId}::uuid)`)[0]!.permissions;

interface NewTeacher {
  id?: string;
  name?: string;
  email: string;
  phone?: string | null;
  supervisorId?: string | null;
}

const createTeacher = (actor: string, t: NewTeacher) =>
  g.prisma
    .$queryRaw<Array<{ id: string }>>`
      SELECT chat.create_teacher(${t.id ?? randomUUID()}::uuid, ${t.name ?? 'QA New Teacher'}, ${t.email}, ${t.phone ?? null},
                                 ${null}::date, ${null}, ${t.supervisorId ?? null}::uuid, ${'spec'}, ${actor}::uuid)::text AS id`
    .then((r) => r[0]!.id);

const teacherRow = async (id: string) => {
  const teacher = await g.prisma.teacher.findUniqueOrThrow({ where: { id } });
  const account = await g.prisma.account.findUniqueOrThrow({ where: { id: teacher.accountId! } });
  const file = await g.prisma.teacherFile.findUnique({ where: { teacherId: id } });
  const assignment = (
    await g.prisma.$queryRaw<Array<{ supervisor_id: string; assigned_by: string }>>`
      SELECT supervisor_id::text, assigned_by::text FROM chat.teacher_supervisor_assignment WHERE teacher_id = ${id}::uuid`
  )[0];
  return { teacher, account, file, assignment };
};

async function login(subject: string, password = PASSWORD) {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: subject, password }),
  });
  return r.status;
}

const issueFirstLogin = (accountId: string, by = m.teachersManager) =>
  g.prisma.staff.findUniqueOrThrow({ where: { id: by.id } }).then((s) =>
    resets.issue({
      accountId,
      organizationId: orgId,
      issuedByStaffId: s.id,
      issuedByAccountId: s.accountId!,
      reason: 'new teacher',
      signOutEverywhere: false,
      purpose: 'first_login',
    }),
  );

let seq = 0;
const email = (label: string) => `${label}-${++seq}@${DOMAIN}`;

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, '${SLUG}${orgId.slice(0, 8)}', 'PD-43 QA academy')`,
  );
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, CommunicationModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
  resets = app.get(PasswordResetService);
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('1. the catalogue', () => {
  it('the two keys are in chat.permission, non-delegable, introduced by PD-43', async () => {
    const rows = await g.prisma.$queryRaw<Array<{ key: string; delegable: boolean; introduced_by: string; risk: string }>>`
      SELECT key, delegable, introduced_by, risk FROM chat.permission WHERE key IN ('teachers.create', 'teachers.offboard') ORDER BY key`;
    expect(rows).toEqual([
      { key: 'teachers.create', delegable: false, introduced_by: 'PD-43', risk: 'admin' },
      { key: 'teachers.offboard', delegable: false, introduced_by: 'PD-43', risk: 'admin' },
    ]);
  });

  it('the Teachers manager holds all three; a teacher supervisor only teachers.create; Operations none', async () => {
    const manager = await permissions(m.teachersManager.id);
    expect(manager).toEqual(expect.arrayContaining(['teachers.create', 'teachers.offboard', 'teacher_files.finance']));
    const supervisor = await permissions(m.teacherSupervisors[0]!.id);
    expect(supervisor).toContain('teachers.create');
    expect(supervisor).not.toContain('teachers.offboard');
    expect(supervisor).not.toContain('teacher_files.finance');
    for (const ops of [m.operationsManager, m.supervisors[0]!, m.salesManager]) {
      const held = await permissions(ops.id);
      expect(held.filter((k) => ['teachers.create', 'teachers.offboard', 'teacher_files.finance'].includes(k))).toEqual([]);
    }
  });
});

describe('2. chat.create_teacher', () => {
  it('the Teachers manager adds a teacher with no supervisor: a provisioned login, the teacher, the file, no assignment', async () => {
    const id = await createTeacher(m.teachersManager.id, { email: '  New.Teacher-A@' + DOMAIN.toUpperCase() + ' ', phone: '+20 100 000 0001' });
    const { teacher, account, file, assignment } = await teacherRow(id);
    expect(teacher).toMatchObject({ organizationId: orgId, name: 'QA New Teacher', isActive: true, leftAt: null });
    expect(account).toMatchObject({ organizationId: orgId, kind: 'teacher', status: 'provisioned', isActive: false, subject: `new.teacher-a@${DOMAIN}` });
    expect(file).toMatchObject({ email: `new.teacher-a@${DOMAIN}`, adminOnlyPhone: '+20 100 000 0001', updatedBy: m.teachersManager.id });
    expect(file!.joinedOn).not.toBeNull();
    expect(assignment).toBeUndefined();
    expect(await g.prisma.accountCredential.count({ where: { accountId: account.id } })).toBe(0);

    const audit = await g.prisma.$queryRaw<Array<{ actor_id: string; after: Record<string, unknown>; reason: string }>>`
      SELECT actor_id::text, after, reason FROM chat.audit_log WHERE action = 'teacher.created' AND entity_id = ${id}::uuid`;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: m.teachersManager.id, reason: 'spec', after: { accountId: account.id, supervisorId: null } });
    expect(JSON.stringify(audit[0]!.after)).not.toMatch(/@|\+20/);
  });

  it('the Teachers manager may name any primary teacher supervisor', async () => {
    const id = await createTeacher(m.teachersManager.id, { email: email('b'), supervisorId: m.teacherSupervisors[1]!.id });
    expect((await teacherRow(id)).assignment).toEqual({ supervisor_id: m.teacherSupervisors[1]!.id, assigned_by: m.teachersManager.id });
  });

  it('a teacher supervisor adds for themselves or with no supervisor (owner N1), never for a colleague', async () => {
    const me = m.teacherSupervisors[0]!;
    const mine = await createTeacher(me.id, { email: email('c'), supervisorId: me.id });
    expect((await teacherRow(mine)).assignment).toEqual({ supervisor_id: me.id, assigned_by: me.id });
    const nobody = await createTeacher(me.id, { email: email('d') });
    expect((await teacherRow(nobody)).assignment).toBeUndefined();
    expect(await sqlError(createTeacher(me.id, { email: email('e'), supervisorId: m.teacherSupervisors[1]!.id }))).toMatch(
      /a teacher supervisor adds a teacher for themselves or with no supervisor/,
    );
  });

  it('nobody outside the Teachers department adds a teacher, and nothing is left behind', async () => {
    const before = await g.prisma.teacher.count({ where: { organizationId: orgId } });
    for (const who of [m.operationsManager, m.supervisors[0]!, m.salesManager]) {
      expect(await sqlError(createTeacher(who.id, { email: email('f') }))).toMatch(/only the Teachers department or the super admin adds a teacher/);
    }
    expect(await g.prisma.teacher.count({ where: { organizationId: orgId } })).toBe(before);
  });

  it('the super admin adds a teacher too', async () => {
    const id = await createTeacher(m.superAdmin.id, { email: email('g'), supervisorId: m.teacherSupervisors[0]!.id });
    expect((await teacherRow(id)).assignment).toMatchObject({ supervisor_id: m.teacherSupervisors[0]!.id });
  });

  it('the same id twice is one teacher', async () => {
    const id = randomUUID();
    const address = email('h');
    expect(await createTeacher(m.teachersManager.id, { id, email: address })).toBe(id);
    expect(await createTeacher(m.teachersManager.id, { id, email: address })).toBe(id);
    expect(await g.prisma.account.count({ where: { subject: address } })).toBe(1);
  });

  it('a sign-in already in use, of any kind and in any case, is refused without naming anyone', async () => {
    for (const taken of [m.families[0]!.parent.subject, m.teachers[0]!.subject, m.supervisors[0]!.subject]) {
      const error = await sqlError(createTeacher(m.teachersManager.id, { email: taken.toUpperCase() }));
      expect(error).toMatch(/this e-mail already signs in to Chat/);
      expect(error).not.toContain(taken.split('@')[0]!);
    }
  });

  it('a contact already on another teacher\'s file is refused without naming the teacher', async () => {
    await createTeacher(m.teachersManager.id, { email: email('i'), phone: '+20 111 222 3334' });
    const error = await sqlError(createTeacher(m.teachersManager.id, { email: email('j'), phone: '+201112223334' }));
    expect(error).toMatch(/this contact is already on a teacher's file/);
    expect(error).not.toMatch(/QA New Teacher/);
  });

  it('a malformed sign-in e-mail or an empty name is refused', async () => {
    expect(await sqlError(createTeacher(m.teachersManager.id, { email: 'not-an-email' }))).toMatch(/the sign-in e-mail is an e-mail address/);
    expect(await sqlError(createTeacher(m.teachersManager.id, { email: email('k'), name: '   ' }))).toMatch(/a teacher has a name/);
  });
});

describe('3. the first sign-in code', () => {
  it('lives 72 hours; the teacher signs in only after completing it, and then the login is active', async () => {
    const address = email('l');
    const id = await createTeacher(m.teachersManager.id, { email: address });
    const { account } = await teacherRow(id);
    const { code, expiresAt } = await issueFirstLogin(account.id);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 3_600_000);
    const row = await g.prisma.passwordResetCode.findFirstOrThrow({ where: { accountId: account.id, usedAt: null } });
    expect(row.purpose).toBe('first_login');

    expect(await login(address, '1234')).not.toBe(200);
    await expect(resets.complete(address, code, '1234')).resolves.toEqual({ ok: true });
    expect(await g.prisma.account.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({ status: 'active', isActive: true });
    expect(await login(address, '1234')).toBe(200);

    const audit = await g.prisma.$queryRaw<Array<{ actor_id: string | null; after: Record<string, unknown> }>>`
      SELECT actor_id::text, after FROM chat.audit_log WHERE action = 'account.activated' AND entity_id = ${account.id}::uuid`;
    expect(audit).toEqual([{ actor_id: null, after: { kind: 'teacher', codeId: row.id, issuer: m.teachersManager.id } }]);
  });

  it('a reset code on a provisioned account sets a password but never activates it', async () => {
    const address = email('m');
    const { account } = await teacherRow(await createTeacher(m.teachersManager.id, { email: address }));
    const staff = await g.prisma.staff.findUniqueOrThrow({ where: { id: m.teachersManager.id } });
    const { code } = await resets.issue({
      accountId: account.id, organizationId: orgId, issuedByStaffId: staff.id, issuedByAccountId: staff.accountId!, reason: 'r', signOutEverywhere: false,
    });
    await resets.complete(address, code, '1234');
    expect((await g.prisma.account.findUniqueOrThrow({ where: { id: account.id } })).status).toBe('provisioned');
    expect(await login(address, '1234')).not.toBe(200);
  });

  it('a first sign-in code is only for an account that has not signed in yet, and lives at most 72 hours', async () => {
    const active = await g.prisma.account.findUniqueOrThrow({ where: { subject: m.teachers[0]!.subject } });
    expect(await sqlError(issueFirstLogin(active.id))).toMatch(/a first sign-in code is for an account that has not signed in yet/);

    const { account } = await teacherRow(await createTeacher(m.teachersManager.id, { email: email('n') }));
    const insert = (hours: number) =>
      g.prisma.$executeRaw`
        INSERT INTO chat.password_reset_code (organization_id, account_id, issued_by, code_hash, reason, expires_at, purpose)
        VALUES (${orgId}::uuid, ${account.id}::uuid, ${m.teachersManager.id}::uuid, ${'a'.repeat(64)}, 'r', now() + make_interval(hours => ${hours}), 'first_login')`;
    expect(await sqlError(insert(73))).toMatch(/a first sign-in code lives at most 72 hours/);
    expect(await sqlError(insert(72))).toBe('ok');
  });

  it('nothing but a completed first sign-in code moves an account from provisioned to active', async () => {
    const { account } = await teacherRow(await createTeacher(m.teachersManager.id, { email: email('o') }));
    expect(await sqlError(g.prisma.$executeRaw`UPDATE chat.account SET status = 'active', is_active = true WHERE id = ${account.id}::uuid`)).toMatch(
      /an account becomes active from provisioned only with a first sign-in code/,
    );
    const { code } = await issueFirstLogin(account.id);
    const live = await g.prisma.passwordResetCode.findFirstOrThrow({ where: { accountId: account.id, usedAt: null } });
    // An unspent code activates nothing.
    expect(await sqlError(g.prisma.$queryRaw`SELECT chat.activate_account_with_code(${live.id}::uuid)::text`)).toMatch(
      /a spent first sign-in code/,
    );
    await resets.complete(account.subject, code, '1234');
    // A spent code activates once.
    expect(await sqlError(g.prisma.$queryRaw`SELECT chat.activate_account_with_code(${live.id}::uuid)::text`)).toMatch(
      /only a provisioned account is activated by a first sign-in code/,
    );
  });

  it('PD-21 reactivation (suspended to active) is untouched', async () => {
    const address = email('p');
    const { account } = await teacherRow(await createTeacher(m.teachersManager.id, { email: address }));
    const { code } = await issueFirstLogin(account.id);
    await resets.complete(address, code, '1234');
    await g.prisma.$queryRaw`SELECT chat.deactivate_principal('account', ${account.id}::uuid, 'spec', ${m.teachersManager.id}::uuid, 'suspended')::text`;
    expect((await g.prisma.account.findUniqueOrThrow({ where: { id: account.id } })).status).toBe('suspended');
    const [{ ok }] = await g.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.reactivate_account(${account.id}::uuid, 'spec') AS ok`;
    expect(ok).toBe(true);
    expect(await login(address, '1234')).toBe(200);
  });
});

describe('4. pay (owner N2: "Full teacher finance")', () => {
  const month = () => new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`);

  it('the Teachers manager writes pay terms, a payout account and a deduction default; a supervisor none of them', async () => {
    const t = m.teachers[0]!.id;
    const terms = (by: string) =>
      g.prisma.teacherPayTerms.create({
        data: { organizationId: orgId, teacherId: t, effectiveMonth: month(), salaryType: 'shift', currency: 'EGP', monthlyAmount: '9000', reason: 'contract', createdBy: by },
      });
    const payout = (by: string) =>
      g.prisma.$executeRaw`
        INSERT INTO chat.teacher_payout_account (teacher_id, organization_id, method, details_sealed, key_id, last4, updated_by)
        VALUES (${t}::uuid, ${orgId}::uuid, 'bank_transfer', ${Buffer.alloc(40, 1)}, 'k1', '1234', ${by}::uuid)
        ON CONFLICT (teacher_id) DO UPDATE SET updated_by = excluded.updated_by`;
    const fallback = (by: string) =>
      g.prisma.teacherPayDefault.create({ data: { organizationId: orgId, kind: 'deduction_1', currency: 'EGP', amount: '100', createdBy: by } });

    const supervisor = m.teacherSupervisors[0]!.id;
    expect(await sqlError(terms(supervisor))).toMatch(/written by the super admin or the Teachers manager/);
    expect(await sqlError(payout(supervisor))).toMatch(/written by the super admin or the Teachers manager/);
    expect(await sqlError(fallback(supervisor))).toMatch(/set by the super admin or the Teachers manager/);
    expect(await sqlError(terms(m.operationsManager.id))).toMatch(/written by the super admin or the Teachers manager/);

    expect(await sqlError(terms(m.teachersManager.id))).toBe('ok');
    expect(await sqlError(payout(m.teachersManager.id))).toBe('ok');
    expect(await sqlError(fallback(m.teachersManager.id))).toBe('ok');
    expect(await sqlError(payout(m.superAdmin.id))).toBe('ok');
  });

  it('an amount a supervisor causes is still written: adjustments keep PD-18\'s rule (PD-26 prices a supervisor\'s deduction)', async () => {
    const adjustment = await g.prisma.teacherPayAdjustment.create({
      data: { organizationId: orgId, teacherId: m.teachers[0]!.id, kind: 'deduction', month: month(), amount: '50', currency: 'EGP', reason: 'spec', createdBy: m.teacherSupervisors[0]!.id },
    });
    expect(adjustment.createdBy).toBe(m.teacherSupervisors[0]!.id);
  });
});
