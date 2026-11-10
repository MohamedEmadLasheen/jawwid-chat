/**
 * PD-56 · O-3 (owner, 2026-11-07): "the teacher requests deletion in the app;
 * staff close the lessons and payroll; the account is deleted within 30 days."
 * Over real HTTP, and the worker's sweep at fixed instants.
 *
 *   1. nothing open: deleted at once, exactly as before
 *   2. something open: a request (not a refusal) -- requested_at and a 30-day
 *      deadline from the database clock, the Teachers manager's task due then,
 *      audited; still signed in
 *   3. asking again returns the same request (one per account, one audit row)
 *   4. the holder cancels while pending (the task is withdrawn); then asks anew
 *   5. only in-scope staff complete it: a Teachers supervisor, Operations and
 *      another academy's super admin cannot; the Teachers manager can -- the
 *      erasure runs, the request is completed by them, the task settled
 *   6. once nothing is open, the holder's own deletion completes the request
 *   7. the deadline: reminders at day 21 and day 28, each once per recipient;
 *      at the deadline the worker erases -- the lesson ahead stays on "Deleted
 *      user", flagged high for the Teachers manager; payroll rows kept
 *   8. fail closed: no request role reaches either table; the guards hold
 *   9. the public page: a teacher with work open gets a request and its date
 *  10. review of 00ccd748 (lead, 2026-11-07): the payout account outlives a
 *      forced erasure until the payroll is settled; the 30 days are 720 hours
 *      in any session time zone; request/cancel cycles are rate-limited; a
 *      forced erasure ends the weekly times, hands each learner to staff and
 *      stops the family's reminders; the sweep always ends, and never erases
 *      before the database's own deadline
 *
 * Fixed instants only (AGENTS.md): a lesson ahead is in 2099; a request made in
 * the past is a fixture at 2026-01-05T09:00Z, and the sweep runs at chosen
 * instants around its day 21, day 28 and deadline. Synthetic people (G-20).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { hashPassword } from '@platform/auth/password';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { AccountDeletionModule } from '../../src/account-deletion/account-deletion.module';
import { TeacherFileModule } from '../../src/teacher-file/teacher-file.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate, withAssignmentGate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'o3-deletion-request-password-1';
const DOMAIN = 'o3deletion.qa.jawwid.test';
const SLUG = 'o3del-';
/** A lesson that is always ahead. */
const AHEAD = new Date('2099-01-05T10:00:00Z');
/** A request made in the past, at a fixed instant; its day 21, day 28 and deadline. */
const ASKED = '2026-01-05T09:00:00.000Z';
const DAY21 = new Date('2026-01-26T09:00:00.000Z');
const DAY28 = new Date('2026-02-02T09:00:00.000Z');
const DEADLINE = new Date('2026-02-04T09:00:00.000Z');
const BEFORE = (d: Date) => new Date(d.getTime() - 60_000);

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
let otherAdmin: { subject: string };

async function login(subject: string, password = PASSWORD) {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: subject, password }),
  });
  return { status: r.status, token: ((await r.json().catch(() => ({}))) as { accessToken?: string }).accessToken ?? '' };
}
async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, any>;
  return { status: r.status, code: json.error?.code, json };
}
const tasksOf = (type: string, sourceId: string) =>
  g.prisma.$queryRaw<Array<{ state: string; source_state: string; assignee_staff_id: string | null; due_at: Date | null; priority: string; closed_by: string | null }>>`
    SELECT state, source_state, assignee_staff_id::text, due_at, priority, closed_by::text FROM chat.work_task
     WHERE organization_id = ${orgId}::uuid AND source_type = ${type} AND source_id = ${sourceId}::uuid`;
const requestsOf = (accountId: string) =>
  g.prisma.$queryRaw<Array<{ id: string; state: string; requested_at: Date; deadline_at: Date; completed_via: string | null; completed_by: string | null; left_open: any; open_items: string[] }>>`
    SELECT id::text, state, requested_at, deadline_at, completed_via, completed_by::text, left_open, open_items
      FROM chat.account_deletion_request WHERE account_id = ${accountId}::uuid ORDER BY requested_at, id`;
const audits = (requestId: string) =>
  g.prisma.$queryRaw<Array<{ action: string; actor_id: string | null }>>`
    SELECT action, actor_id::text FROM chat.audit_log WHERE entity = 'account_deletion_request' AND entity_id = ${requestId}::uuid ORDER BY id`;

/** A teacher who can sign in, with nothing on them yet. */
async function newTeacher(tag: string): Promise<{ id: string; subject: string; accountId: string }> {
  const subject = `teacher.${tag}@${DOMAIN}`;
  const account = await g.prisma.account.create({ data: { organizationId: orgId, subject, kind: 'teacher', status: 'active', isActive: true } });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
  const teacher = await g.prisma.teacher.create({ data: { organizationId: orgId, name: `teacher_${tag}`, accountId: account.id, isActive: true } });
  return { id: teacher.id, subject, accountId: account.id };
}
/** A trial lesson ahead (always: 2099). */
async function lessonAhead(teacherId: string) {
  const prospect = await g.prisma.trialProspect.create({ data: { organizationId: orgId, displayName: 'QA Prospect', createdBy: m.superAdmin.id } });
  return g.prisma.lesson.create({
    data: { organizationId: orgId, kind: 'trial', prospectId: prospect.id, teacherId, startsAt: AHEAD, endsAt: new Date(AHEAD.getTime() + 1_800_000), createdByKind: 'staff', createdBy: m.superAdmin.id },
  });
}
/**
 * A request made at ASKED. The guard stamps now(); a fixture made in the past
 * is written with triggers off (session_replication_role), every CHECK still
 * applying. Its task is raised the normal way.
 */
async function pastRequest(t: { id: string; accountId: string }): Promise<string> {
  const id = await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    const [r] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.account_deletion_request (organization_id, account_id, teacher_id, requested_at, deadline_at, open_items)
       values ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '30 days', '{future_lessons}') returning id::text as id`,
      orgId, t.accountId, t.id, ASKED,
    );
    return r!.id;
  });
  await g.prisma.$queryRawUnsafe(
    `select chat.work_task_raise($1::uuid, 'teacher_deletion_request', $2::uuid, $3::uuid, null, 'high', 'operational', 'generic', $4::timestamptz + interval '30 days')::text`,
    orgId, id, m.teachersManager.id, ASKED,
  );
  return id;
}
/** The worker's sweep at a fixed instant (loaded here, so the other cases run without it). */
async function sweep(now: Date): Promise<{ reminded: number; erased: number }> {
  const { TeacherDeletionRequestService } = await import('../../src/account-deletion/teacher-deletion-request.service');
  return app.get(TeacherDeletionRequestService).sweep(now);
}
const reminders = (requestId: string, day: 21 | 28) =>
  g.prisma.$queryRaw<Array<{ recipient_id: string }>>`
    SELECT recipient_id::text FROM chat.notification WHERE dedupe_key LIKE ${`teacher_deletion_day${day}:${requestId}:%`} ORDER BY recipient_id`;

/** Payroll of this month: a bonus recorded now. */
async function openPayroll(teacherId: string) {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher_pay_adjustment (organization_id, teacher_id, kind, month, amount, currency, reason, created_by)
     values ($1::uuid, $2::uuid, 'bonus', date_trunc('month', now())::date, 100, 'EGP', 'QA bonus', $3::uuid)`,
    orgId, teacherId, m.superAdmin.id,
  );
}
async function payoutAccount(teacherId: string) {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher_payout_account (teacher_id, organization_id, method, details_sealed, key_id, last4, updated_by)
     values ($1::uuid, $2::uuid, 'bank_transfer', decode(repeat('ab', 40), 'hex'), 'k1', '1234', $3::uuid)`,
    teacherId, orgId, m.superAdmin.id,
  );
}

async function newOrg(tag: string): Promise<string> {
  const id = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${id}'::uuid, '${SLUG}${tag}-${id.slice(0, 8)}', 'O-3 QA academy ${tag}')`,
  );
  return id;
}
async function cleanUp() {
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug like '${SLUG}%')`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await cleanUp();

  orgId = await newOrg('main');
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });

  // Another academy's super admin: never in scope here.
  const other = await newOrg('other');
  otherAdmin = { subject: `owner.other@${DOMAIN}` };
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: other, subject: otherAdmin.subject, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: other, name: 'QA Other Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, CommunicationModule, AccountDeletionModule, TeacherFileModule] }).compile();
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
  await cleanUp();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  await g.prisma.$disconnect();
});

describe('O-3: a teacher\'s account deletion request', () => {
  it('1. nothing open: the status says immediate, and the teacher is deleted at once, as before', async () => {
    const t = await newTeacher('clear');
    const { token } = await login(t.subject);
    const status = await call(token, 'GET', '/me/account/deletion');
    expect(status).toMatchObject({ status: 200, json: { kind: 'teacher', immediate: true, openItems: [], request: null } });
    expect(Date.parse(status.json.deadlineIfRequested)).toBeGreaterThan(Date.now());

    expect(await call(token, 'POST', '/me/account/delete', { password: PASSWORD })).toMatchObject({ status: 200, json: { deleted: true } });
    expect(await g.prisma.teacher.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ name: 'Deleted user', isActive: false });
    expect((await login(t.subject)).status).toBe(401);
    expect(await requestsOf(t.accountId)).toEqual([]);
  });

  it('2. a lesson ahead: a request instead of a refusal -- 30 days on the database clock, a task, an audit row, still signed in', async () => {
    const t = await newTeacher('ask');
    await lessonAhead(t.id);
    const { token } = await login(t.subject);
    expect(await call(token, 'GET', '/me/account/deletion')).toMatchObject({ status: 200, json: { immediate: false, openItems: ['future_lessons'], request: null } });

    const r = await call(token, 'POST', '/me/account/delete', { password: PASSWORD });
    expect(r).toMatchObject({ status: 200, json: { deleted: false, request: { state: 'pending', openItems: ['future_lessons'] } } });
    const request = r.json.request as { id: string; requestedAt: string; deadlineAt: string };
    expect(Date.parse(request.deadlineAt) - Date.parse(request.requestedAt)).toBe(30 * 86_400_000);
    const [{ db_now }] = await g.prisma.$queryRaw<Array<{ db_now: Date }>>`SELECT now() AS db_now`;
    expect(Math.abs(Date.parse(request.requestedAt) - db_now.getTime())).toBeLessThan(60_000);

    // Nothing erased; still themselves, still signed in.
    expect(await g.prisma.teacher.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ name: 'teacher_ask', isActive: true });
    expect((await call(token, 'GET', '/me')).status).toBe(200);
    // The Teachers manager's task, due at the deadline; the audit row is the teacher's.
    expect(await tasksOf('teacher_deletion_request', request.id)).toEqual([
      expect.objectContaining({ state: 'open', source_state: 'pending', assignee_staff_id: m.teachersManager.id, priority: 'high', due_at: new Date(request.deadlineAt) }),
    ]);
    expect(await audits(request.id)).toEqual([{ action: 'account_deletion_request.created', actor_id: t.id }]);
    // The status shows it.
    expect(await call(token, 'GET', '/me/account/deletion')).toMatchObject({ json: { request: { id: request.id, state: 'pending' } } });
  });

  it('3. asking again returns the same request: one per account, one audit row', async () => {
    const t = await newTeacher('again');
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${t.id}'::uuid where id = '${m.families[3]!.children[0]!.id}'::uuid`);
    const { token } = await login(t.subject);
    const first = await call(token, 'POST', '/me/account/delete', { password: PASSWORD });
    const second = await call(token, 'POST', '/me/account/delete', { password: PASSWORD });
    expect(second.json.request).toEqual(first.json.request);
    expect(first.json.request.openItems).toEqual(['assigned_learners']);
    expect((await requestsOf(t.accountId)).length).toBe(1);
    expect((await audits(first.json.request.id)).length).toBe(1);
    // A wrong password still makes nothing.
    expect((await call(token, 'POST', '/me/account/delete', { password: 'not-the-password' })).status).toBe(401);
    expect((await requestsOf(t.accountId)).length).toBe(1);
  });

  it('4. the holder cancels while pending; the task is withdrawn; cancelling twice is refused; asking anew makes a new request', async () => {
    const t = await newTeacher('cancel');
    await lessonAhead(t.id);
    const { token } = await login(t.subject);
    const made = (await call(token, 'POST', '/me/account/delete', { password: PASSWORD })).json.request as { id: string };

    const cancelled = await call(token, 'POST', '/me/account/deletion-request/cancel');
    expect(cancelled).toMatchObject({ status: 200, json: { request: { id: made.id, state: 'cancelled' } } });
    expect(cancelled.json.request.cancelledAt).toEqual(expect.any(String));
    // Closed, not left open: removed as withdrawn, by the teacher's cancellation.
    expect(await tasksOf('teacher_deletion_request', made.id)).toEqual([expect.objectContaining({ state: 'removed', source_state: 'withdrawn', closed_by: t.id })]);
    expect((await audits(made.id)).map((a) => [a.action, a.actor_id])).toEqual([
      ['account_deletion_request.created', t.id],
      ['account_deletion_request.cancelled', t.id],
    ]);
    expect(await call(token, 'POST', '/me/account/deletion-request/cancel')).toMatchObject({ status: 409, code: 'AUTH.DELETION_REQUEST_NOT_PENDING' });
    expect(await call(token, 'GET', '/me/account/deletion')).toMatchObject({ json: { request: { id: made.id, state: 'cancelled' } } });

    const anew = (await call(token, 'POST', '/me/account/delete', { password: PASSWORD })).json.request as { id: string; state: string };
    expect(anew.id).not.toBe(made.id);
    expect(anew.state).toBe('pending');
    expect((await requestsOf(t.accountId)).map((r) => r.state)).toEqual(['cancelled', 'pending']);

    // Staff cannot cancel it for them: the route is the holder's own.
    const { token: manager } = await login(m.teachersManager.subject);
    expect((await call(manager, 'POST', '/me/account/deletion-request/cancel')).status).toBe(403);
    expect((await requestsOf(t.accountId)).map((r) => r.state)).toEqual(['cancelled', 'pending']);
  });

  it('5. only in-scope staff complete it: Teachers supervisor, Operations and another academy cannot; the Teachers manager can', async () => {
    const t = await newTeacher('staff');
    const lesson = await lessonAhead(t.id);
    await openPayroll(t.id);
    await payoutAccount(t.id);
    const { token: teacher } = await login(t.subject);
    const request = (await call(teacher, 'POST', '/me/account/delete', { password: PASSWORD })).json.request as { id: string };
    const path = `/teacher-files/${t.id}/deletion-request`;

    // A Teachers supervisor reads the banner, without the action.
    const { token: supervisor } = await login(m.teacherSupervisors[0]!.subject);
    expect(await call(supervisor, 'GET', path)).toMatchObject({
      status: 200,
      json: { request: { id: request.id, state: 'pending' }, leftOpen: { futureLessons: 1, assignedLearners: 0, openPayroll: true }, canComplete: false },
    });
    expect((await call(supervisor, 'POST', `${path}/complete`, { confirm: true })).status).toBe(403);
    const { token: operations } = await login(m.operationsManager.subject);
    expect((await call(operations, 'POST', `${path}/complete`, { confirm: true })).status).toBe(403);
    const { token: other } = await login(otherAdmin.subject);
    expect((await call(other, 'POST', `${path}/complete`, { confirm: true })).status).toBe(404);
    // The teacher themself is not staff.
    expect((await call(teacher, 'POST', `${path}/complete`, { confirm: true })).status).toBe(403);
    expect((await requestsOf(t.accountId))[0]!.state).toBe('pending');

    const { token: manager } = await login(m.teachersManager.subject);
    expect(await call(manager, 'GET', path)).toMatchObject({ json: { canComplete: true } });
    // The confirmation is required.
    expect((await call(manager, 'POST', `${path}/complete`, {})).status).toBe(400);
    const done = await call(manager, 'POST', `${path}/complete`, { confirm: true });
    expect(done).toMatchObject({ status: 200, json: { requestId: request.id, leftOpen: { futureLessons: 1 }, request: { state: 'completed', completedVia: 'staff' } } });

    // Erased, signed out; the request completed by them; the task settled by them.
    expect(await g.prisma.teacher.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ name: 'Deleted user', isActive: false });
    expect((await call(teacher, 'GET', '/me')).status).toBe(401);
    expect((await requestsOf(t.accountId))[0]).toMatchObject({ state: 'completed', completed_via: 'staff', completed_by: m.teachersManager.id });
    expect(await tasksOf('teacher_deletion_request', request.id)).toEqual([expect.objectContaining({ state: 'completed', closed_by: m.teachersManager.id })]);
    expect((await audits(request.id)).map((a) => [a.action, a.actor_id])).toEqual([
      ['account_deletion_request.created', t.id],
      ['account_deletion_request.completed', m.teachersManager.id],
    ]);
    // The lesson ahead stays, on "Deleted user", flagged high for the Teachers manager.
    expect(await g.prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).toMatchObject({ teacherId: t.id, outcome: null });
    expect(await tasksOf('teacher_account_deleted', t.id)).toEqual([expect.objectContaining({ assignee_staff_id: m.teachersManager.id, priority: 'high' })]);
    // Payroll still open: the payout account stays until it is settled, and staff are told.
    expect(await g.prisma.teacherPayoutAccount.count({ where: { teacherId: t.id } })).toBe(1);
    expect(await tasksOf('erased_teacher_payroll', t.id)).toEqual([
      expect.objectContaining({ state: 'open', assignee_staff_id: m.teachersManager.id, priority: 'high' }),
    ]);
    // Once only.
    expect(await call(manager, 'POST', `${path}/complete`, { confirm: true })).toMatchObject({ status: 409 });
  });

  it('6. once nothing is open, the holder\'s own deletion is immediate and completes the request', async () => {
    const t = await newTeacher('later');
    const child = m.families[4]!.children[0]!;
    const before = await g.prisma.learner.findUniqueOrThrow({ where: { id: child.id }, select: { teacherId: true } });
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${t.id}'::uuid where id = '${child.id}'::uuid`);
    const { token } = await login(t.subject);
    const request = (await call(token, 'POST', '/me/account/delete', { password: PASSWORD })).json.request as { id: string };
    // Staff move the student back: nothing is open any more.
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = ${before.teacherId ? `'${before.teacherId}'::uuid` : 'null'} where id = '${child.id}'::uuid`);
    expect(await call(token, 'GET', '/me/account/deletion')).toMatchObject({ json: { immediate: true, request: { id: request.id, state: 'pending' } } });
    expect(await call(token, 'POST', '/me/account/delete', { password: PASSWORD })).toMatchObject({ status: 200, json: { deleted: true } });
    expect((await requestsOf(t.accountId))[0]).toMatchObject({ state: 'completed', completed_via: 'holder', completed_by: null });
    expect(await tasksOf('teacher_deletion_request', request.id)).toEqual([expect.objectContaining({ state: 'completed' })]);
  });

  it('7. day 21 and day 28 remind once per recipient; at the deadline the worker erases, flagging what is left', async () => {
    const t = await newTeacher('deadline');
    const lesson = await lessonAhead(t.id);
    await openPayroll(t.id);
    await payoutAccount(t.id);
    const id = await pastRequest(t);

    // Before day 21: nothing. At day 21: the Teachers manager, once -- a second sweep adds nothing.
    await sweep(BEFORE(DAY21));
    expect(await reminders(id, 21)).toEqual([]);
    await sweep(DAY21);
    await sweep(DAY21);
    await sweep(new Date(DAY21.getTime() + 3_600_000));
    expect(await reminders(id, 21)).toEqual([{ recipient_id: m.teachersManager.id }]);
    expect(await reminders(id, 28)).toEqual([]);
    // Day 28, once.
    await sweep(DAY28);
    await sweep(DAY28);
    expect(await reminders(id, 28)).toEqual([{ recipient_id: m.teachersManager.id }]);
    expect(await reminders(id, 21)).toEqual([{ recipient_id: m.teachersManager.id }]);

    // A minute before the deadline: still there.
    expect(await sweep(BEFORE(DEADLINE))).toMatchObject({ erased: 0 });
    expect((await requestsOf(t.accountId))[0]!.state).toBe('pending');
    expect((await login(t.subject)).status).toBe(200);
    // At the deadline: the same erasure.
    expect(await sweep(DEADLINE)).toMatchObject({ erased: 1 });
    expect((await requestsOf(t.accountId))[0]).toMatchObject({
      state: 'completed', completed_via: 'deadline', completed_by: null,
      left_open: { futureLessons: 1, assignedLearners: 0, openPayroll: true },
    });
    expect(await g.prisma.teacher.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ name: 'Deleted user', isActive: false });
    expect((await login(t.subject)).status).toBe(401);
    // The lesson ahead stays on "Deleted user", flagged high; payroll rows kept, and (payroll open) the payout account too.
    expect(await g.prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).toMatchObject({ teacherId: t.id, outcome: null });
    expect(await tasksOf('teacher_account_deleted', t.id)).toEqual([expect.objectContaining({ priority: 'high', assignee_staff_id: m.teachersManager.id })]);
    expect(await g.prisma.teacherPayAdjustment.count({ where: { teacherId: t.id } })).toBe(1);
    expect(await g.prisma.teacherPayoutAccount.count({ where: { teacherId: t.id } })).toBe(1);
    expect(await tasksOf('erased_teacher_payroll', t.id)).toEqual([expect.objectContaining({ state: 'open', priority: 'high' })]);
    expect(await tasksOf('teacher_deletion_request', id)).toEqual([expect.objectContaining({ state: 'completed' })]);
    expect((await audits(id)).map((a) => [a.action, a.actor_id])).toEqual([['account_deletion_request.completed', null]]);
    // Nothing more, ever: the sweep finds nothing pending; no reminder after completion.
    expect(await sweep(new Date(DEADLINE.getTime() + 86_400_000))).toMatchObject({ reminded: 0, erased: 0 });

    // The payroll is settled -- its month is past (time moved on: the row's month is set back, triggers off) --
    // and the next sweep deletes the payout account and completes the staff task. Payroll rows stay.
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(
        `update chat.teacher_pay_adjustment set month = (date_trunc('month', now()) - interval '3 months')::date where teacher_id = $1::uuid`, t.id,
      );
    });
    expect(await sweep(new Date(DEADLINE.getTime() + 2 * 86_400_000))).toMatchObject({ payrollSettled: 1 });
    expect(await g.prisma.teacherPayoutAccount.count({ where: { teacherId: t.id } })).toBe(0);
    expect(await g.prisma.teacherPayAdjustment.count({ where: { teacherId: t.id } })).toBe(1);
    expect(await tasksOf('erased_teacher_payroll', t.id)).toEqual([expect.objectContaining({ state: 'completed', closed_by: m.teachersManager.id })]);
    // The staff-completed teacher of case 5 still has payroll open: their account stays.
    expect(await g.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM chat.teacher_payout_account p JOIN chat.teacher te ON te.id = p.teacher_id
       WHERE te.organization_id = ${orgId}::uuid AND te.name = 'Deleted user'`).toEqual([{ n: 1 }]);
  });

  it('7b. a worker down over day 21 sends only day 28, never both at once', async () => {
    const t = await newTeacher('late');
    await lessonAhead(t.id);
    const id = await pastRequest(t);
    await sweep(DAY28);
    expect(await reminders(id, 28)).toEqual([{ recipient_id: m.teachersManager.id }]);
    expect(await reminders(id, 21)).toEqual([]);
    await sweep(DAY28);
    expect(await reminders(id, 21)).toEqual([]);
    const marks = await g.prisma.$queryRaw<Array<{ day: number }>>`SELECT day FROM chat.account_deletion_reminder WHERE request_id = ${id}::uuid ORDER BY day`;
    expect(marks.map((x) => x.day)).toEqual([21, 28]);
  });

  it('8. fail closed: no request role reads or writes either table; the guards hold', async () => {
    const t = await newTeacher('guards');
    await lessonAhead(t.id);
    const id = await pastRequest(t);
    for (const role of ['chat_app', 'authenticated', 'anon']) {
      const [{ exists }] = await g.prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(`select exists (select 1 from pg_roles where rolname = $1) as exists`, role);
      if (!exists) continue;
      for (const sql of [
        `select count(*) from chat.account_deletion_request`,
        `select count(*) from chat.account_deletion_reminder`,
        `update chat.account_deletion_request set state = 'cancelled' where id = '${id}'::uuid`,
        `select chat.request_account_deletion('${t.accountId}'::uuid)`,
        `select chat.complete_account_deletion_request('${id}'::uuid, null, 'deadline')`,
      ]) {
        await expect(
          g.prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`set local role ${role}`);
            await tx.$queryRawUnsafe(sql);
          }),
        ).rejects.toThrow(/permission denied|insufficient|only the server/);
      }
    }
    // The server itself cannot rewrite what was asked, skip the deadline, or delete.
    await expect(g.prisma.$executeRawUnsafe(`update chat.account_deletion_request set deadline_at = deadline_at + interval '1 day' where id = $1::uuid`, id)).rejects.toThrow(/never changes what was asked/);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.account_deletion_request where id = $1::uuid`, id)).rejects.toThrow(/never deleted/);
    // One pending request per account.
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.account_deletion_request (account_id, teacher_id, deadline_at) values ($1::uuid, $2::uuid, now())`, t.accountId, t.id,
    )).rejects.toThrow(/23505|already exists/);
    // Not a parent's, and not someone else's teacher row.
    const parent = await g.prisma.contact.findUniqueOrThrow({ where: { id: m.families[5]?.parent.id ?? m.families[0]!.parent.id } });
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.account_deletion_request (account_id, teacher_id, deadline_at) values ($1::uuid, $2::uuid, now())`, parent.accountId, t.id,
    )).rejects.toThrow(/a teacher's, for their own account/);
    // A cancelled request never changes again, and nothing completes before its deadline.
    await g.prisma.$queryRawUnsafe(`select chat.cancel_account_deletion_request($1::uuid)::text`, t.accountId);
    await expect(g.prisma.$executeRawUnsafe(`update chat.account_deletion_request set state = 'completed', completed_via = 'holder' where id = $1::uuid`, id)).rejects.toThrow(/cancelled deletion request never changes/);
    const fresh = await g.prisma.$queryRawUnsafe<Array<{ r: { id: string } }>>(`select chat.request_account_deletion($1::uuid) as r`, t.accountId);
    await expect(g.prisma.$queryRawUnsafe(`select chat.complete_account_deletion_request($1::uuid, null, 'deadline')::text`, fresh[0]!.r.id)).rejects.toThrow(/not due yet/);
    // The erasure's gate still refuses anyone but a request's completion.
    await expect(g.prisma.$queryRawUnsafe(`select chat.erase_account($1::uuid, 'direct')::text`, t.accountId)).rejects.toThrow(/TEACHER_DELETION_BLOCKED/);
    // A reminder only for a pending request, never changed.
    await expect(g.prisma.$executeRawUnsafe(`insert into chat.account_deletion_reminder (request_id, day) values ($1::uuid, 21)`, id)).rejects.toThrow(/pending deletion request/);
  });

  it('9. the public page: a teacher with work open gets a request and the date it is deleted by', async () => {
    const t = await newTeacher('page');
    await lessonAhead(t.id);
    const html0 = await (await fetch(`${base}/account-deletion?lang=en`)).text();
    const token = /name="token" value="([^"]+)"/.exec(html0)![1]!;
    const r = await fetch(`${base}/account-deletion?lang=en`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: t.subject, password: PASSWORD, confirm: 'yes', token }).toString(),
    });
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain('Your deletion request is recorded');
    const [req] = await requestsOf(t.accountId);
    expect(req).toMatchObject({ state: 'pending' });
    expect(html).toContain(new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(req!.deadline_at));
    expect(html).not.toContain('contact the academy');
    expect((await login(t.subject)).status).toBe(200);
  });
  it('10. the 30 days are 720 hours in any session time zone, across a daylight-saving change', async () => {
    const t = await newTeacher('dst');
    // 2026-03-10 to 2026-04-09 crosses Europe/London's change of 2026-03-29: 30 local days are 719 hours there.
    const insert = (deadline: string) =>
      g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local timezone = 'Europe/London'`);
        await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
        await tx.$executeRawUnsafe(
          `insert into chat.account_deletion_request (organization_id, account_id, teacher_id, requested_at, deadline_at, state, cancelled_at)
           values ($1::uuid, $2::uuid, $3::uuid, '2026-03-10T09:00:00Z'::timestamptz, ${deadline}, 'cancelled', '2026-03-11T09:00:00Z')`,
          orgId, t.accountId, t.id,
        );
      });
    await expect(insert(`'2026-03-10T09:00:00Z'::timestamptz + interval '30 days'`)).rejects.toThrow(/account_deletion_request_deadline|23514/);
    await insert(`'2026-03-10T09:00:00Z'::timestamptz + interval '720 hours'`);
    // And the guard stamps 720 hours whatever the session's zone.
    await lessonAhead(t.id);
    const [{ r }] = await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local timezone = 'America/New_York'`);
      return tx.$queryRawUnsafe<Array<{ r: { requestedAt: string; deadlineAt: string } }>>(`select chat.request_account_deletion($1::uuid) as r`, t.accountId);
    });
    expect(Date.parse(r.deadlineAt) - Date.parse(r.requestedAt)).toBe(720 * 3_600_000);
    await g.prisma.$queryRawUnsafe(`select chat.cancel_account_deletion_request($1::uuid)::text`, t.accountId);
  });

  it('11. request-then-cancel cycles are rate-limited, both ways (no clearing on success)', async () => {
    const t = await newTeacher('cycle');
    await lessonAhead(t.id);
    const { token } = await login(t.subject);
    // The per-account limit is 10 in 15 minutes for each route.
    for (let i = 0; i < 10; i++) {
      expect((await call(token, 'POST', '/me/account/delete', { password: PASSWORD })).status).toBe(200);
      expect((await call(token, 'POST', '/me/account/deletion-request/cancel')).status).toBe(200);
    }
    expect(await call(token, 'POST', '/me/account/delete', { password: PASSWORD })).toMatchObject({ status: 429, code: 'COMMON.RATE_LIMITED' });
    expect((await call(token, 'POST', '/me/account/deletion-request/cancel')).status).toBe(429);
    expect((await requestsOf(t.accountId)).map((r) => r.state)).toEqual(Array(10).fill('cancelled'));
  });

  it('12. a forced erasure ends the weekly times, hands each learner to staff with their lessons, and stops the family\'s reminders', async () => {
    const t = await newTeacher('handover');
    const family = m.families[2]!;
    const child = family.children[0]!;
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${t.id}'::uuid where id = '${child.id}'::uuid`);
    const [{ id: slotId }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.learner_schedule_slot (organization_id, learner_id, teacher_id, weekday, start_minute, duration_minutes, timezone, valid_from, created_by)
       values ($1::uuid, $2::uuid, $3::uuid, 1, 600, 30, 'Africa/Cairo', '2026-01-05', $4::uuid) returning id::text as id`,
      orgId, child.id, t.id, m.superAdmin.id,
    );
    const weekly = await g.prisma.lesson.create({
      data: { organizationId: orgId, kind: 'regular', learnerId: child.id, teacherId: t.id, startsAt: AHEAD, endsAt: new Date(AHEAD.getTime() + 1_800_000), createdByKind: 'staff', createdBy: m.superAdmin.id },
    });
    // The family's 24-hour reminder, already queued.
    const reminderKey = `lesson_parent_t24h:${weekly.id}:${family.parent.id}`;
    await g.prisma.notification.create({
      data: { organizationId: orgId, dedupeKey: reminderKey, ruleKey: null, templateKey: 'lesson_reminder_tomorrow', eventType: 'lesson_scheduled', recipientId: family.parent.id, scheduledAt: new Date(AHEAD.getTime() - 86_400_000) },
    });
    await pastRequest(t);

    await sweep(DEADLINE);
    expect((await requestsOf(t.accountId))[0]).toMatchObject({ state: 'completed', completed_via: 'deadline' });
    // The weekly time is ended; the lesson is not cancelled, and its family is reminded of nothing.
    const slot = await g.prisma.learnerScheduleSlot.findUniqueOrThrow({ where: { id: slotId } });
    expect(slot.validTo).not.toBeNull();
    const lesson = await g.prisma.lesson.findUniqueOrThrow({ where: { id: weekly.id } });
    expect(lesson).toMatchObject({ teacherId: t.id, outcome: null });
    expect(lesson.remindersScheduledAt).not.toBeNull();
    expect(await g.prisma.notification.findUniqueOrThrow({ where: { dedupeKey: reminderKey } })).toMatchObject({ status: 'cancelled' });
    // One task per learner: needs a new teacher, with the lesson to reassign or cancel.
    const handovers = await g.prisma.$queryRaw<Array<{ id: string; learner_id: string; lesson_ids: string[]; slot_ids: string[] }>>`
      SELECT id::text, learner_id::text, lesson_ids::text[] AS lesson_ids, slot_ids::text[] AS slot_ids
        FROM chat.erased_teacher_handover WHERE teacher_id = ${t.id}::uuid`;
    expect(handovers).toEqual([{ id: expect.any(String), learner_id: child.id, lesson_ids: [weekly.id], slot_ids: [slotId] }]);
    expect(await tasksOf('learner_needs_teacher', handovers[0]!.id)).toEqual([
      expect.objectContaining({ state: 'open', assignee_staff_id: m.teachersManager.id, priority: 'high', due_at: AHEAD }),
    ]);
    // Fail closed, like the request.
    await expect(g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local role chat_app`);
      await tx.$queryRawUnsafe(`select count(*) from chat.erased_teacher_handover`);
    })).rejects.toThrow(/permission denied/);

    // Staff give the learner a new teacher and the lesson leaves the erased teacher: the task completes itself.
    const next = await newTeacher('next');
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${next.id}'::uuid where id = '${child.id}'::uuid`);
    await g.prisma.$executeRawUnsafe(`update chat.lesson set teacher_id = $1::uuid, reminders_scheduled_at = null where id = $2::uuid`, next.id, weekly.id);
    expect(await sweep(new Date(DEADLINE.getTime() + 86_400_000))).toMatchObject({ handoversSettled: 1 });
    expect(await tasksOf('learner_needs_teacher', handovers[0]!.id)).toEqual([expect.objectContaining({ state: 'completed', closed_by: m.teachersManager.id })]);
  });

  it('13. a fresh request swept by a worker whose clock is past its deadline stays pending (the database clock decides)', async () => {
    const t = await newTeacher('clock');
    await lessonAhead(t.id);
    const { token } = await login(t.subject);
    const request = (await call(token, 'POST', '/me/account/delete', { password: PASSWORD })).json.request as { id: string; deadlineAt: string };
    expect(await sweep(new Date(Date.parse(request.deadlineAt) + 1_000))).toMatchObject({ erased: 0 });
    expect((await requestsOf(t.accountId))[0]).toMatchObject({ id: request.id, state: 'pending' });
    expect((await login(t.subject)).status).toBe(200);
  });

  it('14. the sweep always ends: 51 due-on-the-worker-clock requests that all fail', async () => {
    // 51 fresh requests (more than one batch of 50); a worker clock in 2099 thinks every one is due,
    // the database refuses each (not due yet). Before the fix the sweep re-queried the same batch forever.
    await g.prisma.$executeRawUnsafe(`
      with a as (
        insert into chat.account (organization_id, subject, kind, status, is_active)
        select $1::uuid, 'teacher.many' || i || '@${DOMAIN}', 'teacher', 'active', true from generate_series(1, 51) i
        returning id, subject
      ), t as (
        insert into chat.teacher (organization_id, name, account_id, is_active)
        select $1::uuid, 'teacher_many', a.id, true from a returning id, account_id
      )
      insert into chat.account_deletion_request (account_id, teacher_id, deadline_at)
      select t.account_id, t.id, now() from t`, orgId);
    const started = Date.now();
    const out = await sweep(new Date('2099-06-01T00:00:00Z'));
    expect(out).toMatchObject({ erased: 0 });
    expect(Date.now() - started).toBeLessThan(60_000);
    const [{ n }] = await g.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM chat.account_deletion_request q JOIN chat.teacher te ON te.id = q.teacher_id
       WHERE te.name = 'teacher_many' AND q.state = 'pending'`;
    expect(n).toBe(51);
  }, 90_000);
});
