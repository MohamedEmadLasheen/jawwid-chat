/**
 * PD-43 "Give sign-in" over real HTTP: a teacher row that exists without a
 * login (inserted before PD-43; the Core-migration intake) gets one in place.
 *
 *   1. POST /teachers/:id/sign-in (teachers.create): a provisioned login
 *      linked to the SAME teacher, a first sign-in code returned once; the
 *      teacher signs in; their students and history are untouched; the file's
 *      e-mail is filled only when empty; audited without the e-mail.
 *   2. Refusals: already has a login (409 TEACHER_HAS_SIGN_IN), inactive (409),
 *      out of reach or unknown (404), outside the department (403), a sign-in
 *      in use (gate P2-5: one identical answer).
 *   3. One transaction for the login, the link and the code; two calls at
 *      once make one login.
 *   4. The Teacher File tells the page: signIn.status and canManageSignIn.
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
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd43-give-sign-in-spec-password-1';
const DOMAIN = 'pd43give.qa.jawwid.test';
const OTHER_DOMAIN = 'pd43giveother.qa.jawwid.test';
const SLUG = 'pd43g-';

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
const give = (subject: string, teacherId: string, body: Record<string, unknown>) => http(subject, 'POST', `/teachers/${teacherId}/sign-in`, body);

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  for (const d of [DOMAIN, OTHER_DOMAIN]) await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${d}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, '${SLUG}${orgId.slice(0, 8)}', 'PD-43 give sign-in QA academy')`,
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
  await strict(false);
  await truncate(g.prisma);
  for (const d of [DOMAIN, OTHER_DOMAIN]) await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${d}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('1. POST /teachers/:id/sign-in', () => {
  it('the Teachers manager gives a login to a teacher who has none: same teacher, a code once, then they sign in', async () => {
    const id = await legacyTeacher();
    const address = email('a');
    const r = await give(m.teachersManager.subject, id, { email: `  ${address.toUpperCase()} ` });
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toMatchObject({ teacherId: id, signIn: address, firstLogin: { code: expect.stringMatching(/^[0-9]{6}$/), emailed: false } });

    const teacher = await g.prisma.teacher.findUniqueOrThrow({ where: { id }, include: { account: true } });
    expect(teacher.account).toMatchObject({ subject: address, kind: 'teacher', status: 'provisioned', isActive: false });
    expect((await g.prisma.teacherFile.findUnique({ where: { teacherId: id } }))?.email).toBe(address);

    expect((await http(null, 'POST', '/auth/password-reset', { username: address, code: r.json.firstLogin.code, password: '1234' })).status).toBe(201);
    expect((await app.get(AuthService).login(address, '1234')).actor.actorId).toBe(id);

    const audit = await g.prisma.auditLog.findMany({ where: { entityId: id, action: 'teacher.sign_in_given' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: m.teachersManager.id });
    expect(JSON.stringify(audit[0]!.after)).not.toContain('@');
  });

  it('keeps an e-mail already on the Teacher File', async () => {
    const id = await legacyTeacher();
    await g.prisma.teacherFile.create({ data: { teacherId: id, organizationId: orgId, email: `on-file-${++seq}@${DOMAIN}` } });
    const before = (await g.prisma.teacherFile.findUniqueOrThrow({ where: { teacherId: id } })).email;
    expect((await give(m.teachersManager.subject, id, { email: email('b') })).status).toBe(201);
    expect((await g.prisma.teacherFile.findUniqueOrThrow({ where: { teacherId: id } })).email).toBe(before);
  });

  it('a teacher supervisor gives a login only to a teacher they reach', async () => {
    const mine = await legacyTeacher();
    await g.prisma.$executeRaw`INSERT INTO chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id, assigned_by, reason)
      VALUES (${mine}::uuid, ${orgId}::uuid, ${m.teacherSupervisors[0]!.id}::uuid, ${m.teachersManager.id}::uuid, 'spec')`;
    const theirs = await legacyTeacher();
    await strict(true);
    try {
      const refused = await give(m.teacherSupervisors[0]!.subject, theirs, { email: email('c') });
      expect([refused.status, refused.code]).toEqual([404, 'COMM.TEACHER_FILE_NOT_FOUND']);
      expect((await give(m.teacherSupervisors[0]!.subject, mine, { email: email('d') })).status).toBe(201);
    } finally {
      await strict(false);
    }
    // Strict scope off: the whole department reaches every teacher.
    expect((await give(m.teacherSupervisors[0]!.subject, theirs, { email: email('e') })).status).toBe(201);
  });
});

describe('2. refusals', () => {
  it('a teacher with a login (used or not), an inactive one, an unknown one', async () => {
    const withLogin = await give(m.teachersManager.subject, m.teachers[0]!.id, { email: email('f') });
    expect([withLogin.status, withLogin.code]).toEqual([409, 'COMM.TEACHER_HAS_SIGN_IN']);
    const waiting = await legacyTeacher();
    expect((await give(m.teachersManager.subject, waiting, { email: email('g') })).status).toBe(201);
    const twice = await give(m.teachersManager.subject, waiting, { email: email('h') });
    expect([twice.status, twice.code]).toEqual([409, 'COMM.TEACHER_HAS_SIGN_IN']);

    const gone = await legacyTeacher();
    await g.prisma.$queryRaw`SELECT chat.deactivate_principal('teacher', ${gone}::uuid, 'spec', ${m.teachersManager.id}::uuid)::text`;
    const inactive = await give(m.teachersManager.subject, gone, { email: email('i') });
    expect([inactive.status, inactive.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);

    const unknown = await give(m.teachersManager.subject, randomUUID(), { email: email('j') });
    expect([unknown.status, unknown.code]).toEqual([404, 'COMM.TEACHER_FILE_NOT_FOUND']);
  });

  it('nobody outside the Teachers department; a malformed e-mail is 400', async () => {
    const id = await legacyTeacher();
    for (const who of [m.supervisors[0]!, m.operationsManager, m.salesManager]) {
      const r = await give(who.subject, id, { email: email('k') });
      expect([who.subject, r.status, r.code]).toEqual([who.subject, 403, 'COMM.TEACHER_ONBOARDING_DENIED']);
    }
    const bad = await give(m.teachersManager.subject, id, { email: 'not-an-email' });
    expect([bad.status, bad.code]).toEqual([400, 'COMMON.VALIDATION']);
    expect((await g.prisma.teacher.findUniqueOrThrow({ where: { id } })).accountId).toBeNull();
  });

  it('gate P2-5: a sign-in in use is one identical answer unless it is a teacher the caller reaches', async () => {
    const other = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${other}'::uuid, '${SLUG}${other.slice(0, 8)}', 'PD-43 other academy')`);
    const foreign = await g.prisma.account.create({ data: { organizationId: other, subject: `elsewhere@${OTHER_DOMAIN}`, kind: 'family', status: 'active', isActive: true } });
    const id = await legacyTeacher();
    const answers = [];
    for (const taken of [foreign.subject, m.families[0]!.parent.subject]) {
      const r = await give(m.teachersManager.subject, id, { email: taken });
      answers.push({ status: r.status, body: r.json });
    }
    expect(answers[0]).toMatchObject({ status: 409, body: { error: { code: 'COMM.TEACHER_EMAIL_UNAVAILABLE' } } });
    expect(answers[1]).toEqual(answers[0]);
    const named = await give(m.teachersManager.subject, id, { email: m.teachers[1]!.subject });
    expect([named.status, named.code]).toEqual([409, 'COMM.TEACHER_ALREADY_ADDED']);
    expect(named.json.error?.detail).toEqual({ teacher: { id: m.teachers[1]!.id, name: m.teachers[1]!.name } });
  });
});

describe('3. one transaction, one login', () => {
  it('the login, the link and the code share a transaction id', async () => {
    const id = await legacyTeacher();
    expect((await give(m.teachersManager.subject, id, { email: email('l') })).status).toBe(201);
    const [row] = await g.prisma.$queryRaw<Array<{ teacher: string; account: string; code: string }>>`
      SELECT t.xmin::text AS teacher, a.xmin::text AS account,
             (SELECT p.xmin::text FROM chat.password_reset_code p WHERE p.account_id = a.id AND p.used_at IS NULL AND p.superseded_at IS NULL) AS code
        FROM chat.teacher t JOIN chat.account a ON a.id = t.account_id WHERE t.id = ${id}::uuid`;
    expect(new Set([row!.teacher, row!.account, row!.code]).size).toBe(1);
  });

  it('two calls at once make one login', async () => {
    const id = await legacyTeacher();
    const results = await Promise.all([give(m.teachersManager.subject, id, { email: email('m') }), give(m.teachersManager.subject, id, { email: email('n') })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await g.prisma.account.count({ where: { teacher: { id } } })).toBe(1);
  });
});

describe('4. the Teacher File tells the page', () => {
  it('signIn.status and canManageSignIn', async () => {
    const none = await legacyTeacher();
    const file = await http(m.teachersManager.subject, 'GET', `/teacher-files/${none}`);
    expect(file.json).toMatchObject({ signIn: { status: 'none' }, access: { canManageSignIn: true } });
    expect((await http(m.teachersManager.subject, 'GET', `/teacher-files/${m.teachers[0]!.id}`)).json.signIn).toEqual({ status: 'active' });
    expect((await http(m.teacherSupervisors[0]!.subject, 'GET', `/teacher-files/${none}`)).json.access.canManageSignIn).toBe(true);
    const list = await http(m.teachersManager.subject, 'GET', '/teacher-files');
    expect(list.json.teachers.find((t: { id: string }) => t.id === none)).toMatchObject({ signIn: 'none' });
  });
});
