/**
 * PD-57 WP-2 (ENG-03): Block -- the API and its SERVER-SIDE enforcement (owner
 * D-5: never only the UI), over real HTTP with real logins, the global bearer
 * and permission guards, the support-session interceptor and the database
 * rules of 20261104100000.
 *
 * Spec of record: closure plan 2026-11-06 §5 (the contract, the five
 * educational exceptions D-6) and §6 (abuse and bypass); roadmap 2026-11-03
 * §6.1-§6.4. Roadmap §6.4 items 1-9, plus the abuse and bypass rules:
 *
 *   1. a parent blocks their supervisor: hidden for the parent only (direct and
 *      group), others still see it, cards and system messages stay; a case
 *      opens; every responsible manager told once, across departments, a
 *      manager over two supervisors once; re-blocking while the case is open
 *      tells nobody again
 *   2. no push / Center entry for the blocker; a non-lesson call does not ring
 *   3. the lesson call still rings; lesson reminders and cards still delivered
 *   4. the blocked supervisor cannot open a direct conversation with the parent
 *      (COMM.DIRECT_BLOCKED); covering staff are delivered
 *   5. staff cannot block; nobody blocks the official account, a manager, the
 *      Super Admin or themselves
 *   6. the blocked person is the manager: every Super Admin is told instead
 *   7. unblocking restores the history at once
 *   8. erasure removes blocks both ways
 *   9. RLS denies chat_app
 *   + 21st block in 24 h -> 429; a support session is refused; a blocked
 *     author's attachment is 404 for the blocker; the chat list preview hides
 *     the body; search does not match hidden messages; GET /me/blocks shape.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { hashPassword } from '@platform/auth/password';
import { CommErrorCode } from '@platform/errors';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { MessageService } from '@communication/messages/message.service';
import { NotificationPipeline } from '@communication/notifications/notification-pipeline.service';
import { messageAudience } from '@communication/outbox/message-audience';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { AccountAdminModule } from '../../src/account-admin/account-admin.module';
import { ModerationModule } from '../../src/moderation/moderation.module';
import { BlocksService } from '../../src/moderation/blocks.service';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd57-blocks-spec-password-1';
const DOMAIN = 'pd57blk.qa.jawwid.test';
const MINUTE = 60_000;

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

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

type Reply = { status: number; code?: string; json: any; text: string };
async function call(token: string | null, method: string, path: string, body?: unknown): Promise<Reply> {
  const send = body !== undefined && method !== 'GET';
  const h: Record<string, string> = send ? { 'content-type': 'application/json' } : {};
  if (token) h.authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { method, headers: h, body: send ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { status: r.status, code: json?.error?.code, json, text };
}
const as = async (subject: string) => {
  const token = await login(subject);
  return {
    get: (path: string) => call(token, 'GET', path),
    post: (path: string, body?: unknown) => call(token, 'POST', path, body ?? {}),
    del: (path: string) => call(token, 'DELETE', path),
  };
};

/** A message written straight into a conversation (triggers off, as other specs write history). */
async function post(conversationId: string, authorType: string, authorId: string | null, body: string | null, type = 'text') {
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
        type,
        body,
        visibility: 'customer',
        seq,
        ...(authorType === 'staff' ? { onBehalfMode: 'owner' } : {}),
      },
    });
    return message.id;
  });
}

const family = (i: number) => m.families[i]!;
const groupOf = (i: number) => family(i).groups[0]!;
const teacherOf = (id: string) => m.teachers.find((t) => t.id === id)!;
const supervisorOf = (id: string) => [...m.supervisors, ...m.backups].find((s) => s.id === id)!;
const accountIdOf = async (subject: string) =>
  (await g.prisma.account.findUniqueOrThrow({ where: { subject }, select: { id: true } })).id;
const drain = async () => {
  for (let i = 0; i < 5; i++) if ((await app.get(OutboxWorker).drain(500)) === 0) return;
};
const messagesAs = async (subject: string, conversationId: string) => {
  const r = await (await as(subject)).get(`/conversations/${conversationId}/messages?limit=100`);
  expect(r.status).toBe(200);
  return r.json.messages as Array<Record<string, any>>;
};
const byId = (rows: Array<Record<string, any>>, id: string) => rows.find((x) => x.id === id)!;
const blockedNotices = (reportId: string) =>
  g.prisma.actorBlockManagerNotice.findMany({ where: { caseReportId: reportId }, select: { managerStaffId: true } });
const managerItems = (reportId: string) =>
  g.prisma.notificationItem.findMany({ where: { eventType: 'block_created_manager', subjectId: reportId }, select: { recipientId: true } });
async function block(subject: string, kind: string, id: string) {
  return (await as(subject)).post('/me/blocks', { subject: { kind, id } });
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(
    `delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug like 'pd57b-%')`,
  );
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd57b-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd57b-${orgId.slice(0, 8)}', 'PD-57 blocks QA academy')`,
  );
  const hash = await hashPassword(PASSWORD);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: hash } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: hash, messages: false });

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, AccountAdminModule, ModerationModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
  await drain();
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(
    `delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug like 'pd57b-%')`,
  );
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd57b-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('every route is behind the bearer guard', () => {
  it('401 without a session', async () => {
    for (const [method, path] of [
      ['POST', '/me/blocks'],
      ['GET', '/me/blocks'],
      ['DELETE', `/me/blocks/${randomUUID()}`],
    ] as const) {
      expect((await call(null, method, path, {})).status).toBe(401);
    }
  });
});

describe('§6.4-1 and §6.4-7: a parent blocks their supervisor', () => {
  it('hidden for the parent only, in the direct and the group; cards and system stay; the case; GET /me/blocks; unblock restores at once', async () => {
    const f = family(1);
    const group = groupOf(1);
    const supervisorId = group.supervisorId;
    const direct = f.directs.find((d) => d.supervisorId === supervisorId)!;
    const teacher = teacherOf(group.teacherIds[0]!);
    const inGroup = await post(group.conversationId, 'staff', supervisorId, 'Group words of the supervisor.');
    const card = await post(group.conversationId, 'staff', supervisorId, null, 'card');
    const system = await post(group.conversationId, 'system', null, JSON.stringify({ kind: 'group.created' }), 'system');
    const inDirect = await post(direct.conversationId, 'staff', supervisorId, 'Direct words of the supervisor.');

    const created = await block(f.parent.subject, 'staff', supervisorId);
    expect(created.status).toBe(201);
    expect(Object.keys(created.json).sort()).toEqual(['createdAt', 'id', 'subject']);
    expect(created.json.subject).toEqual({ kind: 'staff', id: supervisorId, name: supervisorOf(supervisorId).name });

    // The parent: a placeholder, nothing of the body, the attachments or the reactions.
    const parentGroup = await messagesAs(f.parent.subject, group.conversationId);
    expect(byId(parentGroup, inGroup)).toMatchObject({ hiddenByBlock: true, body: null, attachments: [], reactions: [], mentions: [] });
    expect(byId(parentGroup, card).hiddenByBlock).toBeUndefined();
    expect(byId(parentGroup, system).hiddenByBlock).toBeUndefined();
    expect(byId(parentGroup, system).systemEvent).toEqual({ kind: 'group.created' });
    expect(JSON.stringify(parentGroup)).not.toContain('Group words of the supervisor.');
    const parentDirect = await messagesAs(f.parent.subject, direct.conversationId);
    expect(byId(parentDirect, inDirect)).toMatchObject({ hiddenByBlock: true, body: null });
    // Members keep their actorKind (the app depends on it): the author is still named.
    expect(byId(parentDirect, inDirect)).toMatchObject({ authorKind: 'staff', authorId: supervisorId });

    // Everybody else still reads it.
    const teacherGroup = await messagesAs(teacher.subject, group.conversationId);
    expect(byId(teacherGroup, inGroup)).toMatchObject({ body: 'Group words of the supervisor.' });
    expect(byId(teacherGroup, inGroup).hiddenByBlock).toBeUndefined();

    // Search does not match a hidden message; the chat list preview has no body.
    const search = await (await as(f.parent.subject)).get(`/conversations/${group.conversationId}/messages/search?q=supervisor`);
    expect(search.status).toBe(200);
    expect(search.json.hits.map((h: { id: string }) => h.id)).not.toContain(inGroup);
    const list = await (await as(f.parent.subject)).get('/conversations');
    const row = (list.json.conversations ?? list.json).find((c: { id: string }) => c.id === direct.conversationId);
    expect(row.lastMessage).toMatchObject({ text: null, hiddenByBlock: true });
    expect(JSON.stringify(list.json)).not.toContain('Direct words of the supervisor.');

    // The case (§6.1 rule 4): a person report, reason blocked, by the parent, in the queues of both sides.
    const blockRow = await g.prisma.actorBlock.findUniqueOrThrow({ where: { id: created.json.id } });
    expect(blockRow).toMatchObject({ blockerKind: 'contact', blockerId: f.parent.id, blockedKind: 'staff', blockedId: supervisorId, blockerAccountId: await accountIdOf(f.parent.subject) });
    const report = await g.prisma.contentReport.findUniqueOrThrow({ where: { id: blockRow.caseReportId! } });
    expect(report).toMatchObject({ reason: 'blocked', targetKind: 'person', reporterKind: 'contact', reporterId: f.parent.id, subjectKind: 'staff', subjectId: supervisorId, status: 'open', priority: 'normal' });
    expect(report.departmentIds).toContain(m.departments.operations);
    // A NEW case is announced like any report (ENG-02's report.created, ids and priority only).
    const announced = await g.prisma.outboxEvent.findMany({ where: { type: 'report.created', payload: { path: ['reportId'], equals: report.id } } });
    expect(announced.map((e) => e.payload)).toEqual([{ organizationId: orgId, reportId: report.id, priority: 'normal', change: 'created' }]);
    const audit = await g.prisma.auditLog.findFirstOrThrow({ where: { action: 'block.created', entityId: blockRow.id } });
    expect(JSON.stringify(audit.after)).not.toMatch(/words/);

    // GET /me/blocks
    const mine = await (await as(f.parent.subject)).get('/me/blocks');
    expect(mine.status).toBe(200);
    expect(mine.json).toHaveLength(1);
    expect(mine.json[0]).toMatchObject({ id: blockRow.id, subject: { kind: 'staff', id: supervisorId, name: supervisorOf(supervisorId).name } });
    expect(Object.keys(mine.json[0]).sort()).toEqual(['createdAt', 'id', 'subject']);
    // Blocking again: 200 with the same block.
    const again = await block(f.parent.subject, 'staff', supervisorId);
    expect({ status: again.status, id: again.json.id }).toEqual({ status: 200, id: blockRow.id });
    // Someone else's block is not theirs to lift.
    expect((await (await as(family(2).parent.subject)).del(`/me/blocks/${blockRow.id}`)).status).toBe(404);

    // §6.4-7: unblocking restores the history at once.
    const removed = await (await as(f.parent.subject)).del(`/me/blocks/${blockRow.id}`);
    expect(removed.status).toBe(204);
    expect(byId(await messagesAs(f.parent.subject, group.conversationId), inGroup)).toMatchObject({ body: 'Group words of the supervisor.' });
    expect(byId(await messagesAs(f.parent.subject, direct.conversationId), inDirect)).toMatchObject({ body: 'Direct words of the supervisor.' });
    expect(byId(await messagesAs(f.parent.subject, direct.conversationId), inDirect).hiddenByBlock).toBeUndefined();
    expect((await (await as(f.parent.subject)).get('/me/blocks')).json).toEqual([]);
    expect(await g.prisma.auditLog.count({ where: { action: 'block.removed', entityId: blockRow.id } })).toBe(1);
    // The case stays.
    expect(await g.prisma.contentReport.count({ where: { id: report.id } })).toBe(1);
    expect((await (await as(f.parent.subject)).del(`/me/blocks/${blockRow.id}`)).status).toBe(404);
  });
});

describe('§6.4-1 / A-2a: the responsible managers', () => {
  it('a family over two departments tells both managers, a manager over two supervisors once; re-blocking while the case is open tells nobody again', async () => {
    const f = family(28);
    const supervisorIds = [...new Set(f.children.map((c) => c.supervisorId))];
    expect(supervisorIds.length).toBeGreaterThanOrEqual(3);
    const moved = supervisorIds[supervisorIds.length - 1]!;
    // One of the three supervisors works in Sales: two departments, and Operations over two supervisors.
    // A fixture shape (triggers off): the product moves a supervisor only once their learners are reassigned.
    const moveTo = (departmentId: string) =>
      g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
        await tx.departmentMember.update({ where: { staffId: moved }, data: { departmentId } });
      });
    await moveTo(m.departments.sales);
    try {
      const teacherId = groupOf(28).teacherIds[0]!;
      const r = await block(f.parent.subject, 'teacher', teacherId);
      expect(r.status).toBe(201);
      const row = await g.prisma.actorBlock.findUniqueOrThrow({ where: { id: r.json.id } });
      const told = (await blockedNotices(row.caseReportId!)).map((n) => n.managerStaffId).sort();
      expect(told).toEqual([m.operationsManager.id, m.salesManager.id].sort());
      await drain();
      expect((await managerItems(row.caseReportId!)).map((i) => i.recipientId).sort()).toEqual(told);
      // The case is in both managers' queues (D-3 + ENG-03: the blocker's side is added).
      const report = await g.prisma.contentReport.findUniqueOrThrow({ where: { id: row.caseReportId! } });
      expect(report.departmentIds).toEqual(expect.arrayContaining([m.departments.operations, m.departments.sales]));

      // Unblock and block again while the case is open: the same case, nobody told again.
      expect((await (await as(f.parent.subject)).del(`/me/blocks/${row.id}`)).status).toBe(204);
      const again = await block(f.parent.subject, 'teacher', teacherId);
      expect(again.status).toBe(201);
      const second = await g.prisma.actorBlock.findUniqueOrThrow({ where: { id: again.json.id } });
      expect(second.caseReportId).toBe(row.caseReportId);
      await drain();
      expect(await blockedNotices(row.caseReportId!)).toHaveLength(2);
      expect(await managerItems(row.caseReportId!)).toHaveLength(2);
      expect(await g.prisma.contentReport.count({ where: { reporterId: f.parent.id, reason: 'blocked' } })).toBe(1);
      // The re-block re-used the case: still one report.created for it.
      expect(await g.prisma.outboxEvent.count({ where: { type: 'report.created', payload: { path: ['reportId'], equals: row.caseReportId! } } })).toBe(1);
    } finally {
      await moveTo(m.departments.operations);
    }
  });

  it('an open report of the blocker about the person is re-used as the case', async () => {
    const f = family(27);
    const teacherId = groupOf(27).teacherIds[0]!;
    const filed = await (await as(f.parent.subject)).post('/reports', { targetKind: 'person', subject: { kind: 'teacher', id: teacherId }, reason: 'spam' });
    expect(filed.status).toBe(201);
    const r = await block(f.parent.subject, 'teacher', teacherId);
    expect(r.status).toBe(201);
    expect((await g.prisma.actorBlock.findUniqueOrThrow({ where: { id: r.json.id } })).caseReportId).toBe(filed.json.id);
    // Re-using an open report announces nothing more: only the report's own filing.
    expect(await g.prisma.outboxEvent.count({ where: { type: 'report.created', payload: { path: ['reportId'], equals: filed.json.id } } })).toBe(1);
  });

  it('a teacher who blocks a parent: the department manager of the teacher\'s supervisor is told', async () => {
    const group = groupOf(26);
    const teacher = teacherOf(group.teacherIds[0]!);
    const r = await block(teacher.subject, 'contact', family(26).parent.id);
    expect(r.status).toBe(201);
    const row = await g.prisma.actorBlock.findUniqueOrThrow({ where: { id: r.json.id } });
    expect(row).toMatchObject({ blockerKind: 'teacher', blockerId: teacher.id });
    expect((await blockedNotices(row.caseReportId!)).map((n) => n.managerStaffId)).toEqual([m.teachersManager.id]);
  });

  it('§6.4-6: a blocked person who is one of those managers is not told; every Super Admin is told instead (and with no manager at all)', async () => {
    const blocks = app.get(BlocksService);
    const parent = { kind: 'contact' as const, id: family(1).parent.id };
    const supers = (await g.prisma.staff.findMany({ where: { organizationId: orgId, role: 'super_admin', isActive: true }, select: { id: true } })).map((s) => s.id).sort();
    // The API refuses a manager as a target (§6.4-5); the rule is the resolver's, asked directly.
    expect((await blocks.responsibleManagers(g.prisma, parent, { kind: 'staff', id: m.operationsManager.id })).sort()).toEqual(supers);
    expect(await blocks.responsibleManagers(g.prisma, parent, { kind: 'teacher', id: groupOf(1).teacherIds[0]! })).toEqual([m.operationsManager.id]);
    // No department manager at all: every Super Admin.
    await g.prisma.department.update({ where: { id: m.departments.operations }, data: { managerId: null } });
    try {
      expect((await blocks.responsibleManagers(g.prisma, parent, { kind: 'teacher', id: groupOf(1).teacherIds[0]! })).sort()).toEqual(supers);
    } finally {
      await g.prisma.department.update({ where: { id: m.departments.operations }, data: { managerId: m.operationsManager.id } });
    }
  });
});

describe('§6.4-2: nothing from the blocked person reaches the blocker', () => {
  it('no push and no Center entry for the blocker; the other members are told', async () => {
    const f = family(3);
    const group = groupOf(3);
    const supervisor = supervisorOf(group.supervisorId);
    expect((await block(f.parent.subject, 'staff', supervisor.id)).status).toBe(201);
    await drain();
    const sent = await (await as(supervisor.subject)).post(`/conversations/${group.conversationId}/messages`, { body: 'Hello family', clientMessageId: randomUUID() });
    expect(sent.status).toBe(201);
    await drain();
    const forParent = await g.prisma.notification.count({ where: { recipientId: f.parent.id, conversationId: group.conversationId } });
    const itemsParent = await g.prisma.notificationItem.count({ where: { recipientId: f.parent.id, groupKey: `conversation:${group.conversationId}` } });
    expect({ forParent, itemsParent }).toEqual({ forParent: 0, itemsParent: 0 });
    const teacherId = group.teacherIds[0]!;
    expect(await g.prisma.notificationItem.count({ where: { recipientId: teacherId, groupKey: `conversation:${group.conversationId}` } })).toBe(1);
    // The audience rule itself: a card or system line of the same author still reaches the parent.
    expect(await messageAudience(g.prisma, group.conversationId, supervisor.id, { messageType: 'text' })).not.toContain(f.parent.id);
    expect(await messageAudience(g.prisma, group.conversationId, supervisor.id, { messageType: 'card' })).toContain(f.parent.id);
  });

  it('Notification Center: an entry authored by the blocked person is skipped, except the lesson, schedule and administrative kinds', async () => {
    const f = family(3);
    const supervisorId = groupOf(3).supervisorId;
    const pipeline = app.get(NotificationPipeline);
    const at = new Date();
    const mention = await pipeline.emit({ dedupeKey: `t-mention:${randomUUID()}`, ruleKey: 'mention', eventType: 'mention_created', templateKey: 'mention', recipientId: f.parent.id, author: supervisorId, scheduledAt: at });
    expect(mention).toBeNull();
    const reminder = await pipeline.emit({ dedupeKey: `t-lesson:${randomUUID()}`, ruleKey: 'lesson_parent_t24h', eventType: 'lesson_reminder', templateKey: 'lesson_reminder_tomorrow', recipientId: f.parent.id, author: supervisorId, scheduledAt: at });
    expect(reminder).not.toBeNull();
    const task = await pipeline.emit({ dedupeKey: `t-task:${randomUUID()}`, ruleKey: null, eventType: 'conduct_warning', templateKey: 'conduct_warning', recipientId: f.parent.id, author: supervisorId, scheduledAt: at });
    expect(task).not.toBeNull();
    // Not blocked: delivered.
    const other = await pipeline.emit({ dedupeKey: `t-mention2:${randomUUID()}`, ruleKey: 'mention', eventType: 'mention_created', templateKey: 'mention', recipientId: family(4).parent.id, author: supervisorId, scheduledAt: at });
    expect(other).not.toBeNull();
  });

  it('a blocked author\'s attachment is 404 for the blocker, served to everyone else', async () => {
    const f = family(9);
    const group = groupOf(9);
    const teacherId = group.teacherIds[0]!;
    const messageId = await post(group.conversationId, 'teacher', teacherId, null, 'image');
    const attachment = await g.prisma.messageAttachment.create({
      data: { messageId, kind: 'image', objectKey: `conversations/${group.conversationId}/${randomUUID()}.jpg`, mimeType: 'image/jpeg', byteSize: 10 },
    });
    const messages = app.get(MessageService);
    await expect(messages.authorizeAttachmentRead(attachment.id, f.parent.id, 'o')).resolves.toMatchObject({ objectKey: attachment.objectKey });
    expect((await block(f.parent.subject, 'teacher', teacherId)).status).toBe(201);
    await expect(messages.authorizeAttachmentRead(attachment.id, f.parent.id, 'o')).rejects.toMatchObject({ code: CommErrorCode.MESSAGE_NOT_FOUND, status: 404 });
    await expect(messages.authorizeAttachmentRead(attachment.id, group.supervisorId, 'o')).resolves.toMatchObject({ objectKey: attachment.objectKey });
    expect(byId(await messagesAs(f.parent.subject, group.conversationId), messageId)).toMatchObject({ hiddenByBlock: true, attachments: [] });
  });
});

describe('§6.4-2 and §6.4-3: calls', () => {
  it('a non-lesson call does not ring the blocker; a 1:1 answers the caller as unavailable; the lesson call still rings', async () => {
    const f = family(4);
    const group = groupOf(4);
    const teacher = teacherOf(group.teacherIds[0]!);
    const learnerId = group.learnerIds[0]!;
    expect((await block(f.parent.subject, 'teacher', teacher.id)).status).toBe(201);
    const asTeacher = await as(teacher.subject);

    // No lesson now: the group call rings the others, never the parent.
    const plain = await asTeacher.post('/calls', { conversationId: group.conversationId });
    expect(plain.status).toBe(201);
    const seated = (await g.prisma.callParticipant.findMany({ where: { callId: plain.json.callId }, select: { actorId: true } })).map((p) => p.actorId);
    expect(seated).toContain(group.supervisorId);
    expect(seated).not.toContain(f.parent.id);
    await drain();
    expect(await g.prisma.notification.count({ where: { recipientId: f.parent.id, eventType: { in: ['call_started', 'group_call_started'] } } })).toBe(0);
    expect((await asTeacher.post(`/calls/${plain.json.callId}/end`)).status).toBeLessThan(300);

    // A lesson of the family's child with this teacher, now: the lesson call rings the parent.
    await g.prisma.lesson.create({
      data: { organizationId: orgId, learnerId, teacherId: teacher.id, createdBy: m.superAdmin.id, startsAt: new Date(Date.now() - 5 * MINUTE), endsAt: new Date(Date.now() + 25 * MINUTE) },
    });
    const lessonCall = await asTeacher.post('/calls', { conversationId: group.conversationId });
    expect(lessonCall.status).toBe(201);
    const ringing = (await g.prisma.callParticipant.findMany({ where: { callId: lessonCall.json.callId }, select: { actorId: true } })).map((p) => p.actorId);
    expect(ringing).toContain(f.parent.id);
    expect((await asTeacher.post(`/calls/${lessonCall.json.callId}/end`)).status).toBeLessThan(300);
  });

  it('a 1:1 call to someone who blocked the caller: unavailable, and nobody is rung', async () => {
    const f = family(10);
    const direct = f.directs[0]!;
    const supervisor = supervisorOf(direct.supervisorId);
    expect((await block(f.parent.subject, 'staff', supervisor.id)).status).toBe(201);
    const r = await (await as(supervisor.subject)).post('/calls', { conversationId: direct.conversationId });
    expect({ status: r.status, code: r.code }).toEqual({ status: 409, code: CommErrorCode.CALL_UNAVAILABLE });
    expect(await g.prisma.call.count({ where: { conversationId: direct.conversationId } })).toBe(0);
  });
});

describe('§6.4-4: the blocked supervisor cannot open a direct conversation; covering staff are delivered', () => {
  it('COMM.DIRECT_BLOCKED for the blocked supervisor; the manager covering writes and is read', async () => {
    const f = family(5);
    const direct = f.directs[0]!;
    const supervisor = supervisorOf(direct.supervisorId);
    // Before the block the supervisor opens it.
    expect((await (await as(supervisor.subject)).post('/conversations/direct', { withActorId: f.parent.id })).status).toBeLessThan(300);
    expect((await block(f.parent.subject, 'staff', supervisor.id)).status).toBe(201);
    const refused = await (await as(supervisor.subject)).post('/conversations/direct', { withActorId: f.parent.id });
    expect({ status: refused.status, code: refused.code }).toEqual({ status: 403, code: CommErrorCode.DIRECT_BLOCKED });

    // The manager covering the family's direct conversation: delivered and read.
    const manager = await as(m.operationsManager.subject);
    const sent = await manager.post(`/conversations/${direct.conversationId}/messages`, { body: 'The academy, covering.', clientMessageId: randomUUID() });
    expect(sent.status).toBe(201);
    await drain();
    const row = byId(await messagesAs(f.parent.subject, direct.conversationId), sent.json.id);
    expect(row).toMatchObject({ body: 'The academy, covering.' });
    expect(row.hiddenByBlock).toBeUndefined();
    expect(await g.prisma.notificationItem.count({ where: { recipientId: f.parent.id, groupKey: `conversation:${direct.conversationId}` } })).toBe(1);
  });
});

describe('§6.4-5: who may not block, and whom nobody may block', () => {
  it('403 COMM.BLOCK_NOT_ALLOWED with a reason; 404 without a shared conversation; 400 on a bad body', async () => {
    const f = family(6);
    const notAllowed = async (r: Reply, reason: string) => {
      expect({ status: r.status, code: r.code, reason: r.json?.error?.detail?.reason }).toEqual({ status: 403, code: CommErrorCode.BLOCK_NOT_ALLOWED, reason });
    };
    const supervisor = supervisorOf(groupOf(6).supervisorId);
    await notAllowed(await block(supervisor.subject, 'contact', f.parent.id), 'staff_caller');
    await notAllowed(await block(m.operationsManager.subject, 'contact', f.parent.id), 'staff_caller');
    await notAllowed(await block(f.parent.subject, 'contact', f.parent.id), 'self');
    await notAllowed(await block(f.parent.subject, 'system', '00000000-0000-0000-0000-000000000000'), 'official_account');
    await notAllowed(await block(f.parent.subject, 'staff', m.operationsManager.id), 'manager');
    await notAllowed(await block(f.parent.subject, 'staff', m.superAdmin.id), 'super_admin');
    const teacher = teacherOf(groupOf(6).teacherIds[0]!);
    await notAllowed(await block(teacher.subject, 'staff', m.teachersManager.id), 'manager');

    const stranger = m.teachers.find((t) => !family(6).groups.some((gr) => gr.teacherIds.includes(t.id)))!;
    const none = await block(f.parent.subject, 'teacher', stranger.id);
    expect({ status: none.status, code: none.code }).toEqual({ status: 404, code: CommErrorCode.BLOCK_NO_SHARED_CONVERSATION });
    const unknown = await block(f.parent.subject, 'teacher', randomUUID());
    expect({ status: unknown.status, code: unknown.code }).toEqual({ status: 404, code: CommErrorCode.BLOCK_NO_SHARED_CONVERSATION });
    expect((await (await as(f.parent.subject)).post('/me/blocks', { subject: { kind: 'nobody', id: randomUUID() } })).status).toBe(400);
    expect((await (await as(f.parent.subject)).post('/me/blocks', {})).status).toBe(400);
    expect(await g.prisma.actorBlock.count({ where: { blockerId: f.parent.id } })).toBe(0);
    // Staff have no blocks to list.
    expect((await (await as(supervisor.subject)).get('/me/blocks')).json).toEqual([]);
  });
});

describe('§6: abuse limits and support sessions', () => {
  it('the 21st block in a rolling 24 hours is 429 COMMON.RATE_LIMITED, block/unblock cycles included', async () => {
    const f = family(8);
    const supervisorId = groupOf(8).supervisorId;
    const parent = await as(f.parent.subject);
    for (let i = 0; i < 20; i++) {
      const r = await parent.post('/me/blocks', { subject: { kind: 'staff', id: supervisorId } });
      expect(r.status).toBe(201);
      expect((await parent.del(`/me/blocks/${r.json.id}`)).status).toBe(204);
    }
    const r = await parent.post('/me/blocks', { subject: { kind: 'staff', id: supervisorId } });
    expect({ status: r.status, code: r.code }).toEqual({ status: 429, code: 'COMMON.RATE_LIMITED' });
    // Cycles never re-notify managers: one case, its managers once.
    const cases = await g.prisma.contentReport.findMany({ where: { reporterId: f.parent.id, reason: 'blocked' }, select: { id: true } });
    expect(cases).toHaveLength(1);
    expect(await blockedNotices(cases[0]!.id)).toHaveLength(1);
  });

  it('a support session can neither block nor unblock', async () => {
    const f = family(0);
    const owner = await as(m.superAdmin.subject);
    const opened = await owner.post('/admin/impersonations', { accountId: await accountIdOf(f.parent.subject), reason: 'parent asks about blocking' });
    expect(opened.status).toBe(201);
    const support = opened.json.accessToken as string;
    const r = await call(support, 'POST', '/me/blocks', { subject: { kind: 'staff', id: groupOf(0).supervisorId } });
    expect({ status: r.status, code: r.code }).toEqual({ status: 403, code: CommErrorCode.SUPPORT_SESSION_FORBIDDEN });
    const d = await call(support, 'DELETE', `/me/blocks/${randomUUID()}`);
    expect({ status: d.status, code: d.code }).toEqual({ status: 403, code: CommErrorCode.SUPPORT_SESSION_FORBIDDEN });
    expect(await g.prisma.actorBlock.count({ where: { blockerId: f.parent.id } })).toBe(0);
    await owner.post(`/admin/impersonations/${opened.json.session.id}/end`);
  });
});

describe('§6.4-8: erasure removes blocks in both directions', () => {
  it('the erased parent\'s blocks, made and received, are gone; the case stays', async () => {
    const f = family(7);
    const group = groupOf(7);
    const teacher = teacherOf(group.teacherIds[0]!);
    const made = await block(f.parent.subject, 'staff', group.supervisorId);
    const received = await block(teacher.subject, 'contact', f.parent.id);
    expect([made.status, received.status]).toEqual([201, 201]);
    await g.prisma.$queryRawUnsafe(`select chat.erase_account($1::uuid, 'pd57 blocks spec')::text`, await accountIdOf(f.parent.subject));
    expect(await g.prisma.actorBlock.count({ where: { id: { in: [made.json.id, received.json.id] } } })).toBe(0);
    expect(await g.prisma.actorBlockManagerNotice.count({ where: { blockId: null } })).toBeGreaterThanOrEqual(1);
  });
});

describe('§6.4-9: RLS denies chat_app', () => {
  it('chat_app reads no block and no notice', async () => {
    for (const table of ['chat.actor_block', 'chat.actor_block_manager_notice']) {
      await expect(
        g.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('set local role chat_app');
          await tx.$queryRawUnsafe(`select count(*) from ${table}`);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
