/**
 * PD-43 PR-2 over real HTTP: adding a teacher and handing over the first
 * sign-in code.
 *
 *   1. POST /teachers (teachers.create): the Teachers manager names any
 *      primary supervisor or none, a teacher supervisor "self" or none; the
 *      response carries the code ONCE, its expiry and whether it was e-mailed
 *      (no mailer here: emailed false). The teacher signs in with it.
 *   2. Gate P2-7: the teacher, their supervision chat and the code are written
 *      by ONE transaction (the rows share a transaction id).
 *   3. Gate P2-5: a sign-in already in use answers the same for another
 *      organization's account, this organization's parent, and a teacher the
 *      caller does not reach -- nothing to tell them apart; only a teacher the
 *      caller reaches is named. There is no e-mail-check endpoint.
 *   4. POST /teachers/:id/first-login-code (owner 2026-10-28, "E-mail only;
 *      managers can see"): only the super admin, the Teachers manager and the
 *      teacher's CURRENT supervisor reissue; the code is always e-mailed; only
 *      the manager and the super admin see it. A former or out-of-reach
 *      supervisor gets 404 before anything else. Ten codes an hour at most.
 *   6. G2: the code is e-mailed after the commit; a failed send logs the
 *      code's id only (a fake mailer stands in for SMTP).
 *   5. GET /teacher-files tells the page whether to offer "Add teacher" and
 *      which supervisors it may name.
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
import { FIRST_LOGIN_MAILER, type MailSender } from '../../src/account-recovery/recovery-delivery';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd43-add-teacher-spec-password-1';
const DOMAIN = 'pd43add.qa.jawwid.test';
const OTHER_DOMAIN = 'pd43other.qa.jawwid.test';
const SLUG = 'pd43a-';

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
// Every case adds 'QA Added Teacher' again; the same-name warning (section 7) has its own cases.
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

describe('1. POST /teachers', () => {
  it('the Teachers manager adds a teacher; the code comes back once; the teacher signs in with it', async () => {
    const address = email('a');
    const r = await add(m.teachersManager.subject, { email: address, phone: '+20 100 555 0001', supervisorId: m.teacherSupervisors[0]!.id });
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toMatchObject({
      teacher: { id: expect.any(String), name: 'QA Added Teacher', supervisorId: m.teacherSupervisors[0]!.id },
      signIn: address,
      firstLogin: { code: expect.stringMatching(/^[0-9]{6}$/), expiresAt: expect.any(String), emailed: false },
    });
    expect(new Date(r.json.firstLogin.expiresAt).getTime() - Date.now()).toBeGreaterThan(71 * 3_600_000);

    const done = await http(null, 'POST', '/auth/password-reset', { username: address, code: r.json.firstLogin.code, password: '1234' });
    // POST /auth/password-reset answers 200 (@HttpCode), not 201.
    expect(done.status).toBe(200);
    expect((await app.get(AuthService).login(address, '1234')).accessToken).toEqual(expect.any(String));
  });

  it('a teacher supervisor adds for themselves ("self") or with no supervisor; never for a colleague', async () => {
    const me = m.teacherSupervisors[0]!;
    const mine = await add(me.subject, { email: email('b'), supervisorId: 'self' });
    expect([mine.status, mine.json.teacher?.supervisorId]).toEqual([201, me.id]);
    const none = await add(me.subject, { email: email('c'), supervisorId: null });
    expect([none.status, none.json.teacher?.supervisorId]).toEqual([201, null]);
    const colleague = await add(me.subject, { email: email('d'), supervisorId: m.teacherSupervisors[1]!.id });
    expect([colleague.status, colleague.code]).toEqual([403, 'COMM.TEACHER_ONBOARDING_DENIED']);
  });

  it('nobody outside the Teachers department adds a teacher', async () => {
    for (const who of [m.supervisors[0]!, m.operationsManager, m.salesManager]) {
      const r = await add(who.subject, { email: email('e') });
      expect([who.subject, r.status, r.code]).toEqual([who.subject, 403, 'COMM.TEACHER_ONBOARDING_DENIED']);
    }
    expect((await add(m.teachers[0]!.subject, { email: email('f') })).status).toBe(403);
  });

  it('a malformed request is 400 and writes nothing', async () => {
    const before = await g.prisma.teacher.count({ where: { organizationId: orgId } });
    for (const body of [{ email: 'not-an-email' }, { email: email('g'), name: ' ' }, { email: email('h'), id: 'nope' }, { email: email('i'), phone: 'x' }]) {
      const r = await http(m.teachersManager.subject, 'POST', '/teachers', { id: randomUUID(), name: 'QA Added Teacher', confirmSimilarName: true, ...body });
      expect([JSON.stringify(body), r.status, r.code]).toEqual([JSON.stringify(body), 400, 'COMMON.VALIDATION']);
    }
    expect(await g.prisma.teacher.count({ where: { organizationId: orgId } })).toBe(before);
  });

  it('the same request twice is the same teacher, with a fresh code that kills the first', async () => {
    const body = { id: randomUUID(), name: 'QA Added Teacher', email: email('j'), confirmSimilarName: true };
    const first = await http(m.teachersManager.subject, 'POST', '/teachers', body);
    const again = await http(m.teachersManager.subject, 'POST', '/teachers', body);
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.json.teacher.id).toBe(first.json.teacher.id);
    const account = await g.prisma.account.findUniqueOrThrow({ where: { subject: body.email } });
    expect(await g.prisma.passwordResetCode.count({ where: { accountId: account.id, usedAt: null, supersededAt: null } })).toBe(1);
  });
});

describe('2. gate P2-7: one transaction', () => {
  it('the teacher, the login, the supervision chat and the code share one transaction id', async () => {
    const r = await add(m.teachersManager.subject, { email: email('k') });
    const id = r.json.teacher.id as string;
    const [row] = await g.prisma.$queryRaw<Array<{ teacher: string; account: string; conversation: string; code: string; members: number }>>`
      SELECT t.xmin::text AS teacher, a.xmin::text AS account,
             (SELECT c.xmin::text FROM chat.conversation c WHERE c.supervised_teacher_id = t.id AND c.type = 'teacher_supervision') AS conversation,
             (SELECT p.xmin::text FROM chat.password_reset_code p WHERE p.account_id = a.id AND p.used_at IS NULL AND p.superseded_at IS NULL) AS code,
             (SELECT count(*)::int FROM chat.conversation_member cm JOIN chat.conversation c ON c.id = cm.conversation_id
               WHERE c.supervised_teacher_id = t.id AND cm.actor_id = t.id AND cm.left_at IS NULL) AS members
        FROM chat.teacher t JOIN chat.account a ON a.id = t.account_id WHERE t.id = ${id}::uuid`;
    expect(row).toMatchObject({ members: 1 });
    expect(new Set([row!.teacher, row!.account, row!.conversation, row!.code]).size).toBe(1);
  });
});

describe('3. gate P2-5: a sign-in already in use', () => {
  it('another organization, this organization\'s parent, a teacher out of reach: one identical answer', async () => {
    const other = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${other}'::uuid, '${SLUG}${other.slice(0, 8)}', 'PD-43 other academy')`);
    const foreign = await g.prisma.account.create({ data: { organizationId: other, subject: `elsewhere@${OTHER_DOMAIN}`, kind: 'family', status: 'active', isActive: true } });

    // A teacher out of the second supervisor's reach under strict scope.
    const theirs = await add(m.teacherSupervisors[0]!.subject, { email: email('l'), supervisorId: 'self' });
    expect(theirs.status).toBe(201);

    await strict(true);
    try {
      const answers = [];
      for (const taken of [foreign.subject, m.families[0]!.parent.subject, theirs.json.signIn as string]) {
        const r = await add(m.teacherSupervisors[1]!.subject, { email: taken.toUpperCase(), supervisorId: 'self' });
        answers.push({ status: r.status, code: r.code, body: r.json });
        expect(r.text).not.toMatch(/elsewhere|parent|QA Added Teacher|family|organization/i);
      }
      expect(answers[0]).toMatchObject({ status: 409, code: 'COMM.TEACHER_EMAIL_UNAVAILABLE' });
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);

      // The Teachers manager reaches every teacher: that one is named.
      const named = await add(m.teachersManager.subject, { email: theirs.json.signIn });
      expect([named.status, named.code]).toEqual([409, 'COMM.TEACHER_ALREADY_ADDED']);
      expect(named.json.error?.detail).toEqual({ teacher: { id: theirs.json.teacher.id, name: 'QA Added Teacher' } });
    } finally {
      await strict(false);
    }
  });

  it('a contact on the file of a teacher out of reach is the same answer as an e-mail out of reach', async () => {
    const theirs = await add(m.teacherSupervisors[0]!.subject, { email: email('u'), phone: '+20 122 333 4445', supervisorId: 'self' });
    expect(theirs.status).toBe(201);
    await strict(true);
    try {
      const byPhone = await add(m.teacherSupervisors[1]!.subject, { email: email('v'), phone: '+201223334445', supervisorId: 'self' });
      const byEmail = await add(m.teacherSupervisors[1]!.subject, { email: m.families[0]!.parent.subject, supervisorId: 'self' });
      expect({ status: byPhone.status, body: byPhone.json }).toEqual({ status: byEmail.status, body: byEmail.json });
      expect(byPhone.code).toBe('COMM.TEACHER_EMAIL_UNAVAILABLE');
    } finally {
      await strict(false);
    }
    // A teacher the caller reaches is named.
    const named = await add(m.teachersManager.subject, { email: email('w'), phone: '+20 122 333 4445' });
    expect([named.status, named.code]).toEqual([409, 'COMM.TEACHER_CONTACT_TAKEN']);
    expect(named.json.error?.detail).toEqual({ teacher: { id: theirs.json.teacher.id, name: 'QA Added Teacher' } });
  });

  it('there is no e-mail-check endpoint', async () => {
    for (const path of ['/teachers/email-check', '/teachers/check-email', `/teachers/by-email/${encodeURIComponent(m.teachers[0]!.subject)}`]) {
      const r = await http(m.teachersManager.subject, 'GET', path);
      expect([path, r.status]).toEqual([path, 404]);
    }
  });
});

describe('4. POST /teachers/:id/first-login-code (owner: "E-mail only; managers can see")', () => {
  const reissue = (subject: string, id: string) => http(subject, 'POST', `/teachers/${id}/first-login-code`, { reason: 'lost the code' });
  const assign = (teacherId: string, supervisorId: string) =>
    g.prisma.$executeRaw`UPDATE chat.teacher_supervisor_assignment SET supervisor_id = ${supervisorId}::uuid WHERE teacher_id = ${teacherId}::uuid`;

  it('the Teachers manager reissues and sees the code; the old code dies; never once the teacher has signed in', async () => {
    const address = email('m');
    const first = await add(m.teachersManager.subject, { email: address });
    const id = first.json.teacher.id as string;
    const again = await reissue(m.teachersManager.subject, id);
    expect([again.status, again.headers.get('cache-control')]).toEqual([201, 'no-store']);
    expect(again.json).toMatchObject({ teacherId: id, signIn: address, firstLogin: { code: expect.stringMatching(/^[0-9]{6}$/), emailed: false } });
    if (again.json.firstLogin.code !== first.json.firstLogin.code) {
      expect((await http(null, 'POST', '/auth/password-reset', { username: address, code: first.json.firstLogin.code, password: '1234' })).status).toBe(401);
    }
    expect((await http(null, 'POST', '/auth/password-reset', { username: address, code: again.json.firstLogin.code, password: '1234' })).status).toBe(200);
    const after = await reissue(m.teachersManager.subject, id);
    expect([after.status, after.code]).toEqual([409, 'COMM.TEACHER_ALREADY_SIGNED_IN']);
  });

  it('the CURRENT supervisor reissues but never sees the code: it is e-mailed, or they are told to ask the Manager', async () => {
    const me = m.teacherSupervisors[0]!;
    const r = await add(m.teachersManager.subject, { email: email('n'), supervisorId: me.id });
    mailer.available = true;
    try {
      const sent = await reissue(me.subject, r.json.teacher.id);
      expect(sent.status).toBe(201);
      expect(sent.json.firstLogin).toEqual({ expiresAt: expect.any(String), emailed: true });
      expect(sent.text).not.toMatch(/"code"/);
    } finally {
      mailer.available = false;
    }
    const unsent = await reissue(me.subject, r.json.teacher.id);
    expect(unsent.json.firstLogin).toEqual({ expiresAt: expect.any(String), emailed: false });
  });

  it('a FORMER supervisor, the one who added it, or one out of reach: 404, before any other answer', async () => {
    const [a, b] = [m.teacherSupervisors[0]!, m.teacherSupervisors[1]!];
    // Added by a with themselves, then handed to b: a no longer reissues.
    const moved = await add(a.subject, { email: email('o'), supervisorId: 'self' });
    await assign(moved.json.teacher.id, b.id);
    expect(await reissue(a.subject, moved.json.teacher.id)).toMatchObject({ status: 404, code: 'COMM.TEACHER_FILE_NOT_FOUND' });
    expect((await reissue(b.subject, moved.json.teacher.id)).status).toBe(201);
    // Added by a with no supervisor: having added it is not enough.
    const none = await add(a.subject, { email: email('p'), supervisorId: null });
    expect(await reissue(a.subject, none.json.teacher.id)).toMatchObject({ status: 404, code: 'COMM.TEACHER_FILE_NOT_FOUND' });
    // Out of reach AND already signed in: still 404, never the 409 that would tell.
    expect(await reissue(a.subject, m.teachers[9]!.id)).toMatchObject({ status: 404, code: 'COMM.TEACHER_FILE_NOT_FOUND' });
    // Outside the department, or an unknown teacher.
    const ops = await reissue(m.supervisors[0]!.subject, moved.json.teacher.id);
    expect([ops.status, ops.code]).toEqual([403, 'COMM.TEACHER_ONBOARDING_DENIED']);
    expect(await reissue(m.teachersManager.subject, randomUUID())).toMatchObject({ status: 404, code: 'COMM.TEACHER_FILE_NOT_FOUND' });
  });

  it('a suspended login is reported as suspended, not as signed in', async () => {
    const r = await add(m.teachersManager.subject, { email: email('q') });
    const account = await g.prisma.account.findUniqueOrThrow({ where: { subject: r.json.signIn } });
    await g.prisma.account.update({ where: { id: account.id }, data: { status: 'suspended', isActive: false } });
    const answer = await reissue(m.teachersManager.subject, r.json.teacher.id);
    expect([answer.status, answer.code]).toEqual([409, 'COMM.TEACHER_SIGN_IN_SUSPENDED']);
  });

  it('ten codes an hour per login, the first one included', async () => {
    const r = await add(m.teachersManager.subject, { email: email('r') });
    const statuses = [];
    for (let i = 0; i < 10; i++) statuses.push((await reissue(m.teachersManager.subject, r.json.teacher.id)).status);
    expect(statuses.slice(0, 9)).toEqual(Array(9).fill(201));
    expect(statuses[9]).toBe(429);
  });
});

describe('6. G2: the e-mail', () => {
  it('goes to the sign-in address after the commit; the code is not in the subject', async () => {
    mailer.available = true;
    mailer.sent.length = 0;
    try {
      const address = email('s');
      const r = await add(m.teachersManager.subject, { email: address });
      expect(r.json.firstLogin.emailed).toBe(true);
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]).toMatchObject({ to: address, committed: true });
      expect(mailer.sent[0]!.text.split('\n')).toContain(r.json.firstLogin.code);
      expect(mailer.sent[0]!.subject).not.toContain(r.json.firstLogin.code);
    } finally {
      mailer.available = false;
    }
  });

  it('a failed send: emailed false, and the log names the code\'s id only', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(function (this: Logger, ...args: unknown[]) {
      lines.push(args.map(String).join(' '));
    });
    mailer.available = true;
    mailer.fail = true;
    try {
      const address = email('t');
      const r = await add(m.teachersManager.subject, { email: address });
      expect(r.status).toBe(201);
      expect(r.json.firstLogin.emailed).toBe(false);
      const account = await g.prisma.account.findUniqueOrThrow({ where: { subject: address } });
      const code = await g.prisma.passwordResetCode.findFirstOrThrow({ where: { accountId: account.id, usedAt: null, supersededAt: null } });
      const line = lines.find((l) => l.includes(code.id));
      expect(line).toBeDefined();
      expect(line).not.toContain(r.json.firstLogin.code);
      expect(line).not.toContain(address);
      expect(line).not.toMatch(/mailbox unavailable/);
    } finally {
      mailer.available = false;
      mailer.fail = false;
      spy.mockRestore();
    }
  });
});

describe('5. GET /teacher-files offers the form', () => {
  it('tells each reader what they may do', async () => {
    const manager = await http(m.teachersManager.subject, 'GET', '/teacher-files');
    expect(manager.json.onboarding).toMatchObject({ canAdd: true, supervisorChoice: 'any' });
    expect(manager.json.onboarding.supervisors.map((s: { id: string }) => s.id).sort()).toEqual(m.teacherSupervisors.map((s) => s.id).sort());
    const supervisor = await http(m.teacherSupervisors[0]!.subject, 'GET', '/teacher-files');
    expect(supervisor.json.onboarding).toEqual({ canAdd: true, supervisorChoice: 'self_or_none', supervisors: [], selfId: m.teacherSupervisors[0]!.id });

  });

  it('a Teacher File says whether its sign-in waits and who may send a new code', async () => {
    const r = await add(m.teachersManager.subject, { email: email('x'), supervisorId: m.teacherSupervisors[0]!.id });
    const id = r.json.teacher.id as string;
    const as = async (subject: string) => (await http(subject, 'GET', `/teacher-files/${id}`)).json.signIn;
    expect(await as(m.teachersManager.subject)).toEqual({ status: 'provisioned', canSendCode: true, canGive: false });
    expect(await as(m.teacherSupervisors[0]!.subject)).toEqual({ status: 'provisioned', canSendCode: true, canGive: false });
    // Strict scope off, the other supervisor reads the file but is not the current supervisor.
    expect(await as(m.teacherSupervisors[1]!.subject)).toEqual({ status: 'provisioned', canSendCode: false, canGive: false });
    expect((await http(m.teachersManager.subject, 'GET', `/teacher-files/${m.teachers[0]!.id}`)).json.signIn).toEqual({ status: 'active', canSendCode: false, canGive: false });
  });
});

describe('7. the same name as an active teacher (plan §3.4): a warning the adder may pass', () => {
  it('warns, naming the teacher, with names folded the PD-42 way; nothing is written until confirmed', async () => {
    const first = await add(m.teachersManager.subject, { name: 'معلمة الاختبار المشابه', email: email('sn'), confirmSimilarName: undefined });
    expect(first.status).toBe(201);
    const second = email('sn');
    // Teh marbuta, hamza on alef, case and spacing: the same name.
    const warned = await add(m.teachersManager.subject, { name: '  معلمه   الإختبار المشابه ', email: second, confirmSimilarName: undefined });
    expect([warned.status, warned.code]).toEqual([409, 'COMM.TEACHER_SIMILAR_NAME']);
    expect(warned.json.error?.detail).toEqual({ teachers: [{ id: first.json.teacher.id, name: 'معلمة الاختبار المشابه' }] });
    expect(await g.prisma.account.count({ where: { subject: second } })).toBe(0);
    const anyway = await add(m.teachersManager.subject, { name: '  معلمه   الإختبار المشابه ', email: second, confirmSimilarName: true });
    expect(anyway.status).toBe(201);

    const latin = await add(m.teachersManager.subject, { name: 'QA Similar Latin', email: email('sn'), confirmSimilarName: undefined });
    expect(latin.status).toBe(201);
    const latinAgain = await add(m.teachersManager.subject, { name: 'qa  SIMILAR latin', email: email('sn'), confirmSimilarName: undefined });
    expect(latinAgain.code).toBe('COMM.TEACHER_SIMILAR_NAME');
  });

  it('a teacher who has left is not a match', async () => {
    const gone = await add(m.teachersManager.subject, { name: 'QA Departed Name', email: email('sn'), confirmSimilarName: undefined });
    await g.prisma.$executeRaw`UPDATE chat.teacher SET is_active = false, left_at = now() WHERE id = ${gone.json.teacher.id as string}::uuid`;
    const again = await add(m.teachersManager.subject, { name: 'QA Departed Name', email: email('sn'), confirmSimilarName: undefined });
    expect(again.status).toBe(201);
  });

  it('a teacher out of the adder\'s reach is never named, and no warning hints at one', async () => {
    await strict(true);
    try {
      const theirs = await add(m.teacherSupervisors[0]!.subject, { name: 'QA Scoped Name', email: email('sn'), supervisorId: 'self', confirmSimilarName: undefined });
      expect(theirs.status).toBe(201);
      const mine = await add(m.teacherSupervisors[1]!.subject, { name: 'QA Scoped Name', email: email('sn'), supervisorId: 'self', confirmSimilarName: undefined });
      expect(mine.status).toBe(201);
      // The Teachers manager sees both.
      const manager = await add(m.teachersManager.subject, { name: 'QA Scoped Name', email: email('sn'), confirmSimilarName: undefined });
      expect(manager.code).toBe('COMM.TEACHER_SIMILAR_NAME');
      expect((manager.json.error?.detail as { teachers: unknown[] }).teachers).toHaveLength(2);
    } finally {
      await strict(false);
    }
  });
});
