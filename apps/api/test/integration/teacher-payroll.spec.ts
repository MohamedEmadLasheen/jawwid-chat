/**
 * PD-18 teacher payroll, end to end over the real HTTP routes, on the synthetic
 * PD-8 organization:
 *
 *   1. only the super admin reaches payroll; the Teachers department reads the
 *      recorded bonuses and deductions without a single amount;
 *   2. pay terms: validation, versions by effective month;
 *   3. the payout account is sealed in the database, revealed only with a
 *      reason, audited without its details -- and refused (503) without a key;
 *   4. amounts: pricing a recorded bonus once, corrections, cancellation, a
 *      month without terms refused, and the month's arithmetic;
 *   5. an hourly salary is paid on the lessons the teacher held;
 *   6. the database refuses what the application would never send: rewrites,
 *      foreign sources, any request-role grant.
 *
 * Synthetic people and synthetic account numbers only (G-20).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { AuthService } from '@platform/auth/auth.service';
import { hashPassword } from '@platform/auth/password';
import { AUDIT_SERVICE } from '@platform/tokens';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { TeacherFileModule } from '../../src/teacher-file/teacher-file.module';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { TeacherPayrollService } from '../../src/teacher-file/teacher-payroll.service';
import { LessonModule } from '../../src/lessons/lesson.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const inheritedKeys = process.env.TEACHER_PAYOUT_KEYS;

const PASSWORD = 'pd18-payroll-spec-password-1';
const DOMAIN = 'pd18pay.qa.jawwid.test';
const SLUG = 'pd18-';
const ACCOUNT_NUMBER = '100200300400';
const IBAN = 'EG380019000500000000263180002';

const g = buildGraph();
let m: SeedManifest;
let orgId: string;
let app: INestApplication;
let base: string;
let month: string;

const tokens = new Map<string, string>();
async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}

async function http(subject: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${await tokenFor(subject)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const json = (text ? JSON.parse(text) : {}) as { error?: { code?: string; message?: string } } & Record<string, any>;
  return { status: r.status, code: json.error?.code, message: json.error?.message, json, text, headers: r.headers };
}

const owner = () => m.superAdmin.subject;
/** Two teachers who teach, so the hourly one can hold a lesson. */
const taught = () => {
  const ids = new Set(m.families.flatMap((f) => f.children.map((c) => c.teacherId)));
  return m.teachers.filter((t) => ids.has(t.id));
};
const shiftTeacher = () => taught()[0];
const hourlyTeacher = () => taught()[1];

beforeAll(async () => {
  process.env.TEACHER_PAYOUT_KEYS = `k1:${randomBytes(32).toString('base64')}`;
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, '${SLUG}${orgId.slice(0, 8)}', 'PD-18 QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({
      data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id },
    });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD) });
  expect(taught().length).toBeGreaterThanOrEqual(2);
  const [r] = await g.prisma.$queryRaw<Array<{ m: string }>>`SELECT to_char(chat.academy_month(now()), 'YYYY-MM') AS m`;
  month = r.m;

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, TeacherFileModule, LessonModule],
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
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedKeys === undefined) delete process.env.TEACHER_PAYOUT_KEYS;
  else process.env.TEACHER_PAYOUT_KEYS = inheritedKeys;
});

describe('1. who reaches payroll', () => {
  it('the super admin only; the file tells each reader whether to offer it', async () => {
    const t = shiftTeacher().id;
    const refused = [m.teachersManager, m.teacherSupervisors[0], m.supervisors[0], m.operationsManager, m.teachers[0], m.families[0].parent];
    for (const who of refused) {
      for (const [method, path, body] of [
        ['GET', `/teacher-files/${t}/finance`, undefined],
        ['POST', `/teacher-files/${t}/finance/terms`, { effectiveMonth: month, salaryType: 'shift', currency: 'EGP', monthlyAmount: '1', reason: 'x' }],
        ['POST', `/teacher-files/${t}/finance/payout-account/reveal`, { reason: 'x' }],
        ['POST', `/teacher-files/${t}/finance/adjustments`, { kind: 'bonus', amount: '1', month, reason: 'x' }],
      ] as const) {
        const r = await http(who.subject, method, path, body);
        expect({ who: who.subject, path, status: r.status, code: r.code }).toEqual({ who: who.subject, path, status: 403, code: 'COMM.TEACHER_FILE_DENIED' });
      }
    }
    const ok = await http(owner(), 'GET', `/teacher-files/${t}/finance`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.json).toMatchObject({ month, keyConfigured: true, terms: [], currentTerms: null, payoutAccount: null });

    expect((await http(owner(), 'GET', `/teacher-files/${t}`)).json.access.canViewFinance).toBe(true);
    expect((await http(m.teachersManager.subject, 'GET', `/teacher-files/${t}`)).json.access.canViewFinance).toBe(false);
  });

  it('a foreign or unknown teacher is the same 404', async () => {
    expect((await http(owner(), 'GET', `/teacher-files/${randomUUID()}/finance`)).code).toBe('COMM.TEACHER_FILE_NOT_FOUND');
    expect((await http(owner(), 'GET', `/teacher-files/not-a-uuid/finance`)).code).toBe('COMM.TEACHER_FILE_NOT_FOUND');
  });

  it('the teaching market is employment: the Teachers manager sets it, the file shows it', async () => {
    const t = shiftTeacher().id;
    const r = await http(m.teachersManager.subject, 'POST', `/teacher-files/${t}/personal`, { teachingMarket: 'Gulf', reason: 'hired for the Gulf market' });
    expect(r.status).toBe(201);
    expect(r.json.employment).toEqual({ teachingMarket: 'Gulf', studentCount: r.json.assignedStudents.length });
    expect((await http(m.teachersManager.subject, 'POST', `/teacher-files/${t}/personal`, { teachingMarket: 'x'.repeat(81), reason: 'r' })).status).toBe(400);
  });
});

describe('2. pay terms', () => {
  it('refuses what is not a salary, naming the field', async () => {
    const t = shiftTeacher().id;
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ effectiveMonth: '2026-13', salaryType: 'shift', currency: 'EGP', monthlyAmount: '6000', reason: 'r' }, /effectiveMonth/],
      [{ effectiveMonth: month, salaryType: 'weekly', currency: 'EGP', monthlyAmount: '6000', reason: 'r' }, /salaryType/],
      [{ effectiveMonth: month, salaryType: 'shift', currency: 'EG', monthlyAmount: '6000', reason: 'r' }, /currency/],
      [{ effectiveMonth: month, salaryType: 'shift', currency: 'EGP', monthlyAmount: '0', reason: 'r' }, /monthlyAmount/],
      [{ effectiveMonth: month, salaryType: 'shift', currency: 'EGP', monthlyAmount: '1.234', reason: 'r' }, /monthlyAmount/],
      [{ effectiveMonth: month, salaryType: 'shift', currency: 'EGP', monthlyAmount: '6000', hourlyRate: '10', reason: 'r' }, /hourlyRate/],
      [{ effectiveMonth: month, salaryType: 'shift', currency: 'EGP', monthlyAmount: '6000' }, /reason/],
    ];
    for (const [body, field] of bad) {
      const r = await http(owner(), 'POST', `/teacher-files/${t}/finance/terms`, body);
      expect([r.status, r.code]).toEqual([400, 'COMMON.VALIDATION']);
      expect(r.message).toMatch(field);
    }
  });

  it('records versions; the newest in force is the current terms', async () => {
    const t = shiftTeacher().id;
    const first = await http(owner(), 'POST', `/teacher-files/${t}/finance/terms`, {
      effectiveMonth: month, salaryType: 'shift', currency: 'egp', monthlyAmount: 5500, reason: 'contract',
    });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ salaryType: 'shift', currency: 'EGP', monthlyAmount: '5500.00', hourlyRate: null });
    await http(owner(), 'POST', `/teacher-files/${t}/finance/terms`, {
      effectiveMonth: month, salaryType: 'shift', currency: 'EGP', monthlyAmount: '6000.00', reason: 'raise',
    });
    const f = await http(owner(), 'GET', `/teacher-files/${t}/finance`);
    expect(f.json.currentTerms).toMatchObject({ monthlyAmount: '6000.00', reason: 'raise' });
    expect(f.json.terms).toHaveLength(2);
    expect(f.json.terms[0].createdBy.name).toBe('QA Organization Owner');
  });
});

describe('3. the payout account', () => {
  const t = () => shiftTeacher().id;
  const account = { bankName: 'QA Bank', accountHolder: 'Synthetic Teacher', accountNumber: ACCOUNT_NUMBER, iban: IBAN };

  it('is sealed in the database; the file shows the method and last four only', async () => {
    const r = await http(owner(), 'POST', `/teacher-files/${t()}/finance/payout-account`, { method: 'bank_transfer', details: account, reason: 'onboarding' });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ method: 'bank_transfer', last4: '0002' });

    const [row] = await g.prisma.$queryRawUnsafe<Array<{ sealed: Buffer; method: string; last4: string }>>(
      `select details_sealed as sealed, method, last4 from chat.teacher_payout_account where teacher_id = '${t()}'::uuid`,
    );
    const bytes = Buffer.from(row.sealed).toString('latin1');
    expect(bytes).not.toContain(ACCOUNT_NUMBER);
    expect(bytes).not.toContain(IBAN);
    expect(bytes).not.toContain('QA Bank');

    const f = await http(owner(), 'GET', `/teacher-files/${t()}/finance`);
    expect(f.json.payoutAccount).toMatchObject({ method: 'bank_transfer', last4: '0002' });
    expect(f.text).not.toContain(ACCOUNT_NUMBER);
  });

  it('is revealed with a reason, and the audit trail holds neither the details nor an amount', async () => {
    expect((await http(owner(), 'POST', `/teacher-files/${t()}/finance/payout-account/reveal`, {})).status).toBe(400);
    const r = await http(owner(), 'POST', `/teacher-files/${t()}/finance/payout-account/reveal`, { reason: 'paying October' });
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toEqual({ method: 'bank_transfer', details: account });

    const audit = await g.prisma.auditLog.findMany({ where: { entityId: t(), action: { startsWith: 'teacher_file.' } } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['teacher_file.payout_account_set', 'teacher_file.payout_account_revealed', 'teacher_file.pay_terms_set']));
    expect(audit.find((a) => a.action === 'teacher_file.payout_account_revealed')?.reason).toBe('paying October');
    const text = JSON.stringify(audit.map((a) => ({ action: a.action, before: a.before, after: a.after, reason: a.reason })));
    for (const secret of [ACCOUNT_NUMBER, IBAN, 'QA Bank', '6000', '5500']) expect(text).not.toContain(secret);
  });

  it('refuses unknown fields, and a teacher with no account has nothing to reveal', async () => {
    const r = await http(owner(), 'POST', `/teacher-files/${t()}/finance/payout-account`, {
      method: 'e_wallet', details: { provider: 'QA Wallet', walletNumber: '01001234567', pin: '0000' }, reason: 'r',
    });
    expect([r.status, r.code]).toEqual([400, 'COMMON.VALIDATION']);
    expect((await http(owner(), 'POST', `/teacher-files/${hourlyTeacher().id}/finance/payout-account/reveal`, { reason: 'r' })).code)
      .toBe('COMM.TEACHER_FILE_NOT_FOUND');
  });

  it('without TEACHER_PAYOUT_KEYS it fails closed: 503, nothing written', async () => {
    const saved = process.env.TEACHER_PAYOUT_KEYS;
    delete process.env.TEACHER_PAYOUT_KEYS;
    const keyless = new TeacherPayrollService(g.prisma as never, app.get(TeacherFileService), app.get(AUDIT_SERVICE));
    process.env.TEACHER_PAYOUT_KEYS = saved;
    const before = await g.prisma.teacherPayoutAccount.count();
    await expect(
      keyless.setPayoutAccount(m.superAdmin.id, hourlyTeacher().id, { method: 'instapay', details: { address: 'qa@instapay' }, reason: 'r' }),
    ).rejects.toMatchObject({ code: 'COMM.TEACHER_PAYROLL_UNAVAILABLE', status: 503 });
    await expect(keyless.revealPayoutAccount(m.superAdmin.id, t(), { reason: 'r' })).rejects.toMatchObject({ status: 503 });
    expect(await g.prisma.teacherPayoutAccount.count()).toBe(before);
    expect((await keyless.finance(m.superAdmin.id, t())).keyConfigured).toBe(false);
  });
});

describe('4. amounts', () => {
  const t = () => shiftTeacher().id;
  let bonusEntryId: string;

  beforeAll(async () => {
    // A bonus the Teachers department recorded (PD-11's ticket writes exactly this row).
    bonusEntryId = (
      await g.prisma.teacherSupervisionEntry.create({
        data: { organizationId: orgId, teacherId: t(), kind: 'bonus', body: 'Two trial students stayed', createdBy: m.teachersManager.id },
      })
    ).id;
  });

  it('a recorded bonus is unpriced until the super admin prices it, once', async () => {
    expect((await http(owner(), 'GET', `/teacher-files/${t()}/finance`)).json.unpriced.bonusEntryIds).toEqual([bonusEntryId]);
    const r = await http(owner(), 'POST', `/teacher-files/${t()}/finance/adjustments`, { kind: 'bonus', bonusEntryId, amount: '500', reason: 'trial bonus' });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ kind: 'bonus', month, amount: '500.00', currency: 'EGP' });
    const again = await http(owner(), 'POST', `/teacher-files/${t()}/finance/adjustments`, { kind: 'bonus', bonusEntryId, amount: '600', reason: 'twice' });
    expect([again.status, again.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);
    expect((await http(owner(), 'GET', `/teacher-files/${t()}/finance`)).json.unpriced.bonusEntryIds).toEqual([]);
  });

  it('a correction replaces an amount; zero cancels; the month adds up', async () => {
    const f0 = await http(owner(), 'GET', `/teacher-files/${t()}/finance`);
    const priced = f0.json.adjustments.find((a: { bonusEntryId: string }) => a.bonusEntryId === bonusEntryId);
    const fix = await http(owner(), 'POST', `/teacher-files/${t()}/finance/adjustments`, { replaces: priced.id, amount: '450.50', reason: 'typo' });
    expect(fix.status).toBe(201);
    // A correction cannot be corrected twice from the same row.
    expect((await http(owner(), 'POST', `/teacher-files/${t()}/finance/adjustments`, { replaces: priced.id, amount: '1', reason: 'r' })).status).toBe(409);

    expect((await http(owner(), 'POST', `/teacher-files/${t()}/finance/adjustments`, { kind: 'deduction', amount: '100', reason: 'no month' })).message)
      .toMatch(/month/);
    const ded = await http(owner(), 'POST', `/teacher-files/${t()}/finance/adjustments`, { kind: 'deduction', amount: '100.25', month, reason: 'late twice' });
    expect(ded.status).toBe(201);
    const extra = await http(owner(), 'POST', `/teacher-files/${t()}/finance/adjustments`, { kind: 'deduction', amount: '40', month, reason: 'mistake' });
    await http(owner(), 'POST', `/teacher-files/${t()}/finance/adjustments`, { replaces: extra.json.id, amount: '0', reason: 'cancelled' });
    expect((await http(owner(), 'POST', `/teacher-files/${t()}/finance/adjustments`, { kind: 'bonus', amount: '0', month, reason: 'r' })).status).toBe(400);

    const f = await http(owner(), 'GET', `/teacher-files/${t()}/finance`);
    expect(f.json.summary[0]).toEqual({
      month, currency: 'EGP', salaryType: 'shift', paidMinutes: 0, base: '6000.00', bonuses: '450.50', deductions: '100.25', net: '6350.25',
    });
    expect(f.json.summary).toHaveLength(6);
    expect(f.json.adjustments.filter((a: { live: boolean }) => a.live)).toHaveLength(3);
  });

  it('a month before any terms is refused: an amount needs a currency', async () => {
    const r = await http(owner(), 'POST', `/teacher-files/${t()}/finance/adjustments`, { kind: 'bonus', amount: '10', month: '2020-01', reason: 'r' });
    expect([r.status, r.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);
    expect(r.message).toMatch(/pay terms for 2020-01/);
  });

  it('the Teachers department reads what was recorded, never an amount', async () => {
    const r = await http(m.teachersManager.subject, 'GET', `/teacher-files/${t()}`);
    expect(r.json.history.bonuses).toEqual([
      expect.objectContaining({ id: bonusEntryId, reason: 'Two trial students stayed', author: { id: m.teachersManager.id, name: m.teachersManager.name } }),
    ]);
    for (const amount of ['450.5', '500', '100.25', '6000', '6350']) expect(r.text).not.toContain(amount);
    expect(r.text).not.toMatch(/"amount"|"currency"|"net"/);
  });
});

describe('5. an hourly salary', () => {
  it('is the rate times the hours of the lessons the teacher held that month', async () => {
    const teacher = hourlyTeacher();
    const learnerId = m.families.flatMap((f) => f.children).find((c) => c.teacherId === teacher.id)!.id;
    const start = Date.now() - 40 * 60_000;
    const lesson = await http(m.teacherSupervisors[0].subject, 'POST', '/lessons', {
      learnerId, startsAt: new Date(start).toISOString(), endsAt: new Date(start + 30 * 60_000).toISOString(),
    });
    expect(lesson.status).toBe(201);
    expect((await http(teacher.subject, 'POST', `/lessons/${lesson.json.id}/report`, { covered: 'Al-Fatiha', rating: 5 })).status).toBe(201);
    const [r] = await g.prisma.$queryRawUnsafe<Array<{ m: string }>>(
      `select to_char(chat.academy_month(starts_at), 'YYYY-MM') as m from chat.lesson where id = '${lesson.json.id}'::uuid`,
    );

    await http(owner(), 'POST', `/teacher-files/${teacher.id}/finance/terms`, {
      effectiveMonth: r.m, salaryType: 'hourly', currency: 'USD', hourlyRate: '12.50', reason: 'hourly contract',
    });
    const f = await http(owner(), 'GET', `/teacher-files/${teacher.id}/finance?month=${r.m}`);
    expect(f.json.summary[0]).toMatchObject({ month: r.m, currency: 'USD', salaryType: 'hourly', paidMinutes: 30, base: '6.25', net: '6.25' });
  });
});

describe('6. the database, with the application bypassed', () => {
  it('terms and amounts are append-only', async () => {
    await expect(g.prisma.$executeRawUnsafe(`update chat.teacher_pay_terms set monthly_amount = 1`)).rejects.toThrow(/append-only/);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.teacher_pay_adjustment`)).rejects.toThrow(/append-only/);
  });

  it('an amount prices a bonus of the same teacher only', async () => {
    const other = await g.prisma.teacherSupervisionEntry.create({
      data: { organizationId: orgId, teacherId: hourlyTeacher().id, kind: 'bonus', body: 'other teacher', createdBy: m.teachersManager.id },
    });
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_pay_adjustment (organization_id, teacher_id, kind, month, amount, currency, reason, bonus_entry_id, created_by)
         values ('${orgId}', '${shiftTeacher().id}', 'bonus', '${month}-01', 1, 'EGP', 'r', '${other.id}', '${m.superAdmin.id}')`,
      ),
    ).rejects.toThrow(/same teacher/);
  });

  it('a shift salary has a monthly amount and no rate', async () => {
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_pay_terms (organization_id, teacher_id, effective_month, salary_type, currency, hourly_rate, reason, created_by)
         values ('${orgId}', '${shiftTeacher().id}', '${month}-01', 'shift', 'EGP', 10, 'r', '${m.superAdmin.id}')`,
      ),
    ).rejects.toThrow(/teacher_pay_terms_amount_matches_type/);
  });

  it('no request role holds any privilege on payroll', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ role: string; tbl: string; ok: boolean }>>(`
      select r.role, t.tbl, has_table_privilege(r.role, t.tbl, 'select, insert, update, delete') as ok
        from (values ('anon'), ('authenticated'), ('chat_app')) r(role),
             (values ('chat.teacher_pay_terms'), ('chat.teacher_payout_account'), ('chat.teacher_pay_adjustment')) t(tbl)`);
    expect(rows.filter((r) => r.ok)).toEqual([]);
  });
});
