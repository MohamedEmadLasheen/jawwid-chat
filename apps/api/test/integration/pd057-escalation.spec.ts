/**
 * PD-57 ENG-04: report escalation and notifications, to the owner's 24 h SLA
 * (closure plan 2026-11-06 D-1, D-4; roadmap 2026-11-03 §5.2 for the rest).
 *
 *   report.created   normal: report_received_staff to the managers of the
 *                    report's departments (the Super Admin when none), quiet
 *                    hours kept. child_safety (and a duplicate that raised a
 *                    report to it): report_child_safety to every Super Admin and
 *                    every holder of moderation.child_safety AT ONCE -- past
 *                    quiet hours and the hourly cap, never coalesced -- and
 *                    never to a department manager. Ids, reason, priority and
 *                    dueAt only.
 *   PD-47 task       one per report (content_report), due at dueAt, for the
 *                    same people (child_safety: the Super Admin); completed when
 *                    the report is resolved
 *   the sweep        18 h unresolved: report_due_soon to the managers
 *                    (child_safety: Super Admin + holders); 24 h: report_overdue
 *                    to every Super Admin and overdue_at set once. Each stage
 *                    once (chat.content_report_alert), however often or however
 *                    many workers run it. Fixed instants, the clock injected.
 *   report.answered  report_answered to the reporter: no reviewer, no subject;
 *                    an erased reporter gets nothing
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { hashPassword } from '@platform/auth/password';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { NotificationPipeline } from '@communication/notifications/notification-pipeline.service';
import { CommEvent } from '@communication/contracts/events';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { AccountAdminModule } from '../../src/account-admin/account-admin.module';
import { ModerationModule } from '../../src/moderation/moderation.module';
import { ReportEscalationService } from '../../src/moderation/report-escalation.service';
import { TaskModule } from '../../src/tasks/task.module';
import { AppConfigService } from '../../src/platform/app-config.service';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const inheritedStorageRoot = process.env.STORAGE_LOCAL_ROOT;
const PASSWORD = 'pd57-escalation-spec-password-1';
const DOMAIN = 'pd57esc.qa.jawwid.test';
const OFFICER = `child.safety@${DOMAIN}`;

// Fixed instants (never now + N): a report filed at CREATED is due at DUE.
const CREATED = '2026-01-05T10:00:00.000Z';
const DUE = '2026-01-06T10:00:00.000Z';
const AT_17H59 = new Date('2026-01-06T03:59:59.000Z');
const AT_18H = new Date('2026-01-06T04:00:00.000Z');
const AT_24H = new Date('2026-01-06T10:00:00.000Z');
const AT_25H = new Date('2026-01-06T11:00:00.000Z');
// 23:30 UTC: inside a 22:00-08:00 UTC quiet window, which ends at NIGHT_ENDS.
const NIGHT = new Date('2026-01-05T23:30:00.000Z');
const NIGHT_ENDS = new Date('2026-01-06T08:00:00.000Z');

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
let officerId: string;
let escalation: ReportEscalationService;

const tokens = new Map<string, string>();
async function login(subject: string): Promise<string> {
  const cached = tokens.get(subject);
  if (cached) return cached;
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: subject, password: PASSWORD }),
  });
  const json = (await r.json()) as { accessToken: string };
  if (r.status !== 200) throw new Error(`login ${subject}: ${r.status}`);
  tokens.set(subject, json.accessToken);
  return json.accessToken;
}

type Reply = { status: number; json: any; text: string };
async function call(token: string, method: string, path: string, body?: unknown): Promise<Reply> {
  const send = body !== undefined && method !== 'GET';
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { ...(send ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${token}` },
    body: send ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { status: r.status, json, text };
}
const as = async (subject: string) => {
  const token = await login(subject);
  return {
    get: (path: string) => call(token, 'GET', path),
    post: (path: string, body?: unknown) => call(token, 'POST', path, body ?? {}),
  };
};

/** A message written straight into a conversation (triggers off, as other specs write history). */
async function post(conversationId: string, authorType: string, authorId: string, body: string) {
  return g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    const [{ seq }] = await tx.$queryRaw<Array<{ seq: bigint }>>`
      UPDATE chat.conversation SET last_seq = coalesce(last_seq, 0) + 1 WHERE id = ${conversationId}::uuid RETURNING last_seq AS seq`;
    const message = await tx.message.create({
      data: { organizationId: orgId, conversationId, authorType, authorId, type: 'text', body, visibility: 'customer', seq },
    });
    return message.id;
  });
}

const family = (i: number) => m.families[i]!;
const groupOf = (i: number) => family(i).groups[0]!;
const teacherOf = (id: string) => m.teachers.find((t) => t.id === id)!;
const accountIdOf = async (subject: string) =>
  (await g.prisma.account.findUniqueOrThrow({ where: { subject }, select: { id: true } })).id;

/** A report written as history (triggers off): filed at CREATED, due at DUE -- fixed instants. */
async function historicReport(over: { subjectKind: string; subjectId: string; reason: string; departmentIds: string[]; reporterIndex: number }) {
  const id = randomUUID();
  const reporter = family(over.reporterIndex).parent;
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    await tx.$executeRawUnsafe(
      `insert into chat.content_report (id, organization_id, reporter_kind, reporter_id, reporter_account_id, target_kind,
                                        subject_kind, subject_id, reason, priority, status, created_at, due_at, department_ids, evidence)
       values ($1::uuid, $2::uuid, 'contact', $3::uuid, $4::uuid, 'person', $5, $6::uuid, $7, $8, 'open',
               $9::timestamptz, $10::timestamptz, $11::uuid[], '{}'::jsonb)`,
      id,
      orgId,
      reporter.id,
      await accountIdOf(reporter.subject),
      over.subjectKind,
      over.subjectId,
      over.reason,
      over.reason === 'child_safety' ? 'urgent' : 'normal',
      CREATED,
      DUE,
      over.departmentIds,
    );
  });
  return id;
}

const items = (reportId: string, eventType?: string) =>
  g.prisma.notificationItem.findMany({
    where: { subjectType: 'content_report', subjectId: reportId, ...(eventType ? { eventType } : {}) },
    orderBy: [{ eventType: 'asc' }, { recipientId: 'asc' }],
  });
const recipientsOf = async (reportId: string, eventType: string) => (await items(reportId, eventType)).map((i) => i.recipientId).sort();
const alerts = (reportId: string) =>
  g.prisma.$queryRaw<Array<{ stage: string }>>`SELECT stage FROM chat.content_report_alert WHERE report_id = ${reportId}::uuid ORDER BY stage`;
const escalatedEvents = async (reportId: string) =>
  (await g.prisma.outboxEvent.findMany({ where: { type: 'report.escalated' } }))
    .map((e) => e.payload as { reportId: string; stage: string })
    .filter((p) => p.reportId === reportId)
    .map((p) => p.stage)
    .sort();
const taskOf = async (reportId: string) =>
  g.prisma.$queryRaw<Array<{ assignee: string; state: string; due_at: Date | null; source_state: string }>>`
    SELECT coalesce(t.assignee_staff_id, t.assignee_teacher_id)::text AS assignee, t.state, t.due_at, t.source_state
      FROM chat.work_task t WHERE t.source_type = 'content_report' AND t.source_id = ${reportId}::uuid`;
const drain = () => app.get(OutboxWorker).drain(500);

async function setConfig(key: string, value: unknown) {
  await g.prisma.config.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  app.get(AppConfigService).invalidate();
}

beforeAll(async () => {
  process.env.STORAGE_LOCAL_ROOT = mkdtempSync(join(tmpdir(), 'pd57-esc-'));
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(
    `delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug like 'pd57e-%')`,
  );
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd57e-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd57e-${orgId.slice(0, 8)}', 'PD-57 escalation QA academy')`,
  );
  const hash = await hashPassword(PASSWORD);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: hash } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: hash, messages: false });

  // D-4: a child-safety officer in no department, holding the queue's keys and moderation.child_safety.
  const account = await g.prisma.account.create({ data: { organizationId: orgId, subject: OFFICER, kind: 'staff', status: 'active', isActive: true } });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: hash } });
  officerId = (await g.prisma.staff.create({ data: { organizationId: orgId, name: 'QA Child Safety Officer', role: 'specialist', isActive: true, accountId: account.id } })).id;
  const [{ id: role }] = await g.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT chat.define_access_role('child_safety_officer', 'Child safety officer', 'Child safety officer', null, 'specialist',
           array['moderation.view', 'moderation.act', 'moderation.child_safety']::text[], 'spec', ${m.superAdmin.id}::uuid)::text AS id`;
  await g.prisma.$queryRaw`SELECT chat.grant_access_role(${officerId}::uuid, ${role}::uuid, 'spec', ${m.superAdmin.id}::uuid)`;

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, AccountAdminModule, ModerationModule, TaskModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
  escalation = app.get(ReportEscalationService);
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key in ('notification.push_per_hour', 'notification.rate_limited_categories')`);
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(
    `delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug like 'pd57e-%')`,
  );
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd57e-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedStorageRoot === undefined) delete process.env.STORAGE_LOCAL_ROOT;
  else process.env.STORAGE_LOCAL_ROOT = inheritedStorageRoot;
});

// ---------------------------------------------------------------------------
// report.created
// ---------------------------------------------------------------------------

describe('report.created: who is told at once', () => {
  it('normal: the managers of the report\'s departments only; a PD-47 task due at dueAt, completed on resolve; the reporter answered with no reviewer and no subject', async () => {
    const group = groupOf(0);
    const teacher = teacherOf(group.teacherIds[0]!);
    const parent = family(0).parent;
    const messageId = await post(group.conversationId, 'teacher', teacher.id, 'Unkind words, escalation spec.');
    const filed = await (await as(parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'harassment', note: 'Please look at this.' });
    expect(filed.status).toBe(201);
    const reportId = filed.json.id as string;
    const report = await g.prisma.contentReport.findUniqueOrThrow({ where: { id: reportId } });
    expect(report.departmentIds).toEqual([m.departments.teachers]);

    await drain();
    expect(await recipientsOf(reportId, 'report_received_staff')).toEqual([m.teachersManager.id]);
    // Not the other departments' managers, the Super Admin, or the child-safety officer.
    expect((await items(reportId)).map((i) => i.recipientId)).toEqual([m.teachersManager.id]);
    const [item] = await items(reportId, 'report_received_staff');
    expect(item).toMatchObject({ category: 'task', templateKey: 'inbox.report_received_staff', organizationId: orgId, pushState: 'scheduled' });
    expect(item!.action).toEqual({ kind: 'open_report', reportId });
    expect(item!.variables).toEqual({ reportId, reason: 'harassment', priority: 'normal', dueAt: report.dueAt.toISOString() });
    const deliveries = await g.prisma.notification.findMany({ where: { recipientId: m.teachersManager.id, eventType: 'report_received_staff' } });
    expect(deliveries).toHaveLength(1);
    // No content: never the note, the message, the reporter or the subject.
    const text = JSON.stringify({ item, deliveries });
    for (const mark of ['Please look', 'Unkind words', parent.id, parent.name, teacher.id, teacher.name, messageId, group.conversationId]) {
      expect(text).not.toContain(mark);
    }

    // PD-47: one task, the manager's, due when the report is.
    expect(await taskOf(reportId)).toEqual([{ assignee: m.teachersManager.id, state: 'open', due_at: report.dueAt, source_state: 'pending' }]);
    // The task does not announce itself on top of the report's own notice.
    expect(await g.prisma.notificationItem.count({ where: { recipientId: m.teachersManager.id, eventType: 'task_assigned' } })).toBe(0);
    // In Tasks, linked to the report; never the reporter.
    const list = await (await as(m.teachersManager.subject)).get('/me/tasks');
    expect(list.status).toBe(200);
    expect(list.text).toContain('task.content_report');
    expect(list.text).toContain(reportId);
    expect(list.text).not.toContain(parent.id);
    expect(list.text).not.toContain('Please look');

    // Once, however often it is delivered.
    await escalation.deliver(CommEvent.REPORT_CREATED, { organizationId: orgId, reportId, priority: 'normal', change: 'created' });
    expect(await recipientsOf(reportId, 'report_received_staff')).toEqual([m.teachersManager.id]);

    // Resolved: the task is completed, by the resolver.
    const done = await (await as(m.teachersManager.subject)).post(`/moderation/reports/${reportId}/resolve`, {
      resolution: 'no_action',
      answer: 'Thank you, we looked into it.',
    });
    expect(done.status).toBe(200);
    expect((await taskOf(reportId)).map((t) => t.state)).toEqual(['completed']);

    // report_answered: the reporter, in-app and push, deep-linked to My reports.
    await drain();
    const answered = await items(reportId, 'report_answered');
    expect(answered.map((i) => i.recipientId)).toEqual([parent.id]);
    expect(answered[0]).toMatchObject({ category: 'system', templateKey: 'inbox.report_answered', pushState: 'scheduled' });
    expect(answered[0]!.action).toEqual({ kind: 'open_my_reports', reportId });
    const pushes = await g.prisma.notification.findMany({ where: { recipientId: parent.id, eventType: 'report_answered' } });
    expect(pushes).toHaveLength(1);
    const answeredText = JSON.stringify({ answered, pushes });
    for (const mark of [m.teachersManager.id, m.teachersManager.name, teacher.id, teacher.name, 'Thank you, we looked']) {
      expect(answeredText).not.toContain(mark);
    }
    // Once.
    await escalation.deliver(CommEvent.REPORT_ANSWERED, { organizationId: orgId, reportId });
    expect((await items(reportId, 'report_answered')).length).toBe(1);
  });

  it('no department: the Super Admin is told and holds the task', async () => {
    const reportId = await historicReport({ subjectKind: 'teacher', subjectId: groupOf(1).teacherIds[0]!, reason: 'spam', departmentIds: [], reporterIndex: 1 });
    await escalation.deliver(CommEvent.REPORT_CREATED, { organizationId: orgId, reportId, priority: 'normal', change: 'created' });
    expect(await recipientsOf(reportId, 'report_received_staff')).toEqual([m.superAdmin.id]);
    await escalation.sweep(new Date('2026-01-05T10:05:00.000Z'));
    expect((await taskOf(reportId)).map((t) => t.assignee)).toEqual([m.superAdmin.id]);
  });

  it('a block\'s case (reason blocked): no report_received_staff at once -- the managers get ENG-03\'s block notice -- but the 24 h clock, task and escalation still run', async () => {
    const reportId = await historicReport({ subjectKind: 'teacher', subjectId: groupOf(2).teacherIds[0]!, reason: 'blocked', departmentIds: [m.departments.operations], reporterIndex: 2 });
    await escalation.deliver(CommEvent.REPORT_CREATED, { organizationId: orgId, reportId, priority: 'normal', change: 'created' });
    expect(await items(reportId, 'report_received_staff')).toEqual([]);
    await escalation.sweep(new Date('2026-01-05T10:05:00.000Z'));
    expect(await taskOf(reportId)).toHaveLength(1);
    await escalation.sweep(new Date('2026-01-06T04:30:00.000Z'));
    await drain();
    expect(await escalatedEvents(reportId)).toContain('due_soon');
  });

  it('a manager who is the report\'s subject is never told, and never holds its task', async () => {
    const reportId = await historicReport({ subjectKind: 'staff', subjectId: m.operationsManager.id, reason: 'harassment', departmentIds: [m.departments.operations], reporterIndex: 2 });
    await escalation.deliver(CommEvent.REPORT_CREATED, { organizationId: orgId, reportId, priority: 'normal', change: 'created' });
    expect(await recipientsOf(reportId, 'report_received_staff')).toEqual([m.superAdmin.id]);
    await escalation.sweep(new Date('2026-01-05T10:05:00.000Z'));
    expect((await taskOf(reportId)).map((t) => t.assignee)).toEqual([m.superAdmin.id]);
  });

  describe('child_safety', () => {
    afterAll(async () => {
      await g.prisma.quietHours.deleteMany({ where: { actorId: { in: [m.superAdmin.id, officerId, m.teachersManager.id] } } });
      await g.prisma.$executeRawUnsafe(`delete from chat.config where key in ('notification.push_per_hour', 'notification.rate_limited_categories')`);
      app.get(AppConfigService).invalidate();
    });

    it('every Super Admin and child-safety holder at once, during quiet hours and past the hourly cap; never a department manager', async () => {
      // Everyone's night, 22:00-08:00 UTC, and an hourly cap of 1 on the task category, already used.
      for (const actorId of [m.superAdmin.id, officerId, m.teachersManager.id]) {
        await g.prisma.actorTimeZone.deleteMany({ where: { actorId } });
        await g.prisma.quietHours.upsert({
          where: { actorId },
          create: { actorId, organizationId: orgId, timezone: 'UTC', startMinute: 1320, endMinute: 480, enabled: true },
          update: { timezone: 'UTC', startMinute: 1320, endMinute: 480, enabled: true },
        });
      }
      await setConfig('notification.push_per_hour', 1);
      await setConfig('notification.rate_limited_categories', ['task']);
      for (const recipientId of [m.superAdmin.id, officerId]) {
        await g.notifications.schedule({
          dedupeKey: `pd57-esc-cap:${recipientId}`,
          templateKey: 'task_assigned',
          eventType: 'task_assigned',
          recipientId,
          scheduledAt: new Date(NIGHT.getTime() - 10 * 60_000),
          respectQuietHours: false,
        });
      }
      // The cap is live: an ordinary task-category notice to the Super Admin now is held back.
      const pipeline = app.get(NotificationPipeline);
      const capped = await pipeline.emit({
        dedupeKey: `pd57-esc-control:${m.superAdmin.id}`,
        ruleKey: null,
        eventType: 'task_assigned',
        templateKey: 'task_assigned',
        recipientId: m.superAdmin.id,
        scheduledAt: NIGHT,
      });
      expect((await g.prisma.notificationItem.findUniqueOrThrow({ where: { id: capped! } })).pushState).toBe('rate_limited');

      const group = groupOf(3);
      const teacher = teacherOf(group.teacherIds[0]!);
      const messageId = await post(group.conversationId, 'teacher', teacher.id, 'Worrying words, escalation spec.');
      const filed = await (await as(family(3).parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'child_safety' });
      expect(filed.status).toBe(201);
      const reportId = filed.json.id as string;
      const report = await g.prisma.contentReport.findUniqueOrThrow({ where: { id: reportId } });
      expect(report.departmentIds).toEqual([m.departments.teachers]);

      // Delivered at the fixed night instant (the worker passes its own clock).
      await escalation.deliver(CommEvent.REPORT_CREATED, { organizationId: orgId, reportId, priority: 'urgent', change: 'created' }, NIGHT);
      expect(await recipientsOf(reportId, 'report_child_safety')).toEqual([m.superAdmin.id, officerId].sort());
      // Never a department manager, though the report is in the Teachers department.
      expect((await items(reportId)).map((i) => i.recipientId)).not.toContain(m.teachersManager.id);
      for (const i of await items(reportId, 'report_child_safety')) {
        expect(i).toMatchObject({ severity: 'critical', pushState: 'scheduled', category: 'task', templateKey: 'inbox.report_child_safety' });
        expect(i.variables).toEqual({ reportId, reason: 'child_safety', priority: 'urgent', dueAt: report.dueAt.toISOString() });
      }
      const pushes = await g.prisma.notification.findMany({ where: { eventType: 'report_child_safety', recipientId: { in: [m.superAdmin.id, officerId] } } });
      expect(pushes).toHaveLength(2);
      // Now, not at the end of the night.
      for (const p of pushes) expect(p.scheduledAt.toISOString()).toBe(NIGHT.toISOString());
      // One push each, never folded into another.
      expect(new Set(pushes.map((p) => p.dedupeKey)).size).toBe(2);

      // The task is the Super Admin's, never a department's.
      expect((await taskOf(reportId)).map((t) => t.assignee)).toEqual([m.superAdmin.id]);

      // The worker's own pass afterwards adds nothing.
      await drain();
      expect((await items(reportId)).length).toBe(2);
    });

    it('control: a normal report at the same night instant waits for the end of quiet hours', async () => {
      const group = groupOf(4);
      const teacher = teacherOf(group.teacherIds[0]!);
      const messageId = await post(group.conversationId, 'teacher', teacher.id, 'Spam, escalation spec.');
      const filed = await (await as(family(4).parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'spam' });
      const reportId = filed.json.id as string;
      await escalation.deliver(CommEvent.REPORT_CREATED, { organizationId: orgId, reportId, priority: 'normal', change: 'created' }, NIGHT);
      expect(await recipientsOf(reportId, 'report_received_staff')).toEqual([m.teachersManager.id]);
      const [push] = await g.prisma.notification.findMany({ where: { eventType: 'report_received_staff', recipientId: m.teachersManager.id, dedupeKey: { contains: reportId } } });
      expect(push!.scheduledAt.toISOString()).toBe(NIGHT_ENDS.toISOString());
      await drain();
    });

    it('a duplicate that raises an open report to child_safety escalates it the same way, and moves its task to the Super Admin', async () => {
      const group = groupOf(5);
      const teacher = teacherOf(group.teacherIds[0]!);
      const messageId = await post(group.conversationId, 'teacher', teacher.id, 'Raised later, escalation spec.');
      const parent = await as(family(5).parent.subject);
      const first = await parent.post('/reports', { targetKind: 'message', messageId, reason: 'inappropriate' });
      expect(first.status).toBe(201);
      const reportId = first.json.id as string;
      await drain();
      expect(await recipientsOf(reportId, 'report_received_staff')).toEqual([m.teachersManager.id]);
      expect((await taskOf(reportId)).map((t) => t.assignee)).toEqual([m.teachersManager.id]);

      const raised = await parent.post('/reports', { targetKind: 'message', messageId, reason: 'child_safety' });
      expect(raised.status).toBe(200);
      expect(raised.json.id).toBe(reportId);
      await drain();
      expect(await recipientsOf(reportId, 'report_child_safety')).toEqual([m.superAdmin.id, officerId].sort());
      expect((await taskOf(reportId)).map((t) => ({ assignee: t.assignee, state: t.state }))).toEqual([{ assignee: m.superAdmin.id, state: 'open' }]);
    });
  });
});

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

describe('the sweep: 18 h and 24 h, each once', () => {
  it('18 h: the department managers, once; a second sweep sends nothing; 24 h: every Super Admin, overdue_at set once', async () => {
    const reportId = await historicReport({ subjectKind: 'contact', subjectId: family(6).parent.id, reason: 'harassment', departmentIds: [m.departments.operations], reporterIndex: 7 });

    await escalation.sweep(AT_17H59);
    expect(await alerts(reportId)).toEqual([]);

    await escalation.sweep(AT_18H);
    expect(await alerts(reportId)).toEqual([{ stage: 'due_soon' }]);
    expect(await escalatedEvents(reportId)).toEqual(['due_soon']);
    await drain();
    expect(await recipientsOf(reportId, 'report_due_soon')).toEqual([m.operationsManager.id]);
    const [soon] = await items(reportId, 'report_due_soon');
    expect(soon).toMatchObject({ category: 'task', templateKey: 'inbox.report_due_soon' });
    expect(soon!.variables).toEqual({ reportId, reason: 'harassment', priority: 'normal', dueAt: DUE });
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id: reportId } })).overdueAt).toBeNull();

    await escalation.sweep(AT_18H);
    await escalation.sweep(new Date(AT_18H.getTime() + 5 * 60_000));
    await drain();
    expect(await escalatedEvents(reportId)).toEqual(['due_soon']);
    expect((await items(reportId, 'report_due_soon')).length).toBe(1);

    await escalation.sweep(AT_24H);
    expect(await alerts(reportId)).toEqual([{ stage: 'due_soon' }, { stage: 'overdue' }]);
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id: reportId } })).overdueAt?.toISOString()).toBe(AT_24H.toISOString());
    await drain();
    expect(await recipientsOf(reportId, 'report_overdue')).toEqual([m.superAdmin.id]);
    const [late] = await items(reportId, 'report_overdue');
    expect(late).toMatchObject({ category: 'task', templateKey: 'inbox.report_overdue', severity: 'high' });

    await escalation.sweep(AT_25H);
    await drain();
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id: reportId } })).overdueAt?.toISOString()).toBe(AT_24H.toISOString());
    expect(await escalatedEvents(reportId)).toEqual(['due_soon', 'overdue']);
    expect((await items(reportId, 'report_overdue')).length).toBe(1);
    expect(await recipientsOf(reportId, 'report_due_soon')).toEqual([m.operationsManager.id]);
  });

  it('child_safety at 18 h: the Super Admin and the holders, never the department\'s manager', async () => {
    const reportId = await historicReport({ subjectKind: 'teacher', subjectId: groupOf(8).teacherIds[0]!, reason: 'child_safety', departmentIds: [m.departments.teachers], reporterIndex: 8 });
    await escalation.sweep(AT_18H);
    await drain();
    expect(await recipientsOf(reportId, 'report_due_soon')).toEqual([m.superAdmin.id, officerId].sort());
    const due = await items(reportId, 'report_due_soon');
    for (const i of due) expect(i.severity).toBe('critical');
    expect((await items(reportId)).map((i) => i.recipientId)).not.toContain(m.teachersManager.id);
  });

  it('a resolved report is never alerted -- whether resolved before the sweep or between the sweep and the delivery', async () => {
    const owner = await as(m.superAdmin.subject);
    const before = await historicReport({ subjectKind: 'contact', subjectId: family(9).parent.id, reason: 'spam', departmentIds: [m.departments.operations], reporterIndex: 10 });
    expect((await owner.post(`/moderation/reports/${before}/resolve`, { resolution: 'no_action', answer: 'Thank you.' })).status).toBe(200);
    await escalation.sweep(AT_25H);
    expect(await alerts(before)).toEqual([]);
    expect(await escalatedEvents(before)).toEqual([]);

    const between = await historicReport({ subjectKind: 'contact', subjectId: family(11).parent.id, reason: 'spam', departmentIds: [m.departments.operations], reporterIndex: 12 });
    await escalation.sweep(AT_18H);
    expect(await escalatedEvents(between)).toEqual(['due_soon']);
    expect((await owner.post(`/moderation/reports/${between}/resolve`, { resolution: 'no_action', answer: 'Thank you.' })).status).toBe(200);
    await drain();
    expect(await items(between, 'report_due_soon')).toEqual([]);
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id: between } })).overdueAt).toBeNull();
  });

  it('two sweeps at once alert each stage once', async () => {
    const reportId = await historicReport({ subjectKind: 'contact', subjectId: family(13).parent.id, reason: 'harassment', departmentIds: [m.departments.operations], reporterIndex: 14 });
    await Promise.all([escalation.sweep(AT_24H), escalation.sweep(AT_24H), escalation.sweep(AT_24H)]);
    expect(await alerts(reportId)).toEqual([{ stage: 'due_soon' }, { stage: 'overdue' }]);
    expect(await escalatedEvents(reportId)).toEqual(['due_soon', 'overdue']);
    await Promise.all([drain(), drain()]);
    expect(await recipientsOf(reportId, 'report_due_soon')).toEqual([m.operationsManager.id]);
    expect(await recipientsOf(reportId, 'report_overdue')).toEqual([m.superAdmin.id]);
  });

  it('the marker table is insert-only, set once per stage, and no request role reaches it', async () => {
    const [row] = await g.prisma.$queryRaw<Array<{ id: string; report_id: string }>>`SELECT id::text, report_id::text FROM chat.content_report_alert LIMIT 1`;
    await expect(g.prisma.$executeRaw`UPDATE chat.content_report_alert SET stage = stage WHERE id = ${row!.id}::uuid`).rejects.toThrow(/never changed or deleted/);
    await expect(g.prisma.$executeRaw`DELETE FROM chat.content_report_alert WHERE id = ${row!.id}::uuid`).rejects.toThrow(/never changed or deleted/);
    await expect(
      g.prisma.$executeRaw`INSERT INTO chat.content_report_alert (organization_id, report_id, stage) VALUES (${orgId}::uuid, ${row!.report_id}::uuid, 'due_soon')`,
    ).rejects.toThrow();
    for (const role of ['chat_app', 'authenticated', 'anon']) {
      const r = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_table_privilege('${role}', 'chat.content_report_alert', 'SELECT') as ok`);
      expect({ role, ok: r[0]!.ok }).toEqual({ role, ok: false });
    }
    const [{ rls }] = await g.prisma.$queryRaw<Array<{ rls: boolean }>>`
      SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'chat' AND c.relname = 'content_report_alert'`;
    expect(rls).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// report.answered
// ---------------------------------------------------------------------------

describe('report.answered', () => {
  it('an erased reporter gets nothing', async () => {
    const group = groupOf(15);
    const parent = family(15).parent;
    const messageId = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Erased reporter, escalation spec.');
    const filed = await (await as(parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'spam' });
    const reportId = filed.json.id as string;
    expect((await (await as(m.superAdmin.subject)).post(`/moderation/reports/${reportId}/resolve`, { resolution: 'no_action', answer: 'Closed.' })).status).toBe(200);
    await g.prisma.$queryRawUnsafe(`select chat.erase_account($1::uuid, 'pd57 escalation spec')::text`, await accountIdOf(parent.subject));
    expect(await g.prisma.contentReport.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({ reporterId: null });
    await drain();
    expect(await items(reportId, 'report_answered')).toEqual([]);
    expect(await g.prisma.notification.count({ where: { recipientId: parent.id, eventType: 'report_answered' } })).toBe(0);
  });

  it('the texts: Arabic and English, generic, naming no reporter, reviewer or subject', async () => {
    const keys = ['report_received_staff', 'report_child_safety', 'report_due_soon', 'report_overdue', 'report_answered'];
    const templates = await g.prisma.notificationTemplate.findMany({ where: { key: { in: [...keys, ...keys.map((k) => `inbox.${k}`)] } } });
    expect(templates.map((t) => `${t.key}:${t.locale}`).sort()).toEqual(
      [...keys, ...keys.map((k) => `inbox.${k}`)].flatMap((k) => [`${k}:ar`, `${k}:en`]).sort(),
    );
    for (const t of templates) expect(`${t.title} ${t.body}`).not.toMatch(/\{/);
    const rules = await g.prisma.notificationRule.findMany({ where: { key: { in: keys } } });
    expect(rules.map((r) => r.key).sort()).toEqual([...keys].sort());
    expect(rules.find((r) => r.key === 'report_child_safety')).toMatchObject({ priority: 'critical', respectQuietHours: false });
  });
});
