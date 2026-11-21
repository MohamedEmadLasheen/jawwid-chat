/**
 * PD-59: an ACTIVE trial follow-up task (trial_outcome) follows the prospect's CURRENT live Sales owner
 * (owner decision 2026-11-21), over real HTTP on a real database. Synthetic fixtures only.
 *
 *   - the task is raised for the prospect's OWNER (not its creator); the previous owner, once the lead is
 *     reassigned, no longer lists, reads or acts on it (404 like a missing task) and never sees its body;
 *   - the move is in the reassignment's own transaction, audited (sales_lead.task_moved: ids only) and in
 *     the task's own history (a `reassigned` event by the manager);
 *   - closed tasks and tasks of prospects that were not reassigned are untouched;
 *   - fallbacks: owner left Sales -> the Sales manager; unowned -> the Sales manager; never a creator
 *     who is not the owner; the Sales manager and the super admin keep oversight.
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
import { LessonModule } from '../../src/lessons/lesson.module';
import { SalesPipelineModule } from '../../src/sales-pipeline/sales-pipeline.module';
import { TaskModule } from '../../src/tasks/task.module';
import { TaskService } from '../../src/tasks/task.service';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd59-trial-task-spec-password-1';
const DOMAIN = 'pd59tt.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
const who: Record<string, { id: string; subject: string }> = {};
const tokens = new Map<string, string>();

async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}
type Res = { status: number; code?: string; json: any };
async function http(actor: string, method: string, path: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = body !== undefined ? { 'content-type': 'application/json' } : {};
  headers.authorization = `Bearer ${await tokenFor(who[actor].subject)}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as any;
  return { status: r.status, code: json?.error?.code, json };
}
async function staffWho(key: string, name: string, role: string, sales = false): Promise<void> {
  const subject = `${key}@${DOMAIN}`;
  const account = await g.prisma.account.create({ data: { organizationId: orgId, subject, kind: 'staff', status: 'active', isActive: true } });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
  const s = await g.prisma.staff.create({ data: { organizationId: orgId, name, role, isActive: true, accountId: account.id } });
  if (sales) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, $2::uuid, $3::uuid, 'supervisor')`,
      s.id, orgId, m.departments.sales);
  }
  who[key] = { id: s.id, subject };
}
async function rows(sql: string, ...args: unknown[]) {
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    await tx.$executeRawUnsafe(sql, ...args);
  });
}
async function q<T = any>(sql: string, ...args: unknown[]): Promise<T[]> {
  return g.prisma.$queryRawUnsafe<T[]>(sql, ...args);
}

const PROSPECT_NAME = 'tt_prospect_secret_name';
let nth = 0;
let slot = 0;
/** A lead (through the API as `by`, owned by `owner`) with a held trial still awaiting its outcome. */
async function leadWithHeldTrial(by: string, owner: string | null, label: string): Promise<{ lead: string; lesson: string }> {
  nth += 1;
  const created = await http(by, 'POST', '/sales-pipeline/leads', {
    displayName: `${PROSPECT_NAME}_${label}`, contact: { parentName: `Synthetic Parent ${label}`, phone: `+1555888${String(nth).padStart(4, '0')}` },
    ...(owner ? { ownerId: who[owner].id } : {}),
  });
  expect(created.status).toBe(201);
  return { lead: created.json.id, lesson: await heldTrial(created.json.id, by) };
}
async function heldTrial(prospect: string, by: string): Promise<string> {
  const id = randomUUID();
  slot += 1; // one teacher: each trial in its own hour, never double-booked
  await rows(
    `insert into chat.lesson (id, organization_id, teacher_id, kind, starts_at, ends_at, outcome, outcome_by_kind, outcome_at, outcome_by, created_by, created_by_kind, prospect_id)
     values ($1::uuid, $2::uuid, $3::uuid, 'trial', now() - ($6 || ' hours')::interval, now() - ($6 || ' hours')::interval + interval '30 minutes', 'held', 'staff', now() - ($6 || ' hours')::interval + interval '40 minutes', $4::uuid, $4::uuid, 'staff', $5::uuid)`,
    id, orgId, m.teachers[0].id, who[by].id, prospect, String(2 + 2 * slot));
  return id;
}
const sweep = () => app.get(TaskService).sweep();
const taskOf = async (lesson: string) =>
  (await q<{ id: string; assignee: string; state: string }>(
    `select id::text, assignee_staff_id::text as assignee, state from chat.work_task where source_key = $1`, `trial_outcome:${lesson}`))[0];
const mine = async (actor: string) => (await http(actor, 'GET', '/me/tasks?state=open')).json.items as Array<{ id: string; title: string; body: string | null }>;
const closedMine = async (actor: string) => (await http(actor, 'GET', '/me/tasks?state=closed')).json.items as Array<{ id: string }>;
const events = (task: string) =>
  q<{ kind: string; actor_id: string | null; from_assignee: string | null; to_assignee: string | null }>(
    `select kind, actor_id::text, from_assignee::text, to_assignee::text from chat.work_task_event where task_id = $1::uuid order by at, id`, task);
const moved = (task: string) => q<{ actor_id: string; before: any; after: any; reason: string }>(
  `select actor_id::text, before, after, reason from chat.audit_log where action = 'sales_lead.task_moved' and (after ->> 'taskId') = $1 order by id`, task);
const reassign = (actor: string, lead: string, owner: string) => http(actor, 'POST', `/sales-pipeline/leads/${lead}/owner`, { ownerId: who[owner].id });

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd59tt-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd59tt-${orgId.slice(0, 8)}', 'PD-59 trial task QA academy')`);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD) });
  who.superAdmin = { id: m.superAdmin.id, subject: m.superAdmin.subject };
  who.manager = { id: m.salesManager.id, subject: m.salesManager.subject };
  who.ops = { id: m.supervisors[0].id, subject: m.supervisors[0].subject };
  await staffWho('repA', 'rep_a', 'admin', true);
  await staffWho('repB', 'rep_b', 'admin', true);
  await staffWho('repC', 'rep_c', 'admin', true);
  for (const src of ['trial_outcome', 'trial_attendance', 'teacher_unsupervised']) {
    await rows(`insert into chat.config (key, value) values ($1, to_jsonb('2000-01-01T00:00:00Z'::text)) on conflict (key) do update set value = excluded.value`, `tasks.since.${src}`);
  }
  await rows(`insert into chat.config (key, value) values ('tasks.raise_after_seconds', to_jsonb(0)) on conflict (key) do update set value = excluded.value`);

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, SalesPipelineModule, TaskModule],
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
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key = 'tasks.raise_after_seconds'`);
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd59tt-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('the outcome task is the prospect\'s OWNER\'s, and follows a reassignment', () => {
  let lead: string, lesson: string, task: string;

  it('raised for the owner (rep A), though the manager created the lead; A reads the prospect name in its body', async () => {
    ({ lead, lesson } = await leadWithHeldTrial('manager', 'repA', 'follow'));
    await sweep();
    const t = await taskOf(lesson);
    task = t.id;
    expect(t.assignee).toBe(who.repA.id);
    expect((await mine('repA')).map((x) => x.id)).toContain(task);
    const d = await http('repA', 'GET', `/tasks/${task}`);
    expect(d.status).toBe(200);
    expect(JSON.stringify(d.json)).toContain(PROSPECT_NAME);
    expect((await mine('repB')).map((x) => x.id)).not.toContain(task);
  });

  it('the manager reassigns to rep B: the task is B\'s in the same call; A no longer lists, reads or acts on it (404 like a missing one)', async () => {
    const r = await reassign('manager', lead, 'repB');
    expect(r.status).toBe(201);
    expect((await taskOf(lesson)).assignee).toBe(who.repB.id);
    expect((await mine('repA')).map((x) => x.id)).not.toContain(task);
    expect((await closedMine('repA')).map((x) => x.id)).not.toContain(task);
    expect((await mine('repB')).map((x) => x.id)).toContain(task);
    const missing = await http('repA', 'GET', `/tasks/${randomUUID()}`);
    const gone = await http('repA', 'GET', `/tasks/${task}`);
    expect(gone.status).toBe(404);
    expect(gone.json).toEqual(missing.json);
    expect(JSON.stringify(gone.json)).not.toContain(PROSPECT_NAME);
    for (const [path, body] of [[`/tasks/${task}/complete`, {}], [`/tasks/${task}/comments`, { body: 'hello' }], [`/tasks/${task}/out-of-scope`, { reason: 'x' }]] as Array<[string, unknown]>) {
      expect((await http('repA', 'POST', path, body)).status).toBe(404);
    }
    const d = await http('repB', 'GET', `/tasks/${task}`);
    expect(d.status).toBe(200);
    expect(JSON.stringify(d.json)).toContain(PROSPECT_NAME);
  });

  it('the move is audited (ids only) and in the task\'s own history, by the manager', async () => {
    const a = await moved(task);
    expect(a).toHaveLength(1);
    expect(a[0].actor_id).toBe(who.manager.id);
    expect(a[0].before).toEqual({ fromStaffId: who.repA.id });
    expect(a[0].after).toEqual({ toStaffId: who.repB.id, taskId: task, leadId: lead });
    expect(JSON.stringify(a)).not.toContain(PROSPECT_NAME);
    expect(JSON.stringify(a)).not.toContain('Synthetic');
    const ev = (await events(task)).filter((e) => e.kind === 'reassigned');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor_id: who.manager.id, from_assignee: who.repA.id, to_assignee: who.repB.id });
    expect((await q(`select 1 from chat.audit_log where action = 'sales_lead.reassigned' and entity_id = $1::uuid`, lead)).length).toBe(1);
  });

  it('the Sales manager and the super admin still see it (team and all views, detail)', async () => {
    const team = await http('manager', 'GET', '/tasks?view=team&state=open');
    expect(team.status).toBe(200);
    expect(team.json.items.map((x: { id: string }) => x.id)).toContain(task);
    const all = await http('superAdmin', 'GET', '/tasks?view=all&state=open');
    expect(all.json.items.map((x: { id: string }) => x.id)).toContain(task);
    for (const k of ['manager', 'superAdmin']) expect((await http(k, 'GET', `/tasks/${task}`)).status).toBe(200);
  });

  it('a reassignment to the same owner moves nothing; reassigning back returns the task to A', async () => {
    expect((await reassign('manager', lead, 'repB')).status).toBe(201);
    expect(await moved(task)).toHaveLength(1);
    expect((await reassign('manager', lead, 'repA')).status).toBe(201);
    expect((await taskOf(lesson)).assignee).toBe(who.repA.id);
    expect((await mine('repA')).map((x) => x.id)).toContain(task);
    expect((await mine('repB')).map((x) => x.id)).not.toContain(task);
    expect((await http('repB', 'GET', `/tasks/${task}`)).status).toBe(404);
    expect(await moved(task)).toHaveLength(2);
    expect((await events(task)).filter((e) => e.kind === 'reassigned').map((e) => [e.from_assignee, e.to_assignee])).toEqual([
      [who.repA.id, who.repB.id], [who.repB.id, who.repA.id],
    ]);
  });

  it('a sweep afterwards keeps the task with its current owner', async () => {
    await reassign('manager', lead, 'repC');
    await sweep();
    expect((await taskOf(lesson)).assignee).toBe(who.repC.id);
  });
});

describe('what a reassignment must not touch', () => {
  it('a closed task and the task of another prospect stay as they are; history rows are never rewritten', async () => {
    const a = await leadWithHeldTrial('repA', null, 'done');
    const other = await leadWithHeldTrial('repA', null, 'other');
    await sweep();
    const done = (await taskOf(a.lesson)).id;
    const keep = (await taskOf(other.lesson)).id;
    await q(`insert into chat.trial_outcome (lesson_id, organization_id, result, reason_code, recorded_by) values ($1::uuid, $2::uuid, 'not_subscribed', 'price', $3::uuid)`, a.lesson, orgId, who.repA.id);
    expect((await taskOf(a.lesson)).state).toBe('completed');
    const before = await events(done);
    expect((await reassign('manager', a.lead, 'repB')).status).toBe(201);
    expect(await taskOf(a.lesson)).toMatchObject({ state: 'completed', assignee: who.repA.id });
    expect(await events(done)).toEqual(before);
    expect(await moved(done)).toHaveLength(0);
    expect((await taskOf(other.lesson)).assignee).toBe(who.repA.id);
    expect(await moved(keep)).toHaveLength(0);
  });
});

describe('fallbacks: never a departed or non-Sales person', () => {
  it('an unowned prospect\'s task is the Sales manager\'s (not its Sales-rep creator\'s); reassigning the lead moves it to the new owner', async () => {
    const prospect = randomUUID();
    await rows(`insert into chat.trial_prospect (id, organization_id, display_name, created_by) values ($1::uuid, $2::uuid, 'tt_legacy', $3::uuid)`, prospect, orgId, who.repC.id);
    const lesson = await heldTrial(prospect, 'repC');
    await sweep();
    const t = await taskOf(lesson);
    expect(t.assignee).toBe(who.manager.id);
    expect((await reassign('manager', prospect, 'repB')).status).toBe(201);
    expect((await taskOf(lesson)).assignee).toBe(who.repB.id);
    const a = await moved(t.id);
    expect(a).toHaveLength(1);
    expect(a[0].before).toEqual({ fromStaffId: who.manager.id });
    expect(a[0].after).toMatchObject({ toStaffId: who.repB.id, taskId: t.id });
  });

  it('an owner who left: the live Sales manager holds the task; then a new owner takes it from the manager', async () => {
    const { lead, lesson } = await leadWithHeldTrial('manager', 'repA', 'left');
    await sweep();
    expect((await taskOf(lesson)).assignee).toBe(who.repA.id);
    await q(`select chat.deactivate_principal('staff', $1::uuid, 'left the academy', null, 'deactivated')::text`, who.repA.id);
    await sweep();
    expect((await taskOf(lesson)).assignee).toBe(who.manager.id);
    expect((await reassign('manager', lead, 'repB')).status).toBe(201);
    expect((await taskOf(lesson)).assignee).toBe(who.repB.id);
  });

  it('the function itself: an owner who is not Sales is never chosen; the manager, then the super admin, are the fallbacks', async () => {
    const prospect = randomUUID();
    await rows(`insert into chat.trial_prospect (id, organization_id, display_name, created_by, owner_staff_id) values ($1::uuid, $2::uuid, 'tt_fn', $3::uuid, $4::uuid)`, prospect, orgId, who.ops.id, who.repB.id);
    const lesson = await heldTrial(prospect, 'ops');
    const owner = async () => (await q<{ o: string | null }>(`select chat.work_task_trial_sales_owner($1::uuid)::text as o`, lesson))[0].o;
    expect(await owner()).toBe(who.repB.id);
    await rows(`delete from chat.department_member where staff_id = $1::uuid`, who.repB.id);
    expect(await owner()).toBe(who.manager.id);
    await rows(`update chat.department set manager_id = null where kind = 'sales' and organization_id = $1::uuid`, orgId);
    expect(await owner()).toBe(who.superAdmin.id);
  });
});
