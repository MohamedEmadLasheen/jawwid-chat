/**
 * PD-43: change a teacher's sign-in e-mail (plan §3.3, §4: PATCH /teachers/:id/sign-in).
 *
 *   1. While the login waits for its first sign-in: the super admin, the
 *      Teachers manager, or the teacher's CURRENT supervisor (the reissue rule,
 *      strict scope on or off). The old code dies; a new first sign-in code goes
 *      to the NEW address, and only the manager and the super admin see it.
 *   2. Once the teacher has signed in: the super admin only. Every session ends;
 *      the teacher signs in again with the new address.
 *   3. Refusals: no login (Give sign-in instead), a closed or suspended login,
 *      the same address, an address in use (gate P2-5's scoped answers).
 *   4. Audited as teacher.sign_in_changed, never with an e-mail; the database
 *      refuses a request role and anyone the rule does not name.
 *   5. The Teacher File says who may: signIn.canChange.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { AuthService } from '@platform/auth/auth.service';
import { hashPassword } from '@platform/auth/password';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { TeacherFileModule } from '../../src/teacher-file/teacher-file.module';
import { LessonModule } from '../../src/lessons/lesson.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { FIRST_LOGIN_MAILER, type MailSender } from '../../src/account-recovery/recovery-delivery';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd43-change-sign-in-spec-password-1';
const DOMAIN = 'pd43chg.qa.jawwid.test';
const OTHER_DOMAIN = 'pd43chgother.qa.jawwid.test';
const SLUG = 'pd43c-';

const g = buildGraph();
let m: SeedManifest;
let orgId: string;
let app: INestApplication;
let base: string;

const tokens = new Map<string, string>();
async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}

async function http(subject: string | null, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(subject ? { authorization: `Bearer ${await tokenFor(subject)}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const json = (text ? JSON.parse(text) : {}) as { error?: { code?: string; message?: string; detail?: Record<string, unknown> } } & Record<string, any>;
  return { status: r.status, code: json.error?.code, json, text, headers: r.headers };
}

const strict = (on: boolean) =>
  g.prisma.$executeRaw`UPDATE chat.config SET value = ${JSON.stringify(on)}::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;

let seq = 0;
const email = (label: string) => `${label}-${++seq}@${DOMAIN}`;
/** A teacher as they were before PD-43: a row, no login. */
const legacyTeacher = async (name = 'QA Legacy Teacher') =>
  (await g.prisma.teacher.create({ data: { organizationId: orgId, name, isActive: true } })).id;
/** Stands in for SMTP; off unless a case turns it on. */
interface FakeMailer extends MailSender {
  available: boolean;
  sent: Array<{ to: string; subject: string; text: string }>;
}
const mailer: FakeMailer = {
  available: false,
  sent: [],
  async send(to, mail) {
    mailer.sent.push({ to, ...mail });
  },
};

const add = (subject: string, body: Record<string, unknown>) =>
  http(subject, 'POST', '/teachers', { id: randomUUID(), name: 'QA Changed Teacher', confirmSimilarName: true, ...body });
const change = (subject: string, teacherId: string, body: Record<string, unknown>) =>
  http(subject, 'PATCH', `/teachers/${teacherId}/sign-in`, { reason: 'typo in the address', ...body });
const reset = (username: string, code: string, password = '1234') => http(null, 'POST', '/auth/password-reset', { username, code, password });

/** A teacher added by the Teachers manager: a waiting login and its first code. */
async function waiting(over: Record<string, unknown> = {}) {
  const address = email('w');
  const r = await add(m.teachersManager.subject, { email: address, ...over });
  expect(r.status).toBe(201);
  return { id: r.json.teacher.id as string, address, code: r.json.firstLogin.code as string };
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  for (const d of [DOMAIN, OTHER_DOMAIN]) await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${d}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, '${SLUG}${orgId.slice(0, 8)}', 'PD-43 change sign-in QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, TeacherFileModule, LessonModule],
  })
    .overrideProvider(FIRST_LOGIN_MAILER)
    .useValue(mailer)
    .compile();
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
  await strict(false);
  await truncate(g.prisma);
  for (const d of [DOMAIN, OTHER_DOMAIN]) await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${d}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});


afterEach(() => {
  mailer.available = false;
  mailer.sent = [];
});

describe('1. while the login waits', () => {
  it('the Teachers manager changes it: the old code dies, a new one works with the new address only', async () => {
    const t = await waiting();
    const next = email('n');
    const r = await change(m.teachersManager.subject, t.id, { email: `  ${next.toUpperCase()} ` });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toMatchObject({ teacherId: t.id, signIn: next, firstLogin: { code: expect.stringMatching(/^[0-9]{6}$/), emailed: false } });

    const account = await g.prisma.teacher.findUniqueOrThrow({ where: { id: t.id }, include: { account: true } });
    expect(account.account).toMatchObject({ subject: next, status: 'provisioned' });
    // The Teacher File's e-mail followed, since it was the sign-in.
    expect((await g.prisma.teacherFile.findUniqueOrThrow({ where: { teacherId: t.id } })).email).toBe(next);

    expect((await reset(t.address, t.code)).status).toBe(401);
    expect((await reset(next, t.code)).status).toBe(401);
    expect((await reset(next, r.json.firstLogin.code)).status).toBe(200);
    expect((await app.get(AuthService).login(next, '1234')).actor.actorId).toBe(t.id);
    await expect(app.get(AuthService).login(t.address, '1234')).rejects.toBeDefined();

    const audit = await g.prisma.auditLog.findMany({ where: { entityId: t.id, action: 'teacher.sign_in_changed' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: m.teachersManager.id, reason: 'typo in the address' });
    expect(JSON.stringify([audit[0]!.before, audit[0]!.after])).not.toContain('@');
  });

  it('the new code goes to the NEW address, after the commit; nothing to the old one', async () => {
    mailer.available = true;
    const t = await waiting();
    mailer.sent = [];
    const next = email('n');
    expect((await change(m.teachersManager.subject, t.id, { email: next })).status).toBe(200);
    expect(mailer.sent.map((x) => x.to)).toEqual([next]);
  });

  it('keeps a Teacher File e-mail that is not the sign-in', async () => {
    const t = await waiting();
    const contact = `contact-${++seq}@${DOMAIN}`;
    await g.prisma.teacherFile.update({ where: { teacherId: t.id }, data: { email: contact } });
    expect((await change(m.teachersManager.subject, t.id, { email: email('n') })).status).toBe(200);
    expect((await g.prisma.teacherFile.findUniqueOrThrow({ where: { teacherId: t.id } })).email).toBe(contact);
  });

  it('the CURRENT supervisor changes it but never sees the code; anyone else in the department: not found', async () => {
    mailer.available = true;
    const [mine, theirs] = [await waiting({ supervisorId: m.teacherSupervisors[0]!.id }), await waiting({ supervisorId: m.teacherSupervisors[1]!.id })];
    for (const on of [false, true]) {
      await strict(on);
      try {
        const refused = await change(m.teacherSupervisors[0]!.subject, theirs.id, { email: email('n') });
        expect([on, refused.status, refused.code]).toEqual([on, 404, 'COMM.TEACHER_FILE_NOT_FOUND']);
      } finally {
        await strict(false);
      }
    }
    const r = await change(m.teacherSupervisors[0]!.subject, mine.id, { email: email('n') });
    expect(r.status).toBe(200);
    expect(r.json.firstLogin).toEqual({ expiresAt: expect.any(String), emailed: true });
    expect(r.text).not.toMatch(/"code"/);
  });

  it('nobody outside the Teachers department and the super admin', async () => {
    const t = await waiting();
    for (const who of [m.supervisors[0]!, m.operationsManager, m.salesManager]) {
      const r = await change(who.subject, t.id, { email: email('n') });
      expect([who.subject, r.status, r.code]).toEqual([who.subject, 403, 'COMM.TEACHER_ONBOARDING_DENIED']);
    }
  });
});

describe('2. once the teacher has signed in', () => {
  async function signedIn() {
    const t = await waiting();
    expect((await reset(t.address, t.code)).status).toBe(200);
    return t;
  }

  it('the super admin only; every session ends and the teacher signs in again with the new address', async () => {
    const t = await signedIn();
    const token = (await app.get(AuthService).login(t.address, '1234')).accessToken;
    const byManager = await change(m.teachersManager.subject, t.id, { email: email('n') });
    expect([byManager.status, byManager.code]).toEqual([403, 'COMM.TEACHER_ONBOARDING_DENIED']);

    const next = email('n');
    const r = await change(m.superAdmin.subject, t.id, { email: next });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ teacherId: t.id, signIn: next, firstLogin: null });
    expect((await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await app.get(AuthService).login(next, '1234')).actor.actorId).toBe(t.id);
    await expect(app.get(AuthService).login(t.address, '1234')).rejects.toBeDefined();
  });
});

describe('3. refusals', () => {
  it('no login: Give sign-in is for that', async () => {
    const legacy = await legacyTeacher();
    const r = await change(m.teachersManager.subject, legacy, { email: email('n') });
    expect([r.status, r.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);
  });

  it('a suspended login, a closed one, the same address', async () => {
    const suspended = await waiting();
    expect((await reset(suspended.address, suspended.code)).status).toBe(200);
    const accountId = (await g.prisma.teacher.findUniqueOrThrow({ where: { id: suspended.id } })).accountId as string;
    await g.prisma.$queryRaw`SELECT chat.deactivate_principal('account', ${accountId}::uuid, 'qa', null, 'suspended')::text`;
    const s = await change(m.superAdmin.subject, suspended.id, { email: email('n') });
    expect([s.status, s.code]).toEqual([409, 'COMM.TEACHER_SIGN_IN_SUSPENDED']);

    const closed = await waiting();
    await g.prisma.$executeRaw`UPDATE chat.account SET status = 'deactivated', is_active = false WHERE subject = ${closed.address}`;
    const c = await change(m.superAdmin.subject, closed.id, { email: email('n') });
    expect([c.status, c.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);

    const same = await waiting();
    const r = await change(m.teachersManager.subject, same.id, { email: same.address.toUpperCase() });
    expect([r.status, r.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);
  });

  it('an address in use: named only when the caller reaches the teacher; otherwise one identical answer (gate P2-5)', async () => {
    const holder = await waiting();
    const t = await waiting();
    const named = await change(m.teachersManager.subject, t.id, { email: holder.address });
    expect([named.status, named.code]).toEqual([409, 'COMM.TEACHER_ALREADY_ADDED']);
    expect(named.json.error?.detail).toEqual({ teacher: { id: holder.id, name: 'QA Changed Teacher' } });

    // A parent's sign-in: the same answer as any address out of reach -- no kind, no name.
    const parent = await change(m.teachersManager.subject, t.id, { email: m.families[0]!.parent.subject });
    expect([parent.status, parent.code, parent.json.error?.detail]).toEqual([409, 'COMM.TEACHER_EMAIL_UNAVAILABLE', undefined]);
    expect((await g.prisma.account.findFirstOrThrow({ where: { subject: t.address } })).status).toBe('provisioned');
  });

  it('a malformed address is 400, and nothing changes', async () => {
    const t = await waiting();
    const r = await change(m.teachersManager.subject, t.id, { email: 'not an address' });
    expect([r.status, r.code]).toEqual([400, 'COMM.VALIDATION']);
    expect((await g.prisma.account.findFirstOrThrow({ where: { subject: t.address } })).status).toBe('provisioned');
  });
});

describe('4. the database', () => {
  it('refuses a request role, and anyone the rule does not name', async () => {
    const t = await waiting();
    const out = await g.prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('set local role chat_app');
        return tx.$queryRawUnsafe(`select chat.change_teacher_sign_in('${t.id}'::uuid, 'x-${++seq}@${DOMAIN}', 'r', '${m.teachersManager.id}'::uuid)`);
      })
      .then(() => 'ok', (e: Error) => e.message);
    expect(out).toMatch(/permission denied/);
    const ops = await g.prisma
      .$queryRawUnsafe(`select chat.change_teacher_sign_in('${t.id}'::uuid, 'y-${++seq}@${DOMAIN}', 'r', '${m.operationsManager.id}'::uuid)`)
      .then(() => 'ok', (e: Error) => e.message);
    expect(ops).toMatch(/no such teacher for you to change the sign-in of/);
  });
});

describe('5. the Teacher File says who may', () => {
  const canChange = async (subject: string, id: string) =>
    ((await http(subject, 'GET', `/teacher-files/${id}`)).json.signIn as { canChange?: boolean } | undefined)?.canChange;

  it('while waiting: the manager, the super admin, the current supervisor; once signed in: the super admin', async () => {
    const t = await waiting({ supervisorId: m.teacherSupervisors[0]!.id });
    expect(await canChange(m.teachersManager.subject, t.id)).toBe(true);
    expect(await canChange(m.superAdmin.subject, t.id)).toBe(true);
    expect(await canChange(m.teacherSupervisors[0]!.subject, t.id)).toBe(true);
    expect(await canChange(m.teacherSupervisors[1]!.subject, t.id)).toBe(false);
    expect((await reset(t.address, t.code)).status).toBe(200);
    expect(await canChange(m.teachersManager.subject, t.id)).toBe(false);
    expect(await canChange(m.superAdmin.subject, t.id)).toBe(true);
  });
});
