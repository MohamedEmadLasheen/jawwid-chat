/**
 * PD-43 teacher history (plan §4: GET /teachers/:id/history, teacher_files.view).
 *
 *   1. The teacher's lifecycle, newest first: added, sign-in given or
 *      changed, supervisor assigned or removed, offboarded, reactivated; and
 *      their login's: a first sign-in code sent, activated, a password reset,
 *      suspended or reactivated through Accounts. Who, when, and the reason.
 *   2. Never a raw audit value: no e-mail, no phone, no code; a supervisor
 *      change names the supervisors.
 *   3. Who may: as the Teacher File (strict scope included); anyone else 403
 *      (Teacher Files are administration-only) or 404 out of scope.
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
const PASSWORD = 'pd43-history-spec-password-1';
const DOMAIN = 'pd43hist.qa.jawwid.test';
const OTHER_DOMAIN = 'pd43histother.qa.jawwid.test';
const SLUG = 'pd43h-';

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
// Every case adds 'QA Added Teacher' again: past the same-name warning.
const add = (subject: string, body: Record<string, unknown>) =>
  http(subject, 'POST', '/teachers', { id: randomUUID(), name: 'QA Added Teacher', confirmSimilarName: true, ...body });

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


const history = (subject: string, id: string) => http(subject, 'GET', `/teachers/${id}/history`);
type Event = { at: string; action: string; actor: { id: string; name: string } | null; reason: string | null; detail: Record<string, unknown> };

describe('1. the lifecycle, newest first', () => {
  it('added, a code sent again, signed in, offboarded, reactivated: each with who and why', async () => {
    const address = email('h');
    const added = await add(m.teachersManager.subject, { email: address, supervisorId: m.teacherSupervisors[0]!.id });
    const id = added.json.teacher.id as string;
    expect((await http(m.teachersManager.subject, 'POST', `/teachers/${id}/first-login-code`, { reason: 'lost the e-mail' })).status).toBe(201);
    const code = (await http(m.teachersManager.subject, 'POST', `/teachers/${id}/first-login-code`, {})).json.firstLogin.code as string;
    expect((await http(null, 'POST', '/auth/password-reset', { username: address, code, password: '1234' })).status).toBe(200);
    expect((await offboard(m.teachersManager.subject, id)).status).toBe(201);
    expect((await reactivate(m.superAdmin.subject, id)).status).toBe(201);

    const r = await history(m.teachersManager.subject, id);
    expect(r.status).toBe(200);
    expect(r.json.teacherId).toBe(id);
    const events = r.json.events as Event[];
    const actions = events.map((e) => e.action);
    // Newest first. Reactivation writes its row and the new code's in ONE
    // transaction: same time, so the two lead together (the later write first).
    expect(actions.slice(0, 2).sort()).toEqual(['account.first_login_code_issued', 'teacher.reactivated']);
    expect(actions).toEqual(expect.arrayContaining([
      'teacher.created', 'account.first_login_code_issued', 'account.activated', 'teacher.offboarded', 'teacher.reactivated',
    ]));
    expect(actions.lastIndexOf('teacher.created')).toBe(actions.length - 1);
    expect(actions.filter((a) => a === 'account.first_login_code_issued').length).toBeGreaterThanOrEqual(3);
    const times = events.map((e) => Date.parse(e.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const offboarded = events.find((e) => e.action === 'teacher.offboarded')!;
    expect(offboarded).toMatchObject({ actor: { id: m.teachersManager.id, name: expect.any(String) }, reason: 'left the academy' });
    expect(events.find((e) => e.action === 'teacher.reactivated')).toMatchObject({ actor: { id: m.superAdmin.id }, reason: 'rejoined' });
    // Session bookkeeping is not the teacher's history.
    expect(actions).not.toContain('session.revoked');
  });

  it('a supervisor change names both supervisors', async () => {
    const id = (await add(m.teachersManager.subject, { email: email('h'), supervisorId: m.teacherSupervisors[0]!.id })).json.teacher.id as string;
    await g.prisma.auditLog.create({
      data: {
        actorId: m.teachersManager.id,
        action: 'teacher_supervisor.assigned',
        entity: 'teacher',
        entityId: id,
        before: { supervisorId: m.teacherSupervisors[0]!.id },
        after: { supervisorId: m.teacherSupervisors[1]!.id },
        reason: 'balance the load',
      },
    });
    const events = (await history(m.teachersManager.subject, id)).json.events as Event[];
    expect(events[0]).toMatchObject({
      action: 'teacher_supervisor.assigned',
      reason: 'balance the load',
      detail: { from: { id: m.teacherSupervisors[0]!.id, name: m.teacherSupervisors[0]!.name }, to: { id: m.teacherSupervisors[1]!.id, name: m.teacherSupervisors[1]!.name } },
    });
  });
});

describe('2. never a raw audit value', () => {
  it('no e-mail, no phone, no code id in the answer', async () => {
    const r = await add(m.teachersManager.subject, { email: email('h'), phone: '+20 100 555 0199' });
    const body = (await history(m.teachersManager.subject, r.json.teacher.id as string)).text;
    expect(body).not.toContain('@');
    // The number itself, typed or as digits -- never a fragment a random uuid could hold.
    expect(body).not.toContain('100 555 0199');
    expect(body).not.toContain('1005550199');
    expect(body).not.toMatch(/supersedes|codeId|hasPhone/);
  });
});

describe('3. who may read it', () => {
  it('as the Teacher File: outside the Teachers department 403; a teacher out of a strict supervisor\'s scope 404', async () => {
    const id = (await add(m.teachersManager.subject, { email: email('h'), supervisorId: m.teacherSupervisors[0]!.id })).json.teacher.id as string;
    const ops = await history(m.supervisors[0]!.subject, id);
    expect([ops.status, ops.code]).toEqual([403, 'COMM.TEACHER_FILE_DENIED']);
    expect((await history(m.teacherSupervisors[0]!.subject, id)).status).toBe(200);
    await strict(true);
    try {
      const other = await history(m.teacherSupervisors[1]!.subject, id);
      expect([other.status, other.code]).toEqual([404, 'COMM.TEACHER_FILE_NOT_FOUND']);
    } finally {
      await strict(false);
    }
    expect((await history(m.superAdmin.subject, id)).status).toBe(200);
  });
});
