/**
 * PD-57 ENG-02, the closure plan of 2026-11-06 (owner D-1..D-4) over real HTTP:
 * real logins, the global bearer and permission guards, the support-session
 * interceptor, the real routes, and the database of 20261104100000 and
 * 20261106100000.
 *
 *   §3  a report's departments are worked out when it is filed
 *       (reportDepartments); who sees a report: the Super Admin all; a
 *       department's managers its own departments' reports; child_safety only
 *       the Super Admin and holders of moderation.child_safety; never the
 *       report's own subject; anything else 404 COMM.REPORT_NOT_FOUND -- the
 *       same rule for the queue, the detail, take, resolve and attachments
 *   §4  queue rows and the detail name the subject; the detail lists the
 *       evidence attachments without object keys, and canAct; an attachment's
 *       5-minute link, audited, still served after the message was deleted for
 *       everyone, refused out of scope and in a support session; `warned` sends
 *       the Code of Conduct reminder and nothing names the report; `reassigned`
 *       raises a PD-47 task for the department's managers; a note is required
 *       for reassigned and account_suspended
 *   D-1 dueAt = createdAt + 24 h
 *   the exact JSON the clients parse: Flutter #464 (POST /reports,
 *       GET /me/reports, the error codes it maps) and Admin Web #461
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
import { CommErrorCode } from '@platform/errors';
import { MediaUrlSigner } from '@platform/media-url';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { AccountAdminModule } from '../../src/account-admin/account-admin.module';
import { ModerationModule } from '../../src/moderation/moderation.module';
import { TaskModule } from '../../src/tasks/task.module';
import { reportDepartments } from '../../src/moderation/departments';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const inheritedStorageRoot = process.env.STORAGE_LOCAL_ROOT;
const PASSWORD = 'pd57-scope-spec-password-1';
const DOMAIN = 'pd57scope.qa.jawwid.test';
const OFFICER = `child.safety@${DOMAIN}`;
const HOUR = 3_600_000;

const g = buildGraph();
let app: INestApplication;
let origin: string;
let base: string;
let m: SeedManifest;
let orgId: string;
let officerId: string;

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

type Reply = { status: number; code?: string; json: any; headers: Headers; text: string };
async function call(token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const send = body !== undefined && method !== 'GET';
  const h: Record<string, string> = { ...(send ? { 'content-type': 'application/json' } : {}), ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { method, headers: h, body: send ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { status: r.status, code: json?.error?.code, json, headers: r.headers, text };
}
const as = async (subject: string) => {
  const token = await login(subject);
  return {
    get: (path: string) => call(token, 'GET', path),
    post: (path: string, body?: unknown, headers?: Record<string, string>) => call(token, 'POST', path, body ?? {}, headers),
    del: (path: string) => call(token, 'DELETE', path),
  };
};

/** A message written straight into a conversation (triggers off, as other specs write history). */
async function post(
  conversationId: string,
  authorType: string,
  authorId: string | null,
  body: string | null,
  opts: { attachment?: { objectKey: string; name: string }; type?: string } = {},
) {
  const { attachment } = opts;
  return g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    const [{ seq }] = await tx.$queryRaw<Array<{ seq: bigint }>>`
      UPDATE chat.conversation SET last_seq = coalesce(last_seq, 0) + 1 WHERE id = ${conversationId}::uuid RETURNING last_seq AS seq`;
    const message = await tx.message.create({
      data: {
        organizationId: orgId,
        conversationId,
        authorType,
        authorId,
        type: opts.type ?? (attachment ? 'image' : 'text'),
        body,
        visibility: 'customer',
        seq,
        ...(authorType === 'staff' ? { onBehalfMode: 'owner' } : {}),
      },
    });
    if (attachment) {
      await tx.messageAttachment.create({
        data: { messageId: message.id, kind: 'image', objectKey: attachment.objectKey, mimeType: 'image/png', byteSize: 4, originalName: attachment.name },
      });
    }
    return message.id;
  });
}

const family = (i: number) => m.families[i]!;
const groupOf = (i: number) => family(i).groups[0]!;
const teacherOf = (id: string) => m.teachers.find((t) => t.id === id)!;
const accountIdOf = async (subject: string) =>
  (await g.prisma.account.findUniqueOrThrow({ where: { subject }, select: { id: true } })).id;
const ids = (r: Reply) => (r.json as Array<{ id: string }>).map((x) => x.id);
const notFound = (r: Reply) => ({ status: r.status, code: r.code });
const NOT_FOUND = { status: 404, code: CommErrorCode.REPORT_NOT_FOUND };

/** A report written as history (triggers off): for a subject the API would refuse, at fixed instants. */
async function historicReport(over: { subjectKind: string; subjectId: string; reason: string; departmentIds: string[]; reporterIndex: number }) {
  const id = randomUUID();
  const reporter = family(over.reporterIndex).parent;
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    await tx.$executeRawUnsafe(
      `insert into chat.content_report (id, organization_id, reporter_kind, reporter_id, reporter_account_id, target_kind,
                                        subject_kind, subject_id, reason, priority, status, created_at, due_at, department_ids, evidence)
       values ($1::uuid, $2::uuid, 'contact', $3::uuid, $4::uuid, 'person', $5, $6::uuid, $7, $8, 'open',
               '2026-01-05T10:00:00Z', '2026-01-06T10:00:00Z', $9::uuid[], '{}'::jsonb)`,
      id,
      orgId,
      reporter.id,
      await accountIdOf(reporter.subject),
      over.subjectKind,
      over.subjectId,
      over.reason,
      over.reason === 'child_safety' ? 'urgent' : 'normal',
      over.departmentIds,
    );
  });
  return id;
}

beforeAll(async () => {
  process.env.STORAGE_LOCAL_ROOT = mkdtempSync(join(tmpdir(), 'pd57-scope-'));
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(
    `delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug like 'pd57s-%')`,
  );
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd57s-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd57s-${orgId.slice(0, 8)}', 'PD-57 scope QA academy')`,
  );
  const hash = await hashPassword(PASSWORD);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: hash } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: hash, messages: false });

  // D-4: a child-safety officer -- a specialist in no department, granted the
  // queue's keys and moderation.child_safety by the Super Admin, through a role.
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
  origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  base = `${origin}/api/v1`;
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(
    `delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug like 'pd57s-%')`,
  );
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd57s-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedStorageRoot === undefined) delete process.env.STORAGE_LOCAL_ROOT;
  else process.env.STORAGE_LOCAL_ROOT = inheritedStorageRoot;
});

// ---------------------------------------------------------------------------
// §3: a report's departments
// ---------------------------------------------------------------------------

describe('§3: a report\'s departments, worked out when it is filed', () => {
  it('a teacher: their PD-35 supervisor\'s departments, else Teachers; written on the report', async () => {
    const group = groupOf(0);
    const teacherId = group.teacherIds[0]!;
    expect(await reportDepartments(g.prisma, { kind: 'teacher', id: teacherId })).toEqual([m.departments.teachers]);

    // It is the supervisor's departments that count: with the database's PD-35
    // rule set aside (in a rolled-back transaction), an Operations supervisor
    // gives Operations, and no supervisor at all the Teachers department.
    const rollback = new Error('rollback');
    await g.prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
        await tx.$executeRaw`UPDATE chat.teacher_supervisor_assignment SET supervisor_id = ${m.supervisors[0]!.id}::uuid WHERE teacher_id = ${teacherId}::uuid`;
        expect(await reportDepartments(tx, { kind: 'teacher', id: teacherId })).toEqual([m.departments.operations]);
        await tx.$executeRaw`DELETE FROM chat.teacher_supervisor_assignment WHERE teacher_id = ${teacherId}::uuid`;
        expect(await reportDepartments(tx, { kind: 'teacher', id: teacherId })).toEqual([m.departments.teachers]);
        throw rollback;
      })
      .catch((e) => {
        if (e !== rollback) throw e;
      });
    expect(await reportDepartments(g.prisma, { kind: 'teacher', id: teacherId })).toEqual([m.departments.teachers]);

    const messageId = await post(group.conversationId, 'teacher', teacherId, 'Departments: teacher.');
    const r = await (await as(family(0).parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'harassment' });
    expect(r.status).toBe(201);
    const row = await g.prisma.contentReport.findUniqueOrThrow({ where: { id: r.json.id } });
    expect(row.departmentIds).toEqual([m.departments.teachers]);
    // D-1: 24 hours.
    expect(row.dueAt.getTime() - row.createdAt.getTime()).toBe(24 * HOUR);
    expect(Date.parse(r.json.dueAt) - row.createdAt.getTime()).toBe(24 * HOUR);
  });

  it('a parent: the departments of their children\'s supervisors, else Operations; staff: what they manage or belong to; alsoFor adds the other side, once', async () => {
    const parent = family(1).parent;
    expect(await reportDepartments(g.prisma, { kind: 'contact', id: parent.id })).toEqual([m.departments.operations]);
    // No child supervised: Operations still (the fallback).
    const learners = family(1).children.map((c) => c.id);
    const saved = await g.prisma.learnerSupervision.findMany({ where: { learnerId: { in: learners } } });
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.learnerSupervision.deleteMany({ where: { learnerId: { in: learners } } });
    });
    try {
      expect(await reportDepartments(g.prisma, { kind: 'contact', id: parent.id })).toEqual([m.departments.operations]);
    } finally {
      await g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
        await tx.learnerSupervision.createMany({ data: saved });
      });
    }
    expect(await reportDepartments(g.prisma, { kind: 'staff', id: m.supervisors[0]!.id })).toEqual([m.departments.operations]);
    expect(await reportDepartments(g.prisma, { kind: 'staff', id: m.salesManager.id })).toEqual([m.departments.sales]);
    expect(await reportDepartments(g.prisma, { kind: 'staff', id: m.superAdmin.id })).toEqual([]);
    const both = await reportDepartments(g.prisma, { kind: 'contact', id: parent.id }, { alsoFor: { kind: 'teacher', id: groupOf(1).teacherIds[0]! } });
    expect(both).toEqual([m.departments.operations, m.departments.teachers].sort());
    expect(await reportDepartments(g.prisma, { kind: 'contact', id: parent.id }, { alsoFor: { kind: 'staff', id: m.supervisors[1]!.id } })).toEqual([
      m.departments.operations,
    ]);

    // Filed: a teacher reports the parent -> Operations.
    const teacher = teacherOf(groupOf(1).teacherIds[0]!);
    const r = await (await as(teacher.subject)).post('/reports', { targetKind: 'person', subject: { kind: 'contact', id: parent.id }, reason: 'spam' });
    expect(r.status).toBe(201);
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id: r.json.id } })).departmentIds).toEqual([m.departments.operations]);
  });
});

// ---------------------------------------------------------------------------
// §3: who sees a report
// ---------------------------------------------------------------------------

describe('§3 (D-2, D-3, D-4): who sees a report -- one rule for the queue, the detail, take, resolve and attachments', () => {
  let teachersReport: string; // a teacher's message, with an attachment: Teachers
  let opsReport: string; // a parent, reported by a teacher: Operations
  let childSafety: string; // child_safety about a teacher: Super Admin and the officer only
  let aboutOpsManager: string; // about the Operations manager, in Operations
  let noDepartment: string; // no department: the Super Admin only

  beforeAll(async () => {
    const group = groupOf(2);
    const teacherId = group.teacherIds[0]!;
    const key = `conversations/${group.conversationId}/${randomUUID()}.png`;
    await new LocalFsBlobStore().put(key, 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const withPhoto = await post(group.conversationId, 'teacher', teacherId, 'A photo.', { attachment: { objectKey: key, name: 'photo.png' } });
    const parent = await as(family(2).parent.subject);
    teachersReport = (await parent.post('/reports', { targetKind: 'message', messageId: withPhoto, reason: 'inappropriate' })).json.id;
    const worrying = await post(group.conversationId, 'teacher', teacherId, 'Something worrying.');
    childSafety = (await parent.post('/reports', { targetKind: 'message', messageId: worrying, reason: 'child_safety' })).json.id;
    opsReport = (
      await (await as(teacherOf(teacherId).subject)).post('/reports', { targetKind: 'person', subject: { kind: 'contact', id: family(2).parent.id }, reason: 'harassment' })
    ).json.id;
    aboutOpsManager = await historicReport({ subjectKind: 'staff', subjectId: m.operationsManager.id, reason: 'harassment', departmentIds: [m.departments.operations], reporterIndex: 3 });
    noDepartment = await historicReport({ subjectKind: 'teacher', subjectId: teacherId, reason: 'spam', departmentIds: [], reporterIndex: 4 });
    for (const id of [teachersReport, childSafety, opsReport]) expect(id).toEqual(expect.any(String));
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id: childSafety } })).departmentIds).toEqual([m.departments.teachers]);
  });

  it('D-2: the Super Admin sees every report', async () => {
    const owner = await as(m.superAdmin.subject);
    const list = await owner.get('/moderation/reports');
    expect(list.status).toBe(200);
    expect(ids(list)).toEqual(expect.arrayContaining([teachersReport, opsReport, childSafety, aboutOpsManager, noDepartment]));
    for (const id of [teachersReport, opsReport, childSafety, aboutOpsManager, noDepartment]) {
      expect((await owner.get(`/moderation/reports/${id}`)).status).toBe(200);
    }
  });

  it('D-3: the Operations manager sees only Operations reports; a Teachers report is 404 on detail, take, resolve and attachment', async () => {
    const ops = await as(m.operationsManager.subject);
    const list = await ops.get('/moderation/reports');
    expect(list.status).toBe(200);
    expect(ids(list)).toContain(opsReport);
    for (const id of [teachersReport, childSafety, noDepartment, aboutOpsManager]) expect(ids(list)).not.toContain(id);
    for (const r of [
      await ops.get(`/moderation/reports/${teachersReport}`),
      await ops.post(`/moderation/reports/${teachersReport}/take`),
      await ops.post(`/moderation/reports/${teachersReport}/resolve`, { resolution: 'no_action', answer: 'x' }),
      await ops.post(`/moderation/reports/${teachersReport}/attachments/0/url`),
    ]) {
      expect(notFound(r)).toEqual(NOT_FOUND);
    }
    const row = await g.prisma.contentReport.findUniqueOrThrow({ where: { id: teachersReport } });
    expect(row).toMatchObject({ status: 'open', takenBy: null });
    expect(await g.prisma.auditLog.count({ where: { entityId: teachersReport, actorId: m.operationsManager.id } })).toBe(0);
    // Every filter narrows inside the scope, never widens it.
    for (const q of ['?status=open', '?priority=urgent', '?overdue=true', '?overdue=false']) {
      const r = await ops.get(`/moderation/reports${q}`);
      for (const id of [teachersReport, childSafety, noDepartment, aboutOpsManager]) expect({ q, has: ids(r).includes(id) }).toEqual({ q, has: false });
    }
    // The Teachers manager sees the Teachers report and not the Operations one.
    const teachers = await as(m.teachersManager.subject);
    const theirs = ids(await teachers.get('/moderation/reports'));
    expect(theirs).toContain(teachersReport);
    expect(theirs).not.toContain(opsReport);
    expect(notFound(await teachers.get(`/moderation/reports/${opsReport}`))).toEqual(NOT_FOUND);
  });

  it('a manager never sees a report about themself, though it is in their department', async () => {
    const ops = await as(m.operationsManager.subject);
    expect(ids(await ops.get('/moderation/reports'))).not.toContain(aboutOpsManager);
    expect(notFound(await ops.get(`/moderation/reports/${aboutOpsManager}`))).toEqual(NOT_FOUND);
    expect(notFound(await ops.post(`/moderation/reports/${aboutOpsManager}/take`))).toEqual(NOT_FOUND);
    expect(notFound(await ops.post(`/moderation/reports/${aboutOpsManager}/resolve`, { resolution: 'no_action', answer: 'x' }))).toEqual(NOT_FOUND);
    expect(await g.prisma.contentReport.findUniqueOrThrow({ where: { id: aboutOpsManager } })).toMatchObject({ status: 'open', takenBy: null });
  });

  it('D-4: child_safety is invisible to the department managers, visible to the Super Admin and to staff granted moderation.child_safety', async () => {
    for (const subject of [m.teachersManager.subject, m.operationsManager.subject, m.salesManager.subject]) {
      const manager = await as(subject);
      expect({ subject, has: ids(await manager.get('/moderation/reports')).includes(childSafety) }).toEqual({ subject, has: false });
      expect(ids(await manager.get('/moderation/reports?priority=urgent'))).not.toContain(childSafety);
      expect(notFound(await manager.get(`/moderation/reports/${childSafety}`))).toEqual(NOT_FOUND);
      expect(notFound(await manager.post(`/moderation/reports/${childSafety}/take`))).toEqual(NOT_FOUND);
    }
    const officer = await as(OFFICER);
    const list = await officer.get('/moderation/reports');
    expect(list.status).toBe(200);
    // The key reaches child_safety only: the officer is in no department.
    expect(ids(list)).toEqual([childSafety]);
    const detail = await officer.get(`/moderation/reports/${childSafety}`);
    expect(detail.status).toBe(200);
    expect(detail.json.canAct).toBe(true);
    expect(notFound(await officer.get(`/moderation/reports/${teachersReport}`))).toEqual(NOT_FOUND);
    const taken = await officer.post(`/moderation/reports/${childSafety}/take`);
    expect(taken.json).toMatchObject({ status: 'in_review', takenBy: officerId });
    // The key alone is in no bundle and no template, and not delegable.
    const [key] = await g.prisma.$queryRaw<Array<{ delegable: boolean; risk: string; bundles: number; templates: number }>>`
      SELECT p.delegable, p.risk,
             (SELECT count(*)::int FROM chat.legacy_permission_bundle b WHERE b.permission_key = p.key) AS bundles,
             (SELECT count(*)::int FROM chat.access_role_permission rp JOIN chat.access_role r ON r.id = rp.role_id
               WHERE rp.permission_key = p.key AND r.is_template) AS templates
        FROM chat.permission p WHERE p.key = 'moderation.child_safety'`;
    expect(key).toEqual({ delegable: false, risk: 'pii', bundles: 0, templates: 0 });
  });

  it('no department: the Super Admin only', async () => {
    for (const subject of [m.teachersManager.subject, m.operationsManager.subject, m.salesManager.subject, OFFICER]) {
      expect(notFound(await (await as(subject)).get(`/moderation/reports/${noDepartment}`))).toEqual(NOT_FOUND);
    }
  });

  it('§4: the attachment link -- 5 minutes, for this staff member, audited, no object key; served after delete-for-everyone; refused out of scope', async () => {
    const teachers = await as(m.teachersManager.subject);
    const detail = await teachers.get(`/moderation/reports/${teachersReport}`);
    expect(detail.json.evidence.attachments).toEqual([{ index: 0, kind: 'image', mime: 'image/png', name: 'photo.png', size: 4 }]);
    expect(detail.text).not.toContain('conversations/');

    const before = Date.now();
    const minted = await teachers.post(`/moderation/reports/${teachersReport}/attachments/0/url`);
    expect(minted.status).toBe(200);
    expect(Object.keys(minted.json).sort()).toEqual(['expiresAt', 'url']);
    const expiresAt = Date.parse(minted.json.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 + 300_000 - 1_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 300_000 + 1_000);
    expect(minted.json.url).not.toContain('conversations');
    const url = new URL(minted.json.url, origin);
    expect(url.pathname).toBe(`/api/v1/media/report-evidence/${teachersReport}.0`);
    expect(url.searchParams.get('a')).toBe(m.teachersManager.id);
    expect(Number(url.searchParams.get('e')) * 1000).toBe(expiresAt);

    const audited = await g.prisma.auditLog.findMany({ where: { action: 'report.attachment_viewed', entityId: teachersReport } });
    expect(audited.map((a) => [a.actorId, a.after])).toEqual([[m.teachersManager.id, { index: 0 }]]);
    expect(JSON.stringify(audited.map((a) => [a.before, a.after, a.reason]))).not.toMatch(/conversations|photo\.png|A photo/);

    const bytes = await fetch(url);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await bytes.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    // The author deletes it for everyone: the evidence (and its file) stays for the reviewer.
    const message = (await g.prisma.contentReport.findUniqueOrThrow({ where: { id: teachersReport } })).messageId!;
    const group = groupOf(2);
    const deleted = await (await as(teacherOf(group.teacherIds[0]!).subject)).del(`/conversations/${group.conversationId}/messages/${message}`);
    expect(deleted.status).toBe(200);
    expect((await fetch(url)).status).toBe(200);
    const again = await teachers.post(`/moderation/reports/${teachersReport}/attachments/0/url`);
    expect((await fetch(new URL(again.json.url, origin))).status).toBe(200);
    // ...while the message's own media path refuses it, as before.
    const attachment = await g.prisma.messageAttachment.findFirstOrThrow({ where: { messageId: message } });
    const signer = new MediaUrlSigner();
    const ordinary = await fetch(new URL(signer.url('attachments', attachment.id, 'o', m.teachersManager.id, 300), origin));
    expect(ordinary.status).toBe(404);

    // An expired link, a link for someone out of scope, a forged one: refused.
    const expired = signer.url('report-evidence', `${teachersReport}.0`, 'o', m.teachersManager.id, 300, Date.now() - 10 * 60_000);
    expect((await fetch(new URL(expired, origin))).status).toBe(403);
    const outOfScope = signer.url('report-evidence', `${teachersReport}.0`, 'o', m.operationsManager.id, 300);
    expect((await fetch(new URL(outOfScope, origin))).status).toBe(404);
    const forged = new URL(minted.json.url, origin);
    forged.searchParams.set('a', m.operationsManager.id);
    expect((await fetch(forged)).status).toBe(403);
    // No such index.
    for (const index of ['1', '-1', 'x', '00']) {
      const r = await teachers.post(`/moderation/reports/${teachersReport}/attachments/${index}/url`);
      expect({ index, status: r.status, code: r.code }).toEqual({ index, status: 404, code: CommErrorCode.REPORT_ATTACHMENT_NOT_FOUND });
    }
    // A person report has no attachments.
    const none = await (await as(m.operationsManager.subject)).post(`/moderation/reports/${opsReport}/attachments/0/url`);
    expect({ status: none.status, code: none.code }).toEqual({ status: 404, code: CommErrorCode.REPORT_ATTACHMENT_NOT_FOUND });
    expect(await g.prisma.auditLog.count({ where: { action: 'report.attachment_viewed', entityId: teachersReport } })).toBe(2);
  });

  it('the attachment link is refused in a support session', async () => {
    const owner = await as(m.superAdmin.subject);
    const opened = await owner.post('/admin/impersonations', { accountId: await accountIdOf(family(5).parent.subject), reason: 'parent cannot see their report answer' });
    expect(opened.status).toBe(201);
    const r = await call(opened.json.accessToken as string, 'POST', `/moderation/reports/${teachersReport}/attachments/0/url`, {});
    expect({ status: r.status, code: r.code }).toEqual({ status: 403, code: CommErrorCode.SUPPORT_SESSION_FORBIDDEN });
    await owner.post(`/admin/impersonations/${opened.json.session.id}/end`);
  });
});

// ---------------------------------------------------------------------------
// §4: what the resolutions do
// ---------------------------------------------------------------------------

describe('§4: what warned and reassigned do; the note they need', () => {
  it('a note is required for reassigned and account_suspended (400 COMMON.VALIDATION); nothing changes', async () => {
    const group = groupOf(6);
    const messageId = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Note required.');
    const filed = await (await as(family(6).parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'spam' });
    const manager = await as(m.teachersManager.subject);
    for (const body of [
      { resolution: 'reassigned', answer: 'Handed on.' },
      { resolution: 'reassigned', answer: 'Handed on.', note: ' ' },
      { resolution: 'account_suspended', answer: 'Suspended.' },
    ]) {
      const r = await manager.post(`/moderation/reports/${filed.json.id}/resolve`, body);
      expect({ body, status: r.status, code: r.code }).toEqual({ body, status: 400, code: CommErrorCode.VALIDATION });
    }
    expect(await g.prisma.contentReport.findUniqueOrThrow({ where: { id: filed.json.id } })).toMatchObject({ status: 'open', resolution: null });
  });

  it('warned: the subject gets the conduct_warning notification; nothing in it names the report, the reporter or the message', async () => {
    const group = groupOf(7);
    const teacher = teacherOf(group.teacherIds[0]!);
    const messageId = await post(group.conversationId, 'teacher', teacher.id, 'Rude words in the group.');
    const parent = family(7).parent;
    const filed = await (await as(parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'harassment', note: 'Please stop this.' });
    const reportId = filed.json.id as string;
    const done = await (await as(m.teachersManager.subject)).post(`/moderation/reports/${reportId}/resolve`, {
      resolution: 'warned',
      note: 'Reminded of the rules.',
      answer: 'Thank you. We reminded them of our rules.',
    });
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ status: 'actioned', resolution: 'warned', subject: { kind: 'teacher', id: teacher.id, name: teacher.name } });

    const warned = await g.prisma.auditLog.findMany({ where: { action: 'report.subject_warned', entityId: reportId } });
    expect(warned).toHaveLength(1);
    expect(warned[0]!.actorId).toBe(m.teachersManager.id);
    const warningId = (warned[0]!.after as { warningId: string }).warningId;
    const events = (await g.prisma.outboxEvent.findMany({ where: { type: 'moderation.conduct_warning' } })).filter(
      (e) => (e.payload as { recipientId?: string }).recipientId === teacher.id,
    );
    expect(events.map((e) => e.payload)).toEqual([{ organizationId: orgId, warningId, recipientKind: 'teacher', recipientId: teacher.id }]);

    await app.get(OutboxWorker).drain(500);
    const items = await g.prisma.notificationItem.findMany({ where: { recipientId: teacher.id, eventType: 'conduct_warning' } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ templateKey: 'inbox.conduct_warning', category: 'system', organizationId: orgId });
    const deliveries = await g.prisma.notification.findMany({ where: { recipientId: teacher.id, eventType: 'conduct_warning' } });
    const marks = [reportId, messageId, group.conversationId, parent.id, parent.name, 'Rude words', 'Please stop', 'Reminded of'];
    const text = JSON.stringify({ items, deliveries });
    for (const mark of marks) expect(text).not.toContain(mark);
    // The texts themselves: fixed, bilingual, and about the Code of Conduct only.
    const templates = await g.prisma.notificationTemplate.findMany({ where: { key: { in: ['conduct_warning', 'inbox.conduct_warning'] } } });
    expect(templates.map((t) => `${t.key}:${t.locale}`).sort()).toEqual(['conduct_warning:ar', 'conduct_warning:en', 'inbox.conduct_warning:ar', 'inbox.conduct_warning:en']);
    for (const t of templates) {
      expect(`${t.title} ${t.body}`).not.toMatch(/report|بلاغ|\{/i);
    }
    // Once per warning, however often the worker runs.
    await app.get(OutboxWorker).drain(500);
    expect(await g.prisma.notificationItem.count({ where: { recipientId: teacher.id, eventType: 'conduct_warning' } })).toBe(1);
    // The reporter is answered as for every resolution.
    expect((await g.prisma.outboxEvent.findMany({ where: { type: 'report.answered' } })).some((e) => (e.payload as { reportId?: string }).reportId === reportId)).toBe(true);
  });

  it('reassigned: a PD-47 report_reassignment task for the managers of the report\'s departments, linked to it, carrying the note', async () => {
    const teacher = teacherOf(groupOf(8).teacherIds[0]!);
    const filed = await (await as(teacher.subject)).post('/reports', { targetKind: 'person', subject: { kind: 'contact', id: family(8).parent.id }, reason: 'harassment' });
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id: filed.json.id } })).departmentIds).toEqual([m.departments.operations]);
    const done = await (await as(m.operationsManager.subject)).post(`/moderation/reports/${filed.json.id}/resolve`, {
      resolution: 'reassigned',
      note: 'The family needs another supervisor.',
      answer: 'Thank you. We are changing who looks after this family.',
    });
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ status: 'actioned', resolution: 'reassigned', resolutionNote: 'The family needs another supervisor.' });

    const tasks = await g.prisma.$queryRaw<Array<{ assignee: string; source_type: string; state: string; report_id: string; note: string | null }>>`
      SELECT t.assignee_staff_id::text AS assignee, t.source_type, t.state, q.report_id::text AS report_id, r.resolution_note AS note
        FROM chat.work_task t
        JOIN chat.report_reassignment_task q ON q.id = t.source_id
        JOIN chat.content_report r ON r.id = q.report_id
       WHERE t.source_type = 'report_reassignment' AND q.report_id = ${filed.json.id}::uuid`;
    expect(tasks).toEqual([
      { assignee: m.operationsManager.id, source_type: 'report_reassignment', state: 'open', report_id: filed.json.id, note: 'The family needs another supervisor.' },
    ]);
    const raised = await g.prisma.auditLog.findMany({ where: { action: 'report.reassignment_raised', entityId: filed.json.id } });
    expect(raised.map((a) => a.after)).toEqual([{ tasks: 1 }]);

    // The task is the manager's to read in Tasks, linked to the report, with the note.
    const list = await (await as(m.operationsManager.subject)).get('/me/tasks');
    expect(list.status).toBe(200);
    expect(list.text).toContain('task.report_reassignment');
    expect(list.text).toContain(filed.json.id);
    expect(list.text).toContain('The family needs another supervisor.');
    // Never the reporter.
    expect(list.text).not.toContain(teacher.id);
    expect(list.text).not.toContain(teacher.name);
  });

  it('reassigned: no department, or child_safety: the Super Admin', async () => {
    const teacherId = groupOf(9).teacherIds[0]!;
    const noDepartment = await historicReport({ subjectKind: 'teacher', subjectId: teacherId, reason: 'spam', departmentIds: [], reporterIndex: 9 });
    const messageId = await post(groupOf(9).conversationId, 'teacher', teacherId, 'Child safety reassign.');
    const cs = (await (await as(family(9).parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'child_safety' })).json.id as string;
    const owner = await as(m.superAdmin.subject);
    for (const id of [noDepartment, cs]) {
      const r = await owner.post(`/moderation/reports/${id}/resolve`, { resolution: 'reassigned', note: 'Hand this on.', answer: 'Thank you.' });
      expect(r.status).toBe(200);
      const tasks = await g.prisma.$queryRaw<Array<{ assignee: string }>>`
        SELECT t.assignee_staff_id::text AS assignee FROM chat.work_task t
          JOIN chat.report_reassignment_task q ON q.id = t.source_id
         WHERE t.source_type = 'report_reassignment' AND q.report_id = ${id}::uuid`;
      expect(tasks).toEqual([{ assignee: m.superAdmin.id }]);
    }
  });

  it('the source table is insert-only and no request role reaches it', async () => {
    await expect(g.prisma.$executeRawUnsafe(`update chat.report_reassignment_task set created_at = now()`)).rejects.toThrow(/never changed or deleted/);
    const [row] = await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text FROM chat.report_reassignment_task LIMIT 1`;
    await expect(g.prisma.$executeRaw`DELETE FROM chat.report_reassignment_task WHERE id = ${row!.id}::uuid`).rejects.toThrow(/never changed or deleted/);
    for (const role of ['chat_app', 'authenticated', 'anon']) {
      const r = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_table_privilege('${role}', 'chat.report_reassignment_task', 'SELECT') as ok`);
      expect({ role, ok: r[0]!.ok }).toEqual({ role, ok: false });
    }
  });
});

// ---------------------------------------------------------------------------
// The clients' contracts
// ---------------------------------------------------------------------------

describe('the exact JSON the clients parse', () => {
  it('Flutter #464: POST /reports 201/200 {id, status, dueAt}; GET /me/reports [{id, targetKind, reason, status, createdAt, answer?: {text, at}}]', async () => {
    const group = groupOf(10);
    const messageId = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Contract.');
    const parent = await as(family(10).parent.subject);
    const created = await parent.post('/reports', { targetKind: 'message', messageId, reason: 'spam' }, { 'X-Idempotency-Key': `pd57-${randomUUID()}` });
    expect(created.status).toBe(201);
    expect(created.json).toEqual({ id: expect.any(String), status: 'open', dueAt: expect.any(String) });
    expect(new Date(created.json.dueAt).toISOString()).toBe(created.json.dueAt);
    const again = await parent.post('/reports', { targetKind: 'message', messageId, reason: 'spam' });
    expect(again.status).toBe(200);
    expect(again.json).toEqual(created.json);

    await (await as(m.teachersManager.subject)).post(`/moderation/reports/${created.json.id}/resolve`, { resolution: 'no_action', answer: 'Looked into it.' });
    const person = await parent.post('/reports', { targetKind: 'person', subject: { kind: 'teacher', id: group.teacherIds[0] }, reason: 'other', note: 'Contract.' });
    const mine = await parent.get('/me/reports');
    expect(mine.status).toBe(200);
    expect(Array.isArray(mine.json)).toBe(true);
    const byId = new Map((mine.json as Array<Record<string, unknown>>).map((r) => [r.id as string, r]));
    expect(byId.get(created.json.id)).toEqual({
      id: created.json.id,
      targetKind: 'message',
      reason: 'spam',
      status: 'dismissed',
      createdAt: expect.any(String),
      answer: { text: 'Looked into it.', at: expect.any(String) },
    });
    expect(byId.get(person.json.id)).toEqual({ id: person.json.id, targetKind: 'person', reason: 'other', status: 'open', createdAt: expect.any(String) });
  });

  it('Flutter #464: the error codes it maps come back exactly', async () => {
    const group = groupOf(11);
    const parent = await as(family(11).parent.subject);
    const outsider = await post(groupOf(12).conversationId, 'teacher', groupOf(12).teacherIds[0]!, 'Not for family 11.');
    const own = await post(group.conversationId, 'contact', family(11).parent.id, 'My own.');
    const system = await post(group.conversationId, 'system', null, 'Lesson moved.', { type: 'system' });
    const fine = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Fine.');
    const cases: Array<[unknown, number, string]> = [
      [{ targetKind: 'message', messageId: outsider, reason: 'spam' }, 404, 'COMM.REPORT_TARGET_NOT_VISIBLE'],
      [{ targetKind: 'message', messageId: own, reason: 'spam' }, 400, 'COMM.REPORT_SELF'],
      [{ targetKind: 'message', messageId: system, reason: 'spam' }, 400, 'COMM.REPORT_NOT_REPORTABLE'],
      [{ targetKind: 'message', messageId: fine, reason: 'other' }, 400, 'COMM.REPORT_NOTE_REQUIRED'],
    ];
    for (const [body, status, code] of cases) {
      const r = await parent.post('/reports', body);
      expect({ body, status: r.status, code: r.code, message: typeof r.json.error?.message }).toEqual({ body, status, code, message: 'string' });
    }
    await g.prisma.$executeRawUnsafe(`update chat.config set value = '0'::jsonb where key = 'report.limit.per_reporter_hour'`);
    try {
      const limited = await parent.post('/reports', { targetKind: 'message', messageId: fine, reason: 'spam' });
      expect({ status: limited.status, code: limited.code }).toEqual({ status: 429, code: 'COMMON.RATE_LIMITED' });
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      await g.prisma.$executeRawUnsafe(`update chat.config set value = '10'::jsonb where key = 'report.limit.per_reporter_hour'`);
    }
  });

  it('Admin Web #461: queue rows, the detail (subject, canAct, attachments), take, resolve -- and never the reporter', async () => {
    const group = groupOf(13);
    const teacher = teacherOf(group.teacherIds[0]!);
    const key = `conversations/${group.conversationId}/${randomUUID()}.png`;
    await new LocalFsBlobStore().put(key, 'image/png', Buffer.from([1, 2, 3, 4]));
    const messageId = await post(group.conversationId, 'teacher', teacher.id, 'Admin contract.', { attachment: { objectKey: key, name: 'shot.png' } });
    const reporter = family(13).parent;
    const filed = await (await as(reporter.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'inappropriate', note: 'Admin contract note.' });
    const manager = await as(m.teachersManager.subject);

    const list = await manager.get('/moderation/reports');
    expect(Array.isArray(list.json)).toBe(true);
    const row = (list.json as Array<Record<string, any>>).find((r) => r.id === filed.json.id)!;
    expect(row).toEqual({
      id: filed.json.id,
      targetKind: 'message',
      reason: 'inappropriate',
      priority: 'normal',
      status: 'open',
      createdAt: expect.any(String),
      dueAt: expect.any(String),
      overdueAt: null,
      takenBy: null,
      takenByName: null,
      reporterAnsweredAt: null,
      subject: { kind: 'teacher', id: teacher.id, name: teacher.name },
    });
    expect(Date.parse(row.dueAt) - Date.parse(row.createdAt)).toBe(24 * HOUR);

    const detail = await manager.get(`/moderation/reports/${filed.json.id}`);
    expect(detail.json).toMatchObject({
      ...row,
      canAct: true,
      note: 'Admin contract note.',
      evidence: {
        body: 'Admin contract.',
        attachments: [{ index: 0, kind: 'image', mime: 'image/png', name: 'shot.png', size: 4 }],
        author: { name: teacher.name },
        sentAt: expect.any(String),
        deletedAt: null,
      },
      resolution: null,
      resolutionNote: null,
      resolvedAt: null,
      answerText: null,
    });
    expect(Object.keys(detail.json.evidence.attachments[0]).sort()).toEqual(['index', 'kind', 'mime', 'name', 'size']);
    expect(typeof detail.json.canAct).toBe('boolean');
    const url = await manager.post(`/moderation/reports/${filed.json.id}/attachments/0/url`);
    expect({ status: url.status, keys: Object.keys(url.json).sort() }).toEqual({ status: 200, keys: ['expiresAt', 'url'] });

    const taken = await manager.post(`/moderation/reports/${filed.json.id}/take`, undefined, { 'Idempotency-Key': `pd57-${randomUUID()}` });
    expect(taken.json).toMatchObject({ id: filed.json.id, status: 'in_review', takenBy: m.teachersManager.id, subject: { kind: 'teacher', id: teacher.id } });
    const resolved = await manager.post(
      `/moderation/reports/${filed.json.id}/resolve`,
      { resolution: 'no_action', answer: 'Nothing against the rules.' },
      { 'Idempotency-Key': `pd57-${randomUUID()}` },
    );
    expect(resolved.json).toMatchObject({ status: 'dismissed', resolution: 'no_action', answerText: 'Nothing against the rules.', resolvedAt: expect.any(String) });

    // Never the reporter, anywhere a reviewer reads.
    const marks = [reporter.id, reporter.name, reporter.subject, await accountIdOf(reporter.subject)];
    for (const r of [list, detail, url, taken, resolved]) {
      for (const mark of marks) expect(r.text).not.toContain(mark);
      expect(r.text).not.toMatch(/reporter(Id|Kind|AccountId)|conversationId|objectKey/);
    }
  });
});
