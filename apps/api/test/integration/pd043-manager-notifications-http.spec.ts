/**
 * PD-43 §3.4, §3.7: what the Teachers Manager is told (PD-34 notifications).
 *
 *   1. A teacher added with no supervisor, by anyone but the manager -- the
 *      manager covers them until one is set.
 *   2. A teacher supervisor deactivated while teachers are still assigned to
 *      them, whichever path deactivated them (a trigger on chat.staff).
 *   3. A sign-in or contact refused because it is on a teacher OUT of the
 *      adder's reach: the adder learns nothing, so someone who may see both
 *      is told (gate P2-5 keeps the adder's answer identical).
 *   With no Teachers manager, the super admin is told instead. Each is one
 *   notification however often it is retried (the dedupe key).
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
const PASSWORD = 'pd43-notify-spec-password-1';
const DOMAIN = 'pd43ntf.qa.jawwid.test';
const OTHER_DOMAIN = 'pd43ntfother.qa.jawwid.test';
const SLUG = 'pd43n-';

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


beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  for (const d of [DOMAIN, OTHER_DOMAIN]) await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${d}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, '${SLUG}${orgId.slice(0, 8)}', 'PD-43 notifications QA academy')`,
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



const told = (recipientId: string, templateKey: string) =>
  g.prisma.notification.findMany({ where: { recipientId, templateKey }, orderBy: { createdAt: 'asc' } });

/** The hidden-duplicate notification is written after the answer (its timing must not leak): wait for it. */
async function toldEventually(recipientId: string, templateKey: string, count: number) {
  for (let i = 0; i < 50; i++) {
    const rows = await told(recipientId, templateKey);
    if (rows.length >= count) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return told(recipientId, templateKey);
}

describe('1. a teacher added with no supervisor', () => {
  it('tells the Teachers manager when anyone else adds one; never the manager about their own', async () => {
    const before = (await told(m.teachersManager.id, 'teacher_added_unsupervised')).length;
    const bySupervisor = await add(m.teacherSupervisors[0]!.subject, { name: 'QA Unsupervised One', email: email('u'), supervisorId: null });
    expect(bySupervisor.status).toBe(201);
    const bySuperAdmin = await add(m.superAdmin.subject, { name: 'QA Unsupervised Two', email: email('u') });
    expect(bySuperAdmin.status).toBe(201);
    const byManager = await add(m.teachersManager.subject, { name: 'QA Unsupervised Three', email: email('u') });
    expect(byManager.status).toBe(201);
    const withSupervisor = await add(m.superAdmin.subject, { name: 'QA Supervised', email: email('u'), supervisorId: m.teacherSupervisors[0]!.id });
    expect(withSupervisor.status).toBe(201);

    const rows = (await told(m.teachersManager.id, 'teacher_added_unsupervised')).slice(before);
    expect(rows.map((r) => (r.variables as { teacher: string }).teacher)).toEqual(['QA Unsupervised One', 'QA Unsupervised Two']);
    expect(rows[0]).toMatchObject({ eventType: 'teacher_added_unsupervised', status: 'scheduled' });
    expect(rows[0]!.variables).toMatchObject({ teacher: 'QA Unsupervised One', addedBy: expect.any(String) });
  });
});

describe('2. a sign-in or contact on a teacher out of the adder\'s reach', () => {
  it('the adder gets the identical answer; the Teachers manager is told who and which teacher', async () => {
    await strict(true);
    try {
      const taken = email('d');
      const holder = await add(m.teacherSupervisors[0]!.subject, { name: 'QA Holder Teacher', email: taken, supervisorId: 'self' });
      expect(holder.status).toBe(201);
      const before = (await told(m.teachersManager.id, 'teacher_duplicate_hidden')).length;

      const hidden = await add(m.teacherSupervisors[1]!.subject, { name: 'QA Second Try', email: taken, supervisorId: 'self' });
      expect([hidden.status, hidden.code]).toEqual([409, 'COMM.TEACHER_EMAIL_UNAVAILABLE']);
      const rows = (await toldEventually(m.teachersManager.id, 'teacher_duplicate_hidden', before + 1)).slice(before);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.variables).toMatchObject({ holder: 'QA Holder Teacher', addedBy: expect.any(String), name: 'QA Second Try' });
      expect(JSON.stringify(rows[0]!.variables)).not.toContain('@');

      // Within reach the adder is told directly: no notification.
      const named = await add(m.teachersManager.subject, { name: 'QA Third Try', email: taken });
      expect(named.code).toBe('COMM.TEACHER_ALREADY_ADDED');
      await new Promise((r) => setTimeout(r, 500));
      expect((await told(m.teachersManager.id, 'teacher_duplicate_hidden')).length).toBe(before + 1);
    } finally {
      await strict(false);
    }
  });

  it('a parent\'s sign-in is not a teacher: nobody is told about it', async () => {
    const before = (await told(m.teachersManager.id, 'teacher_duplicate_hidden')).length;
    const r = await add(m.teacherSupervisors[1]!.subject, { email: m.families[0]!.parent.subject, supervisorId: 'self' });
    expect(r.code).toBe('COMM.TEACHER_EMAIL_UNAVAILABLE');
    await new Promise((r) => setTimeout(r, 500));
    expect((await told(m.teachersManager.id, 'teacher_duplicate_hidden')).length).toBe(before);
  });
});

describe('3. a supervisor deactivated with teachers assigned (a trigger on chat.staff)', () => {
  /** A primary teacher supervisor of this organization's Teachers department, holding `teachers` new teachers. */
  async function supervisorHolding(label: string, teachers: number) {
    const id = randomUUID();
    const name = `QA Leaving Supervisor ${label}`;
    await g.prisma.$executeRaw`INSERT INTO chat.staff (id, organization_id, name, role) VALUES (${id}::uuid, ${orgId}::uuid, ${name}, 'admin')`;
    await g.prisma.$executeRaw`
      INSERT INTO chat.department_member (staff_id, organization_id, department_id, position)
      SELECT ${id}::uuid, ${orgId}::uuid, d.id, 'supervisor' FROM chat.department d WHERE d.organization_id = ${orgId}::uuid AND d.kind = 'teachers'`;
    for (let i = 0; i < teachers; i++) {
      const t = await legacyTeacher(`QA Held ${label} ${i}`);
      await g.prisma.$executeRaw`INSERT INTO chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id, assigned_by, reason)
        VALUES (${t}::uuid, ${orgId}::uuid, ${id}::uuid, ${m.teachersManager.id}::uuid, 'spec')`;
    }
    return { id, name };
  }
  const leftFor = async (supervisor: string) =>
    (await told(m.teachersManager.id, 'teacher_supervisor_left')).filter((r) => (r.variables as { supervisor: string }).supervisor === supervisor);
  const isLive = async (id: string) =>
    (await g.prisma.staff.findUniqueOrThrow({ where: { id }, select: { isActive: true, leftAt: true } }));

  it('tells the Teachers manager once, naming the supervisor and how many teachers they held', async () => {
    const s = await supervisorHolding('a', 2);
    await g.prisma.$queryRaw`SELECT chat.deactivate_principal('staff', ${s.id}::uuid, 'left the academy', null, 'deactivated')::text`;
    const rows = await leftFor(s.name);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventType: 'teacher_supervisor_left', status: 'scheduled' });
    expect(rows[0]!.variables).toEqual({ supervisor: s.name, teachers: 2 });
  });

  it('works for a writer that cannot write notifications itself (service_role)', async () => {
    const s = await supervisorHolding('b', 1);
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('set local role service_role');
      await tx.$queryRawUnsafe(`select chat.deactivate_principal('staff', '${s.id}'::uuid, 'left', null, 'deactivated')::text`);
    });
    expect((await isLive(s.id)).isActive).toBe(false);
    expect(await leftFor(s.name)).toHaveLength(1);
  });

  it('a request role (chat_app) cannot deactivate staff at all: RT-032 refuses it, never this trigger', async () => {
    const s = await supervisorHolding('c', 1);
    const out = await g.prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('set local role chat_app');
        await tx.$executeRawUnsafe(`update chat.staff set is_active = false, left_at = now() where id = '${s.id}'::uuid`);
      })
      .then(() => 'ok', (e: Error) => e.message);
    // RLS may hide the row (nothing changes) or the journal refuses it; either way no 42501 from the trigger's own reads.
    if (out !== 'ok') expect(out).toMatch(/RT-032|row-level security|permission denied for table staff/);
    expect((await isLive(s.id)).isActive).toBe(true);
    expect(await leftFor(s.name)).toHaveLength(0);
  });

  it('one notification per deactivation: a repeat in the same transaction, or of one already out, adds none', async () => {
    const s = await supervisorHolding('d', 1);
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE chat.staff SET is_active = false, left_at = now() WHERE id = ${s.id}::uuid`;
      await tx.$executeRaw`UPDATE chat.staff SET is_active = true, left_at = null WHERE id = ${s.id}::uuid`;
      await tx.$executeRaw`UPDATE chat.staff SET is_active = false, left_at = now() WHERE id = ${s.id}::uuid`;
    });
    await g.prisma.$queryRaw`SELECT chat.deactivate_principal('staff', ${s.id}::uuid, 'again', null, 'deactivated')::text`;
    expect(await leftFor(s.name)).toHaveLength(1);
  });

  it('a notification that cannot be written never blocks the deactivation', async () => {
    const s = await supervisorHolding('e', 1);
    await g.prisma.$executeRawUnsafe(
      `alter table chat.notification add constraint pd043_spec_refuses_supervisor_left check (template_key <> 'teacher_supervisor_left') not valid`,
    );
    try {
      await g.prisma.$queryRaw`SELECT chat.deactivate_principal('staff', ${s.id}::uuid, 'left', null, 'deactivated')::text`;
    } finally {
      await g.prisma.$executeRawUnsafe('alter table chat.notification drop constraint pd043_spec_refuses_supervisor_left');
    }
    expect(await isLive(s.id)).toMatchObject({ isActive: false, leftAt: expect.any(Date) });
    expect(await leftFor(s.name)).toHaveLength(0);
  });

  it('a supervisor with no teachers: nobody is told', async () => {
    const s = await supervisorHolding('f', 0);
    await g.prisma.$queryRaw`SELECT chat.deactivate_principal('staff', ${s.id}::uuid, 'left', null, 'deactivated')::text`;
    expect(await leftFor(s.name)).toHaveLength(0);
  });
});
