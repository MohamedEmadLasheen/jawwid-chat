/**
 * PD-10 Teacher File, step 1, end to end over the real HTTP routes.
 *
 * The synthetic PD-8 organization (src/cli/org-chat-seed.ts) is seeded into a
 * fresh tenant, then:
 *
 *   1. who may open a Teacher File at all -- every seeded role, by real token;
 *   2. a refused or foreign caller learns nothing about which ids exist;
 *   3. assigned students are exactly chat.learner.teacher_id;
 *   4. personal information: who may edit it, validation, and an audit row
 *      that names fields but never their values;
 *   5. the supervision timeline: complaints and resolutions, monthly comment
 *      versions, days off and cancellations, and the conflicts the database
 *      refuses; append-only even with the application bypassed;
 *   6. a complaint can only point at a conversation its writer can read;
 *   7. the phone never reaches the communication engine: no conversation
 *      payload carries it, and no request role holds a grant on either table.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, seed as seedDefaultOrg, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

// Same reason as org-scope-pd8.spec: login and the presence client need Redis.
const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;

const PASSWORD = 'pd10-teacher-file-spec-password-1';
const DOMAIN = 'pd10file.qa.jawwid.test';
const SLUG = 'pd10-';
/** PD-11's chat.forbid_change() on the shared timeline table. */
const APPEND_ONLY = /append-only/;
const PHONE = '+20 100 555 0147';
const PHONE_DIGITS = '201005550147';

const g = buildGraph();
let m: SeedManifest;
let orgId: string;
let foreignTeacherId: string;
let app: INestApplication;
let base: string;

const tokens = new Map<string, string>();
async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) {
    const { accessToken } = await app.get(AuthService).login(subject, PASSWORD);
    tokens.set(subject, accessToken);
  }
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
  return { status: r.status, code: json.error?.code, json, text };
}

const teacher = () => m.teachers[0];
const teacherWithStudents = () => {
  const ids = new Set(m.families.flatMap((f) => f.children.map((c) => c.teacherId)));
  return m.teachers.find((t) => ids.has(t.id))!;
};
const studentsOf = (teacherId: string) =>
  m.families.flatMap((f) => f.children.filter((c) => c.teacherId === teacherId).map((c) => c.id)).sort();

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);

  // Another tenant's teacher, for the "foreign id reads as unknown" probes.
  foreignTeacherId = (await seedDefaultOrg(g.prisma)).teacherId;

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, '${SLUG}${orgId.slice(0, 8)}', 'PD-10 QA academy')`,
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
  m = await seedOrgChat(g.prisma, {
    organizationId: orgId,
    emailDomain: DOMAIN,
    password: PASSWORD,
    passwordHash: await hashPassword(PASSWORD),
  });

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, TeacherFileModule],
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
});

// ===========================================================================
describe('1. a Teacher File is administration-only: the Teachers department and the super admin', () => {
  it('the super admin, the Teachers manager and each Teachers supervisor may open the list', async () => {
    for (const p of [m.superAdmin, m.teachersManager, ...m.teacherSupervisors]) {
      const r = await http(p.subject, 'GET', '/teacher-files');
      expect({ who: p.name, status: r.status }).toEqual({ who: p.name, status: 200 });
      expect(r.json.teachers.map((t: { id: string }) => t.id).sort()).toEqual(m.teachers.map((t) => t.id).sort());
      // The list carries nothing personal.
      expect(r.text).not.toMatch(/phone|email|joinedOn/i);
    }
  });

  it('every other staff member, every teacher and every parent is refused, list and detail alike', async () => {
    const refused = [
      m.operationsManager,
      m.salesManager,
      ...m.supervisors,
      ...m.backups,
      ...m.teachers,
      ...m.families.map((f) => f.parent),
    ];
    for (const p of refused) {
      const list = await http(p.subject, 'GET', '/teacher-files');
      const detail = await http(p.subject, 'GET', `/teacher-files/${teacher().id}`);
      expect({ who: p.name, list: [list.status, list.code], detail: [detail.status, detail.code] }).toEqual({
        who: p.name,
        list: [403, 'COMM.TEACHER_FILE_DENIED'],
        detail: [403, 'COMM.TEACHER_FILE_DENIED'],
      });
    }
  });

  it('a teacher cannot open their OWN file either (their schedule and workload arrive with PD-9, elsewhere)', async () => {
    const r = await http(teacher().subject, 'GET', `/teacher-files/${teacher().id}`);
    expect([r.status, r.code]).toEqual([403, 'COMM.TEACHER_FILE_DENIED']);
  });
});

describe('2. a refused or foreign caller learns nothing about which ids exist', () => {
  it('a refused caller gets the same 403 for a real, a foreign and an unknown teacher id', async () => {
    const parent = m.families[0].parent.subject;
    const answers = await Promise.all(
      [teacher().id, foreignTeacherId, randomUUID(), 'not-a-uuid'].map((id) => http(parent, 'GET', `/teacher-files/${id}`)),
    );
    expect(answers.map((a) => [a.status, a.code])).toEqual(Array(4).fill([403, 'COMM.TEACHER_FILE_DENIED']));
  });

  it("another tenant's teacher answers exactly like an unknown id, even for the super admin", async () => {
    const answers = await Promise.all(
      [foreignTeacherId, randomUUID(), 'not-a-uuid'].map((id) => http(m.superAdmin.subject, 'GET', `/teacher-files/${id}`)),
    );
    expect(answers.map((a) => [a.status, a.code, a.json.error?.message])).toEqual(
      Array(3).fill([404, 'COMM.TEACHER_FILE_NOT_FOUND', 'teacher not found']),
    );
  });
});

describe('3. assigned students are chat.learner.teacher_id, nothing else', () => {
  it('every teacher lists exactly the children the academy assigned them, with family and supervisor', async () => {
    for (const t of m.teachers) {
      const r = await http(m.teachersManager.subject, 'GET', `/teacher-files/${t.id}`);
      expect(r.status).toBe(200);
      const ids = r.json.assignedStudents.map((s: { learnerId: string }) => s.learnerId).sort();
      expect({ teacher: t.name, ids }).toEqual({ teacher: t.name, ids: studentsOf(t.id) });
    }
    const t = teacherWithStudents();
    const r = await http(m.superAdmin.subject, 'GET', `/teacher-files/${t.id}`);
    const child = m.families.flatMap((f) => f.children.map((c) => ({ ...c, familyId: f.id }))).find((c) => c.teacherId === t.id)!;
    const row = r.json.assignedStudents.find((s: { learnerId: string }) => s.learnerId === child.id);
    expect(row.family.id).toBe(child.familyId);
    expect(row.supervisor.id).toBe(child.supervisorId);
  });

  it('the list counts the same students', async () => {
    const r = await http(m.superAdmin.subject, 'GET', '/teacher-files');
    for (const t of m.teachers) {
      expect(r.json.teachers.find((x: { id: string }) => x.id === t.id).studentCount).toBe(studentsOf(t.id).length);
    }
  });
});

describe('4. personal information', () => {
  it('the Teachers manager sets phone, email and joining date; the reader sees them', async () => {
    const r = await http(m.teachersManager.subject, 'POST', `/teacher-files/${teacher().id}/personal`, {
      phone: PHONE,
      email: 'Teacher.One@Example.TEST',
      joinedOn: '2025-09-01',
      reason: 'onboarding paperwork',
    });
    expect(r.status).toBe(201);
    expect(r.json.personal).toMatchObject({
      fullName: teacher().name,
      phone: PHONE,
      email: 'teacher.one@example.test',
      joinedOn: '2025-09-01',
      updatedBy: { id: m.teachersManager.id },
    });
    const read = await http(m.teacherSupervisors[0].subject, 'GET', `/teacher-files/${teacher().id}`);
    expect(read.json.personal.phone).toBe(PHONE);
    expect(read.json.access).toEqual({ canEditPersonal: false, canWriteSupervision: true });
  });

  it('a Teachers supervisor may read it but not edit it', async () => {
    const r = await http(m.teacherSupervisors[0].subject, 'POST', `/teacher-files/${teacher().id}/personal`, {
      phone: '+20 100 000 0000',
      reason: 'probe',
    });
    expect([r.status, r.code]).toEqual([403, 'COMM.TEACHER_FILE_DENIED']);
  });

  it('the audit row names the fields that changed and never their values', async () => {
    const row = await g.prisma.auditLog.findFirst({
      where: { action: 'teacher_file.personal_updated', entityId: teacher().id },
      orderBy: { id: 'desc' },
    });
    expect(row?.after).toEqual({ changed: ['phone', 'email', 'joinedOn'] });
    const serialised = JSON.stringify({ ...row, id: String(row?.id) });
    expect(serialised.replace(/\D/g, '')).not.toContain(PHONE_DIGITS.slice(-7));
    expect(serialised).not.toMatch(/example\.test/i);
  });

  it.each([
    [{ phone: 'call me', reason: 'x' }, 'phone'],
    [{ email: 'not-an-email', reason: 'x' }, 'email'],
    [{ joinedOn: '2026-02-31', reason: 'x' }, 'joinedOn'],
    [{ joinedOn: '01/09/2025', reason: 'x' }, 'joinedOn'],
    [{ phone: PHONE }, 'reason'],
    [{ reason: 'nothing else' }, 'body'],
  ])('refuses %j with a 400 naming %s', async (body, field) => {
    const r = await http(m.superAdmin.subject, 'POST', `/teacher-files/${teacher().id}/personal`, body);
    expect([r.status, r.code]).toEqual([400, 'COMMON.VALIDATION']);
    expect(r.json.error?.message).toMatch(new RegExp(`^${field}:`));
  });

  it('null clears a field and leaves the others', async () => {
    const r = await http(m.superAdmin.subject, 'POST', `/teacher-files/${teacher().id}/personal`, { email: null, reason: 'left the school address' });
    expect(r.json.personal).toMatchObject({ phone: PHONE, email: null, joinedOn: '2025-09-01' });
  });
});

describe('5. the supervision timeline', () => {
  const sup = () => m.teacherSupervisors[0].subject;
  const t = () => teacher().id;
  const add = (who: string, body: Record<string, unknown>) => http(who, 'POST', `/teacher-files/${t()}/entries`, body);

  it('a complaint, then its resolution; a second resolution is refused', async () => {
    const c = await add(sup(), { kind: 'complaint', body: 'Started the lesson 20 minutes late.' });
    expect(c.status).toBe(201);
    let file = await http(sup(), 'GET', `/teacher-files/${t()}`);
    expect(file.json.supervision.complaints[0]).toMatchObject({ id: c.json.id, resolution: null, author: { id: m.teacherSupervisors[0].id } });
    expect((await http(sup(), 'GET', '/teacher-files')).json.teachers.find((x: { id: string }) => x.id === t()).openComplaints).toBe(1);

    const r = await add(m.teachersManager.subject, { kind: 'complaint_resolution', body: 'Discussed; on time since.', refersTo: c.json.id });
    expect(r.status).toBe(201);
    file = await http(sup(), 'GET', `/teacher-files/${t()}`);
    expect(file.json.supervision.complaints[0].resolution).toMatchObject({ id: r.json.id, body: 'Discussed; on time since.' });
    expect((await http(sup(), 'GET', '/teacher-files')).json.teachers.find((x: { id: string }) => x.id === t()).openComplaints).toBe(0);

    const again = await add(sup(), { kind: 'complaint_resolution', body: 'again', refersTo: c.json.id });
    expect([again.status, again.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);
  });

  it('a monthly comment is versioned: the newest is current, the earlier ones are kept', async () => {
    await add(sup(), { kind: 'monthly_comment', month: '2026-09', body: 'Solid month.' });
    await add(sup(), { kind: 'monthly_comment', month: '2026-10', body: 'First draft.' });
    await add(sup(), { kind: 'monthly_comment', month: '2026-10', body: 'Strong month; two trial students stayed.' });
    const file = await http(sup(), 'GET', `/teacher-files/${t()}`);
    expect(file.json.supervision.monthlyComments.map((x: any) => [x.month, x.current.body, x.earlierVersions.length])).toEqual([
      ['2026-10', 'Strong month; two trial students stayed.', 1],
      ['2026-09', 'Solid month.', 0],
    ]);
  });

  it('a day off is recorded once in PD-11\'s teacher_day_off; cancelled, it is removed and may be recorded again', async () => {
    const d = await add(sup(), { kind: 'day_off', dayOffOn: '2026-10-21', body: 'Family matter.' });
    expect(d.status).toBe(201);
    const twice = await add(sup(), { kind: 'day_off', dayOffOn: '2026-10-21', body: 'duplicate' });
    expect([twice.status, twice.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);
    const cancel = await add(sup(), { kind: 'day_off_cancellation', refersTo: d.json.id, body: 'Came in after all.' });
    expect(cancel.status).toBe(201);
    const again = await add(sup(), { kind: 'day_off', dayOffOn: '2026-10-21', body: 'Rescheduled matter.' });
    expect(again.status).toBe(201);
    const file = await http(sup(), 'GET', `/teacher-files/${t()}`);
    // One record of days off (the scheduler reads it): the cancelled row is gone, the audit trail keeps it.
    expect(file.json.supervision.daysOff.map((x: any) => [x.date, x.body, x.cancellation])).toEqual([
      ['2026-10-21', 'Rescheduled matter.', null],
    ]);
    expect(await g.prisma.teacherDayOff.count({ where: { teacherId: t() } })).toBe(1);
    expect(await g.prisma.auditLog.count({ where: { action: 'teacher.day_off_removed', entityId: t() } })).toBe(1);
  });

  it('a follow-up must refer to the right kind of entry of the same teacher', async () => {
    const day = await add(sup(), { kind: 'day_off', dayOffOn: '2026-11-02', body: 'x' });
    const wrongKind = await add(sup(), { kind: 'complaint_resolution', refersTo: day.json.id, body: 'x' });
    expect([wrongKind.status, wrongKind.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);
    const other = m.teachers[1].id;
    const otherTeacher = await http(sup(), 'POST', `/teacher-files/${other}/entries`, { kind: 'day_off_cancellation', refersTo: day.json.id, body: 'x' });
    expect([otherTeacher.status, otherTeacher.code]).toEqual([409, 'COMM.TEACHER_FILE_CONFLICT']);
    const unknown = await add(sup(), { kind: 'complaint_resolution', refersTo: randomUUID(), body: 'x' });
    expect(unknown.status).toBe(409);
  });

  it.each([
    [{ kind: 'praise', body: 'x' }, 'kind'],
    [{ kind: 'complaint', body: '   ' }, 'body'],
    [{ kind: 'monthly_comment', month: '2026-13', body: 'x' }, 'month'],
    [{ kind: 'monthly_comment', body: 'x' }, 'month'],
    [{ kind: 'day_off', dayOffOn: '2026-02-30', body: 'x' }, 'dayOffOn'],
    [{ kind: 'complaint_resolution', body: 'x' }, 'refersTo'],
    [{ kind: 'complaint', body: 'x', sourceMessageId: randomUUID() }, 'sourceMessageId'],
  ])('refuses %j with a 400 naming %s', async (body, field) => {
    const r = await add(sup(), body);
    expect([r.status, r.code]).toEqual([400, 'COMMON.VALIDATION']);
    expect(r.json.error?.message).toMatch(new RegExp(`^${field}:`));
  });

  it('an Operations supervisor may not write to the timeline', async () => {
    const r = await add(m.supervisors[0].subject, { kind: 'complaint', body: 'probe' });
    expect([r.status, r.code]).toEqual([403, 'COMM.TEACHER_FILE_DENIED']);
  });

  it('entries are append-only even with the application bypassed', async () => {
    const id = (await g.prisma.teacherSupervisionEntry.findFirstOrThrow({ where: { teacherId: t() } })).id;
    await expect(
      g.prisma.$executeRawUnsafe(`update chat.teacher_supervision_entry set body = 'rewritten' where id = '${id}'::uuid`),
    ).rejects.toThrow(APPEND_ONLY);
    await expect(
      g.prisma.$executeRawUnsafe(`delete from chat.teacher_supervision_entry where id = '${id}'::uuid`),
    ).rejects.toThrow(APPEND_ONLY);
  });

  it("the database refuses an entry written for another tenant's teacher", async () => {
    await expect(
      g.prisma.teacherSupervisionEntry.create({
        data: { organizationId: orgId, teacherId: foreignTeacherId, kind: 'complaint', body: 'x', createdBy: m.teacherSupervisors[0].id },
      }),
    ).rejects.toThrow(/Teachers department|organization/);
  });
});

describe('6. a complaint may only point at a conversation its writer can read', () => {
  it('the super admin links a student-group conversation and its message', async () => {
    const group = m.families.flatMap((f) => f.groups).find((gr) => gr.teacherIds.includes(teacher().id)) ?? m.families[0].groups[0];
    const message = await g.messages.send({
      conversationId: group.conversationId,
      senderId: group.supervisorId,
      body: 'Lesson moved to 5pm.',
    });
    const r = await http(m.superAdmin.subject, 'POST', `/teacher-files/${teacher().id}/entries`, {
      kind: 'complaint',
      body: 'Parent says the lesson started late.',
      sourceConversationId: group.conversationId,
      sourceMessageId: message.id,
    });
    expect(r.status).toBe(201);
    const file = await http(m.superAdmin.subject, 'GET', `/teacher-files/${teacher().id}`);
    expect(file.json.supervision.complaints.find((c: any) => c.id === r.json.id).source).toEqual({
      conversationId: group.conversationId,
      messageId: message.id,
    });
  });

  it("a Teachers supervisor cannot link a family's conversation they cannot read; it reads like an unknown id", async () => {
    const direct = m.families.flatMap((f) => f.directs)[0].conversationId;
    const answers = await Promise.all(
      [direct, randomUUID()].map((id) =>
        http(m.teacherSupervisors[0].subject, 'POST', `/teacher-files/${teacher().id}/entries`, {
          kind: 'complaint',
          body: 'probe',
          sourceConversationId: id,
        }),
      ),
    );
    expect(answers.map((a) => [a.status, a.code, a.json.error?.message])).toEqual(
      Array(2).fill([400, 'COMMON.VALIDATION', 'sourceConversationId: is not a conversation you can read']),
    );
  });
});

describe('7. the phone never reaches the communication engine', () => {
  it('no conversation payload, for the teacher or a parent of their student, carries it', async () => {
    const t = teacher();
    const family = m.families.find((f) => f.children.some((c) => c.teacherId === t.id));
    const readers = [t.subject, ...(family ? [family.parent.subject] : [])];
    for (const who of readers) {
      const list = await http(who, 'GET', '/conversations');
      expect(list.status).toBe(200);
      expect(list.text.replace(/\D/g, '')).not.toContain(PHONE_DIGITS);
      for (const c of (Array.isArray(list.json) ? list.json : list.json.conversations ?? []).slice(0, 10)) {
        const one = await http(who, 'GET', `/conversations/${c.id}`);
        expect(one.text.replace(/\D/g, '')).not.toContain(PHONE_DIGITS);
      }
    }
  });

  it('no request role holds any privilege on either table', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ role: string; tbl: string; can: boolean }>>(`
      select r.role, t.tbl,
             has_table_privilege(r.role, t.tbl, 'select, insert, update, delete') as can
        from (values ('anon'), ('authenticated'), ('chat_app')) r(role),
             (values ('chat.teacher_file'), ('chat.teacher_supervision_entry')) t(tbl)`);
    expect(rows.filter((r) => r.can)).toEqual([]);
  });
});
