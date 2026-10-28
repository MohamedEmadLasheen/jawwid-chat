/**
 * PD-43 PR-1b over real HTTP: a teacher leaves, comes back, and the set-up
 * checklist (plan §3.5, §3.6).
 *
 *   1. GET /teachers/:id/offboard-preview: the students still assigned and the
 *      open lessons -- what must move or be cancelled first.
 *   2. POST /teachers/:id/offboard (teachers.offboard: the Teachers manager,
 *      the super admin): refused while any student remains (in SQL too) and
 *      while lessons are open unless cancelOpenLessons; then, in one
 *      transaction, the teacher and the login are closed, the sessions ended,
 *      the supervisor link and any waiting code removed, and it is audited.
 *      Nothing is deleted: the file and its history stay readable.
 *   3. POST /teachers/:id/reactivate: the super admin only (owner Q6); the
 *      same teacher, a waiting login and a new first sign-in code, e-mailed
 *      and shown to the super admin.
 *   4. chat.teacher: an inactive teacher has a leaving date, and the writers refuse a
 *      request role.
 *   5. The set-up checklist on the Teacher File, and the count on the list.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
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
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialService } from '../../src/lessons/trial.service';
import { FIRST_LOGIN_MAILER, type MailSender } from '../../src/account-recovery/recovery-delivery';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd43-offboarding-spec-password-1';
const DOMAIN = 'pd43off.qa.jawwid.test';
const OTHER_DOMAIN = 'pd43offother.qa.jawwid.test';
const SLUG = 'pd43f-';

const g = buildGraph();
let m: SeedManifest;
let orgId: string;
let app: INestApplication;
let base: string;

/** Stands in for SMTP. Off by default (no channel: emailed false), as in CI. */
interface FakeMailer extends MailSender {
  available: boolean;
  fail: boolean;
  sent: Array<{ to: string; subject: string; text: string; committed: boolean }>;
}
const mailer: FakeMailer = {
  available: false,
  fail: false,
  sent: [],
  async send(to, mail) {
    if (mailer.fail) throw Object.assign(new Error(`550 mailbox unavailable <${to}>`), { name: 'SMTPError', responseCode: 550 });
    // Read OUTSIDE the request's transaction: true only once it has committed.
    const committed = (await g.prisma.account.count({ where: { subject: to } })) === 1;
    mailer.sent.push({ to, ...mail, committed });
  },
};

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
const add = (subject: string, body: Record<string, unknown>) => http(subject, 'POST', '/teachers', { id: randomUUID(), name: 'QA Added Teacher', ...body });

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  for (const d of [DOMAIN, OTHER_DOMAIN]) await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${d}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, '${SLUG}${orgId.slice(0, 8)}', 'PD-43 QA academy')`,
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

async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

const offboard = (subject: string, id: string, body: Record<string, unknown> = {}) =>
  http(subject, 'POST', `/teachers/${id}/offboard`, { reason: 'left the academy', ...body });
const reactivate = (subject: string, id: string) => http(subject, 'POST', `/teachers/${id}/reactivate`, { reason: 'rejoined' });

/** A teacher with a login used once, and no students. */
async function signedInTeacher(label: string) {
  const address = email(label);
  const r = await add(m.teachersManager.subject, { email: address, supervisorId: m.teacherSupervisors[0]!.id });
  expect((await http(null, 'POST', '/auth/password-reset', { username: address, code: r.json.firstLogin.code, password: '1234' })).status).toBe(200);
  return { id: r.json.teacher.id as string, address };
}

/** A trial booked with the teacher (Sales books it), so the teacher has an open lesson and no student. */
async function bookTrial(teacherId: string) {
  await app.get(SchedulingService).setAvailability(m.teachersManager.id, teacherId, {
    timezone: 'Africa/Cairo',
    windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
  });
  const trials = app.get(TrialService);
  const prospect = await trials.createProspect(m.salesManager.id, { displayName: 'prospect_off', level: 'beginner' });
  const { slots } = await trials.slots(m.salesManager.id, teacherId, '30');
  return (await trials.book(m.salesManager.id, { prospectId: prospect.id, teacherId, startsAt: slots[3] })).id as string;
}

describe('1. the preview', () => {
  it('lists the students still assigned and the open lessons', async () => {
    const withStudents = m.teachers[0]!.id;
    const r = await http(m.teachersManager.subject, 'GET', `/teachers/${withStudents}/offboard-preview`);
    expect(r.status).toBe(200);
    expect(r.json.students.length).toBeGreaterThan(0);
    expect(r.json.students[0]).toEqual({ id: expect.any(String), name: expect.any(String) });
    expect(r.json).toMatchObject({ teacherId: withStudents, openLessons: expect.any(Array), canOffboard: false });
    const ops = await http(m.supervisors[0]!.subject, 'GET', `/teachers/${withStudents}/offboard-preview`);
    expect([ops.status, ops.code]).toEqual([403, 'COMM.TEACHER_ONBOARDING_DENIED']);
  });
});

describe('2. offboarding', () => {
  it('refused while any student remains -- by the API and by the database', async () => {
    const r = await offboard(m.teachersManager.subject, m.teachers[0]!.id);
    expect([r.status, r.code]).toEqual([409, 'COMM.TEACHER_HAS_STUDENTS']);
    expect(await sqlError(g.prisma.$queryRaw`SELECT chat.offboard_teacher(${m.teachers[0]!.id}::uuid, 'r', true, ${m.teachersManager.id}::uuid)`)).toMatch(
      /move this teacher's students to other teachers first/,
    );
    expect((await g.prisma.teacher.findUniqueOrThrow({ where: { id: m.teachers[0]!.id } })).isActive).toBe(true);
  });

  it('only the Teachers manager and the super admin offboard', async () => {
    const { id } = await signedInTeacher('a');
    for (const who of [m.teacherSupervisors[0]!, m.supervisors[0]!, m.operationsManager]) {
      const r = await offboard(who.subject, id);
      expect([who.subject, r.status, r.code]).toEqual([who.subject, 403, 'COMM.TEACHER_ONBOARDING_DENIED']);
    }
  });

  it('open lessons: refused unless cancelled with it; then cancelled', async () => {
    const { id } = await signedInTeacher('b');
    const lesson = await bookTrial(id);
    // The lessons that belong to no student (a trial) are listed, each one, before anything is cancelled.
    const preview = await http(m.teachersManager.subject, 'GET', `/teachers/${id}/offboard-preview`);
    expect(preview.json).toMatchObject({ students: [], canOffboard: true });
    expect(preview.json.openLessons).toEqual([{ id: lesson, kind: 'trial', startsAt: expect.any(String), endsAt: expect.any(String) }]);
    const refused = await offboard(m.teachersManager.subject, id);
    expect([refused.status, refused.code]).toEqual([409, 'COMM.TEACHER_HAS_OPEN_LESSONS']);
    const r = await offboard(m.teachersManager.subject, id, { cancelOpenLessons: true });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ teacherId: id, cancelledLessons: [lesson], notCancelled: [] });
    expect((await g.prisma.lesson.findUniqueOrThrow({ where: { id: lesson } })).outcome).not.toBeNull();
    // The confirmation and the lessons it covered are on the offboarding's own record.
    const [audit] = await g.prisma.auditLog.findMany({ where: { entityId: id, action: 'teacher.offboarded' } });
    expect(audit?.after).toMatchObject({ cancelOpenLessons: true, openLessons: [lesson] });
    expect(await g.prisma.auditLog.count({ where: { entityId: lesson, action: 'trial.cancelled', actorId: m.teachersManager.id } })).toBe(1);
  });

  it('closes the teacher and the login, ends the sessions and the supervisor link, keeps the file and history', async () => {
    const { id, address } = await signedInTeacher('c');
    const token = (await app.get(AuthService).login(address, '1234')).accessToken;
    const r = await offboard(m.teachersManager.subject, id);
    expect(r.status).toBe(201);
    const teacher = await g.prisma.teacher.findUniqueOrThrow({ where: { id }, include: { account: true } });
    expect(teacher).toMatchObject({ isActive: false, leftAt: expect.any(Date) });
    expect(teacher.account).toMatchObject({ status: 'deactivated', isActive: false });
    expect(await g.prisma.$queryRaw`SELECT 1 FROM chat.teacher_supervisor_assignment WHERE teacher_id = ${id}::uuid`).toEqual([]);
    await expect(app.get(AuthService).login(address, '1234')).rejects.toBeDefined();
    expect((await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await http(m.teachersManager.subject, 'GET', `/teacher-files/${id}`)).status).toBe(200);
    const audit = await g.prisma.auditLog.findMany({ where: { entityId: id, action: 'teacher.offboarded' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: m.teachersManager.id, reason: 'left the academy' });
    // Twice is refused, not a second record.
    const again = await offboard(m.teachersManager.subject, id);
    expect([again.status, again.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);
  });

  it('a login that never signed in is closed too, and its waiting code dies', async () => {
    const r = await add(m.teachersManager.subject, { email: email('d') });
    const id = r.json.teacher.id as string;
    expect((await offboard(m.teachersManager.subject, id)).status).toBe(201);
    expect((await g.prisma.account.findUniqueOrThrow({ where: { subject: r.json.signIn } })).status).toBe('deactivated');
    expect((await http(null, 'POST', '/auth/password-reset', { username: r.json.signIn, code: r.json.firstLogin.code, password: '1234' })).status).toBe(401);
  });
});

describe('3. reactivation', () => {
  it('the super admin only; the same teacher, a new first sign-in code; then they sign in again', async () => {
    const { id, address } = await signedInTeacher('e');
    expect((await offboard(m.teachersManager.subject, id)).status).toBe(201);
    const byManager = await reactivate(m.teachersManager.subject, id);
    expect([byManager.status, byManager.code]).toEqual([403, 'COMM.TEACHER_ONBOARDING_DENIED']);
    const r = await reactivate(m.superAdmin.subject, id);
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toMatchObject({ teacherId: id, signIn: address, firstLogin: { code: expect.stringMatching(/^[0-9]{6}$/), emailed: false } });
    const teacher = await g.prisma.teacher.findUniqueOrThrow({ where: { id }, include: { account: true } });
    expect(teacher).toMatchObject({ isActive: true, leftAt: null });
    expect(teacher.account?.status).toBe('provisioned');
    expect((await http(null, 'POST', '/auth/password-reset', { username: address, code: r.json.firstLogin.code, password: '5678' })).status).toBe(200);
    expect((await app.get(AuthService).login(address, '5678')).actor.actorId).toBe(id);
    expect(await g.prisma.auditLog.count({ where: { entityId: id, action: 'teacher.reactivated' } })).toBe(1);
    const active = await reactivate(m.superAdmin.subject, id);
    expect([active.status, active.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);
  });
});

describe('4. the database', () => {
  it('an inactive teacher has a leaving date, as on chat.staff', async () => {
    const id = (await add(m.teachersManager.subject, { email: email('f') })).json.teacher.id as string;
    const [c] = await g.prisma.$queryRaw<{ validated: boolean }[]>`
      SELECT convalidated AS validated FROM pg_constraint WHERE conname = 'teacher_left_at_matches_is_active'`;
    expect(c).toEqual({ validated: true });
    // A writer that forgets the date is given one; bringing the teacher back clears it.
    await g.prisma.$executeRaw`UPDATE chat.teacher SET is_active = false WHERE id = ${id}::uuid`;
    expect((await g.prisma.teacher.findUniqueOrThrow({ where: { id } })).leftAt).not.toBeNull();
    await g.prisma.$executeRaw`UPDATE chat.teacher SET is_active = true WHERE id = ${id}::uuid`;
    expect((await g.prisma.teacher.findUniqueOrThrow({ where: { id } })).leftAt).toBeNull();
  });

  it('a request role calls neither writer', async () => {
    for (const sql of [
      `select chat.offboard_teacher('${randomUUID()}'::uuid, 'r', false, '${m.teachersManager.id}'::uuid)`,
      `select chat.reactivate_teacher('${randomUUID()}'::uuid, 'r', '${m.superAdmin.id}'::uuid)`,
    ]) {
      const out = await sqlError(
        g.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('set local role chat_app');
          return tx.$queryRawUnsafe(sql);
        }),
      );
      expect(out).toMatch(/permission denied/);
    }
  });
});

describe('5. the set-up checklist', () => {
  it('on the Teacher File: what is done and what is missing; nothing about amounts', async () => {
    const r = await add(m.teachersManager.subject, { email: email('g'), phone: '+20 100 999 0001', supervisorId: m.teacherSupervisors[0]!.id });
    const id = r.json.teacher.id as string;
    const file = await http(m.teachersManager.subject, 'GET', `/teacher-files/${id}`);
    expect(file.json.setup).toEqual({
      signedIn: false,
      supervisor: true,
      contact: true,
      payTerms: false,
      payoutAccount: false,
      leaveAllowance: false,
      shift: false,
      availability: false,
      profile: false,
      payMatchesShift: true,
      missing: 7,
    });
    const list = await http(m.teachersManager.subject, 'GET', '/teacher-files');
    expect(list.json.teachers.find((t: { id: string }) => t.id === id)).toMatchObject({ setupMissing: 7 });
  });
});
