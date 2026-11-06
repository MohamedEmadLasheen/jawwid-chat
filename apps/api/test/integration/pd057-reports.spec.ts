/**
 * PD-57 WP-1 (ENG-02): the Report API over real HTTP -- real logins, the global
 * bearer and permission guards, the support-session interceptor, the real
 * routes and the database rules of 20261104100000.
 *
 * Roadmap 2026-11-03 §5.4 (the frozen contract), §5.5 (security and privacy)
 * and §5.6 (the tests), with the PM's ENG-02 brief:
 *
 *   1. a parent reports a teacher's message in the Student Group: 201; the
 *      teacher sees no trace; the event carries no content
 *   2. not from a conversation they are not in, nor their own message, nor a
 *      system message; a person only with a shared conversation; never the
 *      official account, a manager or the Super Admin
 *   3. a duplicate returns the open report (200); a child_safety duplicate
 *      raises it to child_safety / urgent
 *   4. the 11th report in an hour is 429 (counted from chat.content_report)
 *   5. staff without moderation.view get 403; with it they see the evidence even
 *      after the author deleted the message; the view is audited; no staff
 *      response names the reporter
 *   6. the queue: urgent first, then by dueAt; status, priority and overdue
 *   7. take and resolve: conflicts, closed, idempotent replays
 *   8. resolving with message_removed deletes the message for everyone, with an
 *      audit row naming the report; GET /me/reports shows the answer and no reviewer
 *   9. a support session can neither file nor resolve
 *  10. after the reporter's erasure the report is kept, anonymous
 *  11. staff of another organization reach nothing
 *
 * The Super Admin push, the 18 h / 24 h sweep and report_answered are ENG-04's.
 * The scope (closure plan 2026-11-06 §3), the attachments and the resolution
 * effects are pd057-moderation-scope.spec.ts.
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
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { AccountAdminModule } from '../../src/account-admin/account-admin.module';
import { ModerationModule } from '../../src/moderation/moderation.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd57-reports-spec-password-1';
const DOMAIN = 'pd57rep.qa.jawwid.test';
const OTHER_DOMAIN = 'pd57rep-b.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
let otherOrgId: string;
const otherOwnerSubject = `owner@${OTHER_DOMAIN}`;

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
async function post(conversationId: string, authorType: string, authorId: string | null, body: string | null, type = 'text', at?: Date) {
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
        ...(at ? { createdAt: at } : {}),
      },
    });
    return message.id;
  });
}

const family = (i: number) => m.families[i]!;
const groupOf = (i: number) => family(i).groups[0]!;
const accountIdOf = async (subject: string) =>
  (await g.prisma.account.findUniqueOrThrow({ where: { subject }, select: { id: true } })).id;

/** Audit rows as text (their id is a bigint, which JSON.stringify refuses). */
const auditText = (rows: Array<{ actorId: string | null; before: unknown; after: unknown; reason: string }>) =>
  JSON.stringify(rows.map((r) => ({ actorId: r.actorId, before: r.before, after: r.after, reason: r.reason })));

async function members(conversationId: string) {
  return g.prisma.conversationMember.findMany({ where: { conversationId, leftAt: null }, select: { actorId: true, actorKind: true } });
}

/** Every identifying string of a reporter: none may appear in a staff response. */
async function reporterMarks(i: number): Promise<string[]> {
  const p = family(i).parent;
  return [p.id, p.name, p.subject, await accountIdOf(p.subject)];
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  // By organization as well: an erased account's subject is no longer its e-mail.
  await g.prisma.$executeRawUnsafe(
    `delete from chat.account where subject like '%@${DOMAIN}' or subject like '%@${OTHER_DOMAIN}'
        or organization_id in (select id from chat.organization where slug like 'pd57r-%')`,
  );
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd57r-%'`);

  orgId = randomUUID();
  otherOrgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values
       ('${orgId}'::uuid, 'pd57r-${orgId.slice(0, 8)}', 'PD-57 reports QA academy'),
       ('${otherOrgId}'::uuid, 'pd57r-${otherOrgId.slice(0, 8)}', 'PD-57 reports QA academy B')`,
  );
  const hash = await hashPassword(PASSWORD);
  for (const [org, subject, name] of [
    [orgId, `owner@${DOMAIN}`, 'QA Organization Owner'],
    [otherOrgId, otherOwnerSubject, 'QA Other Owner'],
  ] as const) {
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
      const account = await tx.account.create({ data: { organizationId: org, subject, kind: 'staff', status: 'active', isActive: true } });
      await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: hash } });
      await tx.staff.create({ data: { organizationId: org, name, role: 'super_admin', isActive: true, accountId: account.id } });
    });
  }
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
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  // By organization as well: an erased account's subject is no longer its e-mail.
  await g.prisma.$executeRawUnsafe(
    `delete from chat.account where subject like '%@${DOMAIN}' or subject like '%@${OTHER_DOMAIN}'
        or organization_id in (select id from chat.organization where slug like 'pd57r-%')`,
  );
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd57r-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('every route is behind the bearer guard', () => {
  it('401 without a session', async () => {
    for (const [method, path] of [
      ['POST', '/reports'],
      ['GET', '/me/reports'],
      ['GET', '/moderation/reports'],
      ['GET', `/moderation/reports/${randomUUID()}`],
      ['POST', `/moderation/reports/${randomUUID()}/take`],
      ['POST', `/moderation/reports/${randomUUID()}/resolve`],
    ] as const) {
      expect((await call(null, method, path, {})).status).toBe(401);
    }
  });
});

describe('§5.6-1: a parent reports a teacher message in the Student Group', () => {
  it('201 {id, status, dueAt} 24 h out (owner D-1); evidence snapshot; the teacher sees no trace; the event carries no content', async () => {
    const group = groupOf(0);
    const teacherId = group.teacherIds[0]!;
    const teacher = m.teachers.find((t) => t.id === teacherId)!;
    expect((await members(group.conversationId)).map((x) => x.actorId)).toEqual(expect.arrayContaining([family(0).parent.id, teacherId]));
    const messageId = await post(group.conversationId, 'teacher', teacherId, 'An unkind remark about the homework.');

    const parent = await as(family(0).parent.subject);
    const r = await parent.post('/reports', { targetKind: 'message', messageId, reason: 'harassment', note: 'Said twice this week.' });
    expect(r.status).toBe(201);
    expect(Object.keys(r.json).sort()).toEqual(['dueAt', 'id', 'status']);
    expect(r.json.status).toBe('open');

    const row = await g.prisma.contentReport.findUniqueOrThrow({ where: { id: r.json.id } });
    expect(new Date(r.json.dueAt).getTime() - row.createdAt.getTime()).toBe(24 * 3_600_000);
    expect(row).toMatchObject({
      organizationId: orgId,
      reporterKind: 'contact',
      reporterId: family(0).parent.id,
      targetKind: 'message',
      messageId,
      conversationId: group.conversationId, // derived, never sent
      subjectKind: 'teacher',
      subjectId: teacherId,
      reason: 'harassment',
      note: 'Said twice this week.',
      priority: 'normal',
      status: 'open',
    });
    expect(row.evidence).toMatchObject({ body: 'An unkind remark about the homework.', author: { kind: 'teacher', id: teacherId, name: teacher.name } });

    // The teacher: no report of theirs, and the message they read is unchanged.
    const asTeacher = await as(teacher.subject);
    expect((await asTeacher.get('/me/reports')).json).toEqual([]);
    const page = await asTeacher.get(`/conversations/${group.conversationId}/messages`);
    expect(page.status).toBe(200);
    const seen = (page.json.messages as Array<Record<string, unknown>>).find((x) => x.id === messageId)!;
    expect(seen).toBeDefined();
    expect(JSON.stringify(seen)).not.toMatch(/report/i);

    // The event: ids and priority only -- never the conversation (which would reach its room) or content.
    const events = await g.prisma.outboxEvent.findMany({ where: { type: 'report.created' } });
    const mine = events.filter((e) => (e.payload as { reportId?: string }).reportId === r.json.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.payload).toEqual({ organizationId: orgId, reportId: r.json.id, priority: 'normal', change: 'created' });

    // The audit trail names the report, never its words or its reporter.
    const filed = await g.prisma.auditLog.findMany({ where: { action: 'report.filed', entityId: r.json.id } });
    expect(filed).toHaveLength(1);
    expect(filed[0]!.actorId).toBeNull();
    const trail = auditText(filed);
    for (const mark of [...(await reporterMarks(0)), 'unkind', 'Said twice']) expect(trail).not.toContain(mark);
  });

  it('a person, from their profile: needs a shared conversation; a teacher reports a parent', async () => {
    const group = groupOf(1);
    const teacherId = group.teacherIds[0]!;
    const teacher = m.teachers.find((t) => t.id === teacherId)!;
    const r = await (await as(teacher.subject)).post('/reports', {
      targetKind: 'person',
      subject: { kind: 'contact', id: family(1).parent.id },
      reason: 'spam',
    });
    expect(r.status).toBe(201);
    const row = await g.prisma.contentReport.findUniqueOrThrow({ where: { id: r.json.id } });
    expect(row).toMatchObject({ reporterKind: 'teacher', targetKind: 'person', messageId: null, subjectKind: 'contact', subjectId: family(1).parent.id });
    expect(row.conversationId).not.toBeNull();
    expect(row.evidence).toMatchObject({ author: { kind: 'contact', id: family(1).parent.id, name: family(1).parent.name } });
  });
});

describe('§5.6-2 and §5.5-5: what may not be reported (404 never confirms a target exists)', () => {
  it('a message in a conversation the reporter is not in, or no such message: 404 COMM.REPORT_TARGET_NOT_VISIBLE', async () => {
    const group = groupOf(2);
    const messageId = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Only for family 2.');
    const outsider = await as(family(3).parent.subject);
    for (const id of [messageId, randomUUID(), 'not-a-uuid']) {
      const r = await outsider.post('/reports', { targetKind: 'message', messageId: id, reason: 'spam' });
      expect({ status: r.status, code: r.code }).toEqual({ status: 404, code: CommErrorCode.REPORT_TARGET_NOT_VISIBLE });
    }
    // Deleted for everyone, or deleted for the reporter: no longer readable now.
    const parent = await as(family(2).parent.subject);
    await g.prisma.message.update({ where: { id: messageId }, data: { deletedForAll: true, deletedAt: new Date() } });
    const gone = await parent.post('/reports', { targetKind: 'message', messageId, reason: 'spam' });
    expect({ status: gone.status, code: gone.code }).toEqual({ status: 404, code: CommErrorCode.REPORT_TARGET_NOT_VISIBLE });
    const hidden = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Hidden for me.');
    await g.prisma.messageHiddenFor.create({ data: { messageId: hidden, actorId: family(2).parent.id } });
    const forMe = await parent.post('/reports', { targetKind: 'message', messageId: hidden, reason: 'spam' });
    expect({ status: forMe.status, code: forMe.code }).toEqual({ status: 404, code: CommErrorCode.REPORT_TARGET_NOT_VISIBLE });
    expect(await g.prisma.contentReport.count({ where: { reporterId: { in: [family(3).parent.id, family(2).parent.id] } } })).toBe(0);
  });

  it('their own message, oneself, a system message: 400', async () => {
    const group = groupOf(2);
    const parent = await as(family(2).parent.subject);
    const own = await post(group.conversationId, 'contact', family(2).parent.id, 'My own words.');
    const self = await parent.post('/reports', { targetKind: 'message', messageId: own, reason: 'spam' });
    expect({ status: self.status, code: self.code }).toEqual({ status: 400, code: CommErrorCode.REPORT_SELF });
    const me = await parent.post('/reports', { targetKind: 'person', subject: { kind: 'contact', id: family(2).parent.id }, reason: 'spam' });
    expect({ status: me.status, code: me.code }).toEqual({ status: 400, code: CommErrorCode.REPORT_SELF });
    const system = await post(group.conversationId, 'system', null, 'The lesson was moved.', 'system');
    const sys = await parent.post('/reports', { targetKind: 'message', messageId: system, reason: 'spam' });
    expect({ status: sys.status, code: sys.code }).toEqual({ status: 400, code: CommErrorCode.REPORT_NOT_REPORTABLE });
  });

  it('a person with no shared conversation: 404; the official account, a manager, the Super Admin: 400 COMM.REPORT_NOT_REPORTABLE', async () => {
    const parent = await as(family(4).parent.subject);
    const stranger = await parent.post('/reports', { targetKind: 'person', subject: { kind: 'contact', id: family(5).parent.id }, reason: 'spam' });
    expect({ status: stranger.status, code: stranger.code }).toEqual({ status: 404, code: CommErrorCode.REPORT_TARGET_NOT_VISIBLE });
    const unknown = await parent.post('/reports', { targetKind: 'person', subject: { kind: 'teacher', id: randomUUID() }, reason: 'spam' });
    expect({ status: unknown.status, code: unknown.code }).toEqual({ status: 404, code: CommErrorCode.REPORT_TARGET_NOT_VISIBLE });

    // The manager and the Super Admin sit in this family's group: still never reportable.
    const group = groupOf(4);
    const superAdminId = m.superAdmin.id;
    await g.prisma.conversationMember.createMany({
      data: [
        { conversationId: group.conversationId, actorKind: 'staff', actorId: m.operationsManager.id, memberRole: 'admin' },
        { conversationId: group.conversationId, actorKind: 'staff', actorId: superAdminId, memberRole: 'admin' },
      ],
    });
    for (const id of [m.operationsManager.id, superAdminId]) {
      const person = await parent.post('/reports', { targetKind: 'person', subject: { kind: 'staff', id }, reason: 'harassment' });
      expect({ status: person.status, code: person.code }).toEqual({ status: 400, code: CommErrorCode.REPORT_NOT_REPORTABLE });
      const said = await post(group.conversationId, 'staff', id, 'An administrative notice.');
      const message = await parent.post('/reports', { targetKind: 'message', messageId: said, reason: 'harassment' });
      expect({ status: message.status, code: message.code }).toEqual({ status: 400, code: CommErrorCode.REPORT_NOT_REPORTABLE });
    }
    const official = await parent.post('/reports', { targetKind: 'person', subject: { kind: 'system', id: '00000000-0000-0000-0000-000000000000' }, reason: 'spam' });
    expect({ status: official.status, code: official.code }).toEqual({ status: 400, code: CommErrorCode.REPORT_NOT_REPORTABLE });
    // A supervisor in the same group is reportable.
    const supervisor = await parent.post('/reports', { targetKind: 'person', subject: { kind: 'staff', id: group.supervisorId }, reason: 'other', note: 'Rude on the phone.' });
    expect(supervisor.status).toBe(201);
  });

  it('the body: reasons, the note (required for other, <= 500, empty is omitted), the target shape', async () => {
    const group = groupOf(5);
    const messageId = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Body for validation.');
    const parent = await as(family(5).parent.subject);
    const cases: Array<[unknown, number, string]> = [
      [{ targetKind: 'message', messageId, reason: 'other' }, 400, CommErrorCode.REPORT_NOTE_REQUIRED],
      [{ targetKind: 'message', messageId, reason: 'other', note: '   ' }, 400, CommErrorCode.REPORT_NOTE_REQUIRED],
      [{ targetKind: 'message', messageId, reason: 'harassment', note: 'x'.repeat(501) }, 400, CommErrorCode.VALIDATION],
      [{ targetKind: 'message', messageId, reason: 'blocked' }, 400, CommErrorCode.VALIDATION],
      [{ targetKind: 'message', messageId, reason: 'rude' }, 400, CommErrorCode.VALIDATION],
      [{ targetKind: 'message', reason: 'spam' }, 400, CommErrorCode.VALIDATION],
      [{ targetKind: 'message', messageId, subject: { kind: 'teacher', id: group.teacherIds[0] }, reason: 'spam' }, 400, CommErrorCode.VALIDATION],
      [{ targetKind: 'person', reason: 'spam' }, 400, CommErrorCode.VALIDATION],
      [{ targetKind: 'story', reason: 'spam' }, 400, CommErrorCode.VALIDATION],
      [{ targetKind: 'message', messageId, conversationId: group.conversationId, reason: 'spam' }, 400, CommErrorCode.VALIDATION],
    ];
    for (const [body, status, code] of cases) {
      const r = await parent.post('/reports', body);
      expect({ body, status: r.status, code: r.code }).toEqual({ body, status, code });
    }
    // An empty note on another reason is no note.
    const ok = await parent.post('/reports', { targetKind: 'message', messageId, reason: 'spam', note: '' });
    expect(ok.status).toBe(201);
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id: ok.json.id } })).note).toBeNull();
  });
});

describe('§5.6-3: a duplicate returns the open report', () => {
  it('200 with the same {id, status, dueAt}; a child_safety duplicate raises it to child_safety / urgent', async () => {
    const group = groupOf(6);
    const messageId = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Something worrying.');
    const parent = await as(family(6).parent.subject);
    const first = await parent.post('/reports', { targetKind: 'message', messageId, reason: 'inappropriate' });
    expect(first.status).toBe(201);
    const again = await parent.post('/reports', { targetKind: 'message', messageId, reason: 'spam' });
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id: first.json.id } })).reason).toBe('inappropriate');

    const raised = await parent.post('/reports', { targetKind: 'message', messageId, reason: 'child_safety' });
    expect(raised.status).toBe(200);
    expect(raised.json.id).toBe(first.json.id);
    const row = await g.prisma.contentReport.findUniqueOrThrow({ where: { id: first.json.id } });
    expect(row).toMatchObject({ reason: 'child_safety', priority: 'urgent', status: 'open' });
    expect(await g.prisma.contentReport.count({ where: { reporterId: family(6).parent.id } })).toBe(1);
    // ENG-04's Super Admin alert has its signal, still without content.
    const events = (await g.prisma.outboxEvent.findMany({ where: { type: 'report.created' } })).filter(
      (e) => (e.payload as { reportId?: string }).reportId === first.json.id,
    );
    expect(events.map((e) => e.payload)).toEqual([
      { organizationId: orgId, reportId: first.json.id, priority: 'normal', change: 'created' },
      { organizationId: orgId, reportId: first.json.id, priority: 'urgent', change: 'raised' },
    ]);
    expect(await g.prisma.auditLog.count({ where: { action: 'report.raised', entityId: first.json.id } })).toBe(1);
    // Raised once: a second child_safety duplicate changes nothing.
    expect((await parent.post('/reports', { targetKind: 'message', messageId, reason: 'child_safety' })).status).toBe(200);
    expect(await g.prisma.auditLog.count({ where: { action: 'report.raised', entityId: first.json.id } })).toBe(1);
  });

  it('Idempotency-Key: a replay answers the first response; the key on another body is 409', async () => {
    const group = groupOf(7);
    const [a, b] = [
      await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Replay target A.'),
      await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Replay target B.'),
    ];
    const parent = await as(family(7).parent.subject);
    const key = { 'Idempotency-Key': `pd57-${randomUUID()}` };
    const first = await parent.post('/reports', { targetKind: 'message', messageId: a, reason: 'spam' }, key);
    expect(first.status).toBe(201);
    const replay = await parent.post('/reports', { targetKind: 'message', messageId: a, reason: 'spam' }, key);
    expect({ status: replay.status, json: replay.json }).toEqual({ status: 201, json: first.json });
    // The Flutter app's header name too.
    const xReplay = await parent.post('/reports', { targetKind: 'message', messageId: a, reason: 'spam' }, { 'X-Idempotency-Key': key['Idempotency-Key'] });
    expect({ status: xReplay.status, json: xReplay.json }).toEqual({ status: 201, json: first.json });
    const reused = await parent.post('/reports', { targetKind: 'message', messageId: b, reason: 'spam' }, key);
    expect({ status: reused.status, code: reused.code }).toEqual({ status: 409, code: CommErrorCode.REPORT_KEY_REUSED });
    expect(await g.prisma.contentReport.count({ where: { reporterId: family(7).parent.id } })).toBe(1);
  });
});

describe('§5.6-4: 10 reports per reporter per rolling hour (report.limit.per_reporter_hour)', () => {
  it('the 11th is 429 COMMON.RATE_LIMITED with Retry-After; a duplicate of an open one still answers 200', async () => {
    const group = groupOf(8);
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push(await post(group.conversationId, 'teacher', group.teacherIds[0]!, `Message ${i}.`));
    const parent = await as(family(8).parent.subject);
    for (let i = 0; i < 10; i++) {
      expect((await parent.post('/reports', { targetKind: 'message', messageId: ids[i], reason: 'spam' })).status).toBe(201);
    }
    const eleventh = await parent.post('/reports', { targetKind: 'message', messageId: ids[10], reason: 'spam' });
    expect({ status: eleventh.status, code: eleventh.code }).toEqual({ status: 429, code: 'COMMON.RATE_LIMITED' });
    const retryAfter = Number(eleventh.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect((await parent.post('/reports', { targetKind: 'message', messageId: ids[0], reason: 'spam' })).status).toBe(200);
    expect(await g.prisma.contentReport.count({ where: { reporterId: family(8).parent.id } })).toBe(10);
  });

  it('the limit is configuration', async () => {
    const group = groupOf(9);
    const [a, b] = [
      await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Config A.'),
      await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Config B.'),
    ];
    await g.prisma.$executeRawUnsafe(`update chat.config set value = '1'::jsonb where key = 'report.limit.per_reporter_hour'`);
    try {
      const parent = await as(family(9).parent.subject);
      expect((await parent.post('/reports', { targetKind: 'message', messageId: a, reason: 'spam' })).status).toBe(201);
      expect((await parent.post('/reports', { targetKind: 'message', messageId: b, reason: 'spam' })).status).toBe(429);
    } finally {
      await g.prisma.$executeRawUnsafe(`update chat.config set value = '10'::jsonb where key = 'report.limit.per_reporter_hour'`);
    }
  });
});

describe('§5.6-5 and §5.5-3: the staff queue and the evidence', () => {
  let reportId: string;
  let messageId: string;

  beforeAll(async () => {
    const group = groupOf(10);
    const teacherId = group.teacherIds[0]!;
    messageId = await post(group.conversationId, 'teacher', teacherId, 'Evidence that will be deleted.');
    const r = await (await as(family(10).parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'inappropriate', note: 'Please look.' });
    expect(r.status).toBe(201);
    reportId = r.json.id;
    // The author deletes it for everyone afterwards.
    const del = await (await as(m.teachers.find((t) => t.id === teacherId)!.subject)).del(`/conversations/${group.conversationId}/messages/${messageId}`);
    expect(del.status).toBe(200);
  });

  it('403 without moderation.view (a supervisor, a parent, a teacher), before anything is read', async () => {
    for (const subject of [m.supervisors[0]!.subject, family(10).parent.subject, m.teachers[0]!.subject]) {
      const who = await as(subject);
      for (const r of [await who.get('/moderation/reports'), await who.get(`/moderation/reports/${reportId}`)]) {
        expect({ subject, status: r.status, code: r.code }).toEqual({ subject, status: 403, code: CommErrorCode.PERMISSION_DENIED });
      }
      for (const r of [
        await who.post(`/moderation/reports/${reportId}/take`),
        await who.post(`/moderation/reports/${reportId}/resolve`, { resolution: 'no_action', answer: 'x' }),
      ]) {
        expect({ subject, status: r.status, code: r.code }).toEqual({ subject, status: 403, code: CommErrorCode.PERMISSION_DENIED });
      }
    }
    expect(await g.prisma.auditLog.count({ where: { action: 'report.viewed' } })).toBe(0);
  });

  it('with it: the evidence of a deleted message, audited as report.viewed; no reporter identity anywhere', async () => {
    // A teacher's message: the Teachers department's report (closure plan §3).
    const manager = await as(m.teachersManager.subject);
    const detail = await manager.get(`/moderation/reports/${reportId}`);
    expect(detail.status).toBe(200);
    expect(detail.json).toMatchObject({
      id: reportId,
      targetKind: 'message',
      reason: 'inappropriate',
      priority: 'normal',
      status: 'open',
      note: 'Please look.',
      resolution: null,
      resolutionNote: null,
      resolvedAt: null,
      answerText: null,
      takenBy: null,
      reporterAnsweredAt: null,
      overdueAt: null,
      evidence: { body: 'Evidence that will be deleted.', attachments: [], author: { name: expect.any(String) } },
    });
    expect(detail.json.evidence.deletedAt).toEqual(expect.any(String));
    expect(detail.json.evidence.sentAt).toEqual(expect.any(String));
    const views = await g.prisma.auditLog.findMany({ where: { action: 'report.viewed', entityId: reportId } });
    expect(views.map((v) => v.actorId)).toEqual([m.teachersManager.id]);
    expect(auditText(views)).not.toContain('Evidence that');

    const list = await manager.get('/moderation/reports');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.json)).toBe(true);
    const row = (list.json as Array<Record<string, unknown>>).find((x) => x.id === reportId)!;
    expect(Object.keys(row).sort()).toEqual(
      ['createdAt', 'dueAt', 'id', 'overdueAt', 'priority', 'reason', 'reporterAnsweredAt', 'status', 'subject', 'takenBy', 'takenByName', 'targetKind'].sort(),
    );
    for (const text of [detail.text, list.text]) {
      for (const mark of await reporterMarks(10)) expect(text).not.toContain(mark);
      expect(text).not.toMatch(/reporter(Id|Kind|AccountId)|conversationId/);
    }
    // Reading the list is not a view of anyone's evidence.
    expect(await g.prisma.auditLog.count({ where: { action: 'report.viewed', entityId: reportId } })).toBe(1);
  });

  it('the Super Admin and every department manager hold both keys; a Teachers supervisor does not', async () => {
    for (const subject of [m.superAdmin.subject, m.teachersManager.subject, m.salesManager.subject]) {
      expect({ subject, status: (await (await as(subject)).get('/moderation/reports')).status }).toEqual({ subject, status: 200 });
    }
    const r = await (await as(m.teacherSupervisors[0]!.subject)).get('/moderation/reports');
    expect(r.status).toBe(403);
  });
});

describe('§5.6-6 and the queue: urgent first, then by dueAt; filters', () => {
  it('orders and filters; overdue from fixed instants; bad filters are 400', async () => {
    // Two reports written with fixed past instants (triggers off, as history),
    // so "overdue" never depends on the time the suite runs.
    const reporter = family(11).parent.id;
    const reporterAccount = await accountIdOf(family(11).parent.subject);
    const group = groupOf(11);
    const subjectTeacher = group.teacherIds[0]!;
    const overdueId = randomUUID();
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(
        `insert into chat.content_report (id, organization_id, reporter_kind, reporter_id, reporter_account_id, target_kind, conversation_id,
                                          subject_kind, subject_id, reason, priority, status, created_at, due_at, overdue_at)
         values ($1::uuid, $2::uuid, 'contact', $3::uuid, $4::uuid, 'person', $5::uuid, 'teacher', $6::uuid, 'spam', 'normal', 'open',
                 '2026-01-05T10:00:00Z', '2026-01-06T10:00:00Z', '2026-01-06T10:05:00Z')`,
        overdueId,
        orgId,
        reporter,
        reporterAccount,
        group.conversationId,
        subjectTeacher,
      );
    });
    const urgentMessage = await post(group.conversationId, 'teacher', subjectTeacher, 'Urgent target.');
    const urgent = await (await as(family(11).parent.subject)).post('/reports', { targetKind: 'message', messageId: urgentMessage, reason: 'child_safety' });
    expect(urgent.status).toBe(201);
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id: urgent.json.id } })).priority).toBe('urgent');

    const owner = await as(m.superAdmin.subject);
    const all = (await owner.get('/moderation/reports')).json as Array<{ id: string; priority: string; status: string; dueAt: string }>;
    expect(all[0]!.priority).toBe('urgent');
    const open = all.filter((r) => r.status === 'open' || r.status === 'in_review');
    const firstNormal = open.findIndex((r) => r.priority === 'normal');
    expect(open.slice(0, firstNormal).every((r) => r.priority === 'urgent')).toBe(true);
    const normals = open.slice(firstNormal).map((r) => Date.parse(r.dueAt));
    expect(normals).toEqual([...normals].sort((a, b) => a - b));
    expect(open.slice(firstNormal).every((r) => r.priority === 'normal')).toBe(true);
    expect(open[firstNormal]!.id).toBe(overdueId); // the oldest dueAt of the normals

    const urgentOnly = (await owner.get('/moderation/reports?priority=urgent')).json as Array<{ priority: string }>;
    expect(urgentOnly.length).toBeGreaterThan(0);
    expect(urgentOnly.every((r) => r.priority === 'urgent')).toBe(true);
    const overdue = (await owner.get('/moderation/reports?overdue=true')).json as Array<{ id: string; overdueAt: string | null }>;
    expect(overdue.map((r) => r.id)).toEqual([overdueId]);
    expect(overdue[0]!.overdueAt).toBe('2026-01-06T10:05:00.000Z');
    const notOverdue = (await owner.get('/moderation/reports?overdue=false')).json as Array<{ id: string }>;
    expect(notOverdue.map((r) => r.id)).not.toContain(overdueId);
    const statusOpen = (await owner.get('/moderation/reports?status=open')).json as Array<{ status: string }>;
    expect(statusOpen.every((r) => r.status === 'open')).toBe(true);

    for (const q of ['status=closed', 'priority=high', 'overdue=yes']) {
      const r = await owner.get(`/moderation/reports?${q}`);
      expect({ q, status: r.status, code: r.code }).toEqual({ q, status: 400, code: CommErrorCode.VALIDATION });
    }
  });
});

describe('§5.6-7/8: take and resolve', () => {
  it('take: 200 in_review; again by the taker 200; by another 409 REPORT_ALREADY_TAKEN; closed 409 REPORT_CLOSED', async () => {
    const group = groupOf(12);
    const messageId = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Take me.');
    const filed = await (await as(family(12).parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'spam' });
    // A teacher's message: the Teachers manager's and the Super Admin's (closure plan §3).
    const ops = await as(m.teachersManager.subject);
    const sales = await as(m.superAdmin.subject);

    const taken = await ops.post(`/moderation/reports/${filed.json.id}/take`);
    expect(taken.status).toBe(200);
    expect(taken.json).toMatchObject({ id: filed.json.id, status: 'in_review', takenBy: m.teachersManager.id, takenByName: m.teachersManager.name });
    expect((await ops.post(`/moderation/reports/${filed.json.id}/take`)).status).toBe(200);
    const conflict = await sales.post(`/moderation/reports/${filed.json.id}/take`);
    expect({ status: conflict.status, code: conflict.code }).toEqual({ status: 409, code: CommErrorCode.REPORT_ALREADY_TAKEN });
    expect(await g.prisma.auditLog.count({ where: { action: 'report.taken', entityId: filed.json.id } })).toBe(1);

    const resolved = await ops.post(`/moderation/reports/${filed.json.id}/resolve`, { resolution: 'no_action', answer: 'We looked and found nothing against the rules.' });
    expect(resolved.status).toBe(200);
    expect(resolved.json).toMatchObject({ status: 'dismissed', resolution: 'no_action' });
    const late = await sales.post(`/moderation/reports/${filed.json.id}/take`);
    expect({ status: late.status, code: late.code }).toEqual({ status: 409, code: CommErrorCode.REPORT_CLOSED });
  });

  it('resolve: answer required (<= 1000), resolution known, note <= 2000; closed is 409 unless it is the same request replayed', async () => {
    const group = groupOf(13);
    const messageId = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Resolve me.');
    const filed = await (await as(family(13).parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'harassment' });
    const id = filed.json.id as string;
    const owner = await as(m.superAdmin.subject);
    for (const body of [
      { resolution: 'warned' },
      { resolution: 'warned', answer: '   ' },
      { resolution: 'warned', answer: 'x'.repeat(1001) },
      { resolution: 'banned', answer: 'ok' },
      { resolution: 'warned', answer: 'ok', note: 'x'.repeat(2001) },
      // Closure plan §4: a note is required for these two.
      { resolution: 'reassigned', answer: 'ok' },
      { resolution: 'account_suspended', answer: 'ok', note: '  ' },
    ]) {
      const r = await owner.post(`/moderation/reports/${id}/resolve`, body);
      expect({ body, status: r.status, code: r.code }).toEqual({ body, status: 400, code: CommErrorCode.VALIDATION });
    }
    // A person report cannot have its message removed.
    const person = await (await as(family(13).parent.subject)).post('/reports', {
      targetKind: 'person',
      subject: { kind: 'teacher', id: group.teacherIds[0] },
      reason: 'harassment',
    });
    const wrong = await owner.post(`/moderation/reports/${person.json.id}/resolve`, { resolution: 'message_removed', answer: 'Removed.' });
    expect({ status: wrong.status, code: wrong.code }).toEqual({ status: 400, code: CommErrorCode.VALIDATION });

    // An untaken report may be resolved directly; the resolver is recorded as its taker.
    const key = { 'Idempotency-Key': `pd57-${randomUUID()}` };
    const body = { resolution: 'warned', note: 'Spoke to the teacher.', answer: 'Thank you. We have spoken to the teacher.' };
    const first = await owner.post(`/moderation/reports/${id}/resolve`, body, key);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ status: 'actioned', resolution: 'warned', resolutionNote: 'Spoke to the teacher.', answerText: body.answer, takenBy: m.superAdmin.id });
    const replay = await owner.post(`/moderation/reports/${id}/resolve`, body, key);
    expect({ status: replay.status, json: replay.json }).toEqual({ status: 200, json: first.json });
    const again = await owner.post(`/moderation/reports/${id}/resolve`, body);
    expect({ status: again.status, code: again.code }).toEqual({ status: 409, code: CommErrorCode.REPORT_CLOSED });
    const resolvedRows = await g.prisma.auditLog.findMany({ where: { action: 'report.resolved', entityId: id } });
    expect(resolvedRows).toHaveLength(1);
    expect(auditText(resolvedRows)).not.toMatch(/Spoke to|Thank you/);
    // ENG-04's report_answered has its signal: ids only.
    const answered = (await g.prisma.outboxEvent.findMany({ where: { type: 'report.answered' } })).filter(
      (e) => (e.payload as { reportId?: string }).reportId === id,
    );
    expect(answered.map((e) => e.payload)).toEqual([{ organizationId: orgId, reportId: id }]);
  });

  it('§5.6-8: message_removed deletes the message for everyone, audited with the report; the reporter reads the answer, never the reviewer', async () => {
    const group = groupOf(14);
    const teacherId = group.teacherIds[0]!;
    const messageId = await post(group.conversationId, 'teacher', teacherId, 'To be removed.');
    const parent = await as(family(14).parent.subject);
    const filed = await parent.post('/reports', { targetKind: 'message', messageId, reason: 'inappropriate' });
    const manager = await as(m.teachersManager.subject);
    expect((await manager.post(`/moderation/reports/${filed.json.id}/take`)).status).toBe(200);
    const done = await manager.post(`/moderation/reports/${filed.json.id}/resolve`, {
      resolution: 'message_removed',
      answer: 'The message was removed. Thank you for telling us.',
    });
    expect(done.status).toBe(200);

    const message = await g.prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(message).toMatchObject({ deletedForAll: true, deletedBy: m.teachersManager.id });
    const deletion = await g.prisma.auditLog.findMany({ where: { action: 'message.delete_for_everyone', entityId: messageId } });
    expect(deletion).toHaveLength(1);
    expect(deletion[0]!.actorId).toBe(m.teachersManager.id);
    expect(deletion[0]!.after).toMatchObject({ reportId: filed.json.id });
    expect(deletion[0]!.reason).toContain(filed.json.id);
    // The ordinary moderated deletion event: the room learns a message went, nothing of why.
    const deleted = (await g.prisma.outboxEvent.findMany({ where: { type: 'message.deleted' } })).filter(
      (e) => (e.payload as { messageId?: string }).messageId === messageId,
    );
    expect(deleted.map((e) => e.payload)).toEqual([{ conversationId: group.conversationId, messageId, deletedForAll: true }]);

    const mine = await parent.get('/me/reports');
    expect(mine.status).toBe(200);
    expect(Array.isArray(mine.json)).toBe(true);
    const row = (mine.json as Array<Record<string, any>>).find((r) => r.id === filed.json.id)!;
    expect(row).toEqual({
      id: filed.json.id,
      targetKind: 'message',
      reason: 'inappropriate',
      status: 'actioned',
      createdAt: expect.any(String),
      answer: { text: 'The message was removed. Thank you for telling us.', at: expect.any(String) },
    });
    expect(mine.text).not.toContain(m.teachersManager.id);
    expect(mine.text).not.toContain(m.teachersManager.name);
    expect(mine.text).not.toMatch(/evidence|resolvedBy|takenBy|To be removed/);
    // An unanswered report has no answer key at all.
    const other = await parent.post('/reports', { targetKind: 'person', subject: { kind: 'teacher', id: teacherId }, reason: 'spam' });
    const listed = ((await parent.get('/me/reports')).json as Array<Record<string, unknown>>).find((r) => r.id === other.json.id)!;
    expect(Object.keys(listed).sort()).toEqual(['createdAt', 'id', 'reason', 'status', 'targetKind']);
    // Another parent sees none of it.
    expect(((await (await as(family(15).parent.subject)).get('/me/reports')).json as unknown[]).length).toBe(0);
  });
});

describe('§5.6-9 and §5.5-4: a support session can neither file nor resolve', () => {
  it('403 COMM.SUPPORT_SESSION_FORBIDDEN on POST /reports and on resolve', async () => {
    const group = groupOf(16);
    const messageId = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Support session target.');
    const owner = await as(m.superAdmin.subject);
    const opened = await owner.post('/admin/impersonations', { accountId: await accountIdOf(family(16).parent.subject), reason: 'parent cannot find the report button' });
    expect(opened.status).toBe(201);
    const support = opened.json.accessToken as string;
    const file = await call(support, 'POST', '/reports', { targetKind: 'message', messageId, reason: 'spam' });
    expect({ status: file.status, code: file.code }).toEqual({ status: 403, code: CommErrorCode.SUPPORT_SESSION_FORBIDDEN });
    const resolve = await call(support, 'POST', `/moderation/reports/${randomUUID()}/resolve`, { resolution: 'no_action', answer: 'x' });
    expect({ status: resolve.status, code: resolve.code }).toEqual({ status: 403, code: CommErrorCode.SUPPORT_SESSION_FORBIDDEN });
    const take = await call(support, 'POST', `/moderation/reports/${randomUUID()}/take`);
    expect({ status: take.status, code: take.code }).toEqual({ status: 403, code: CommErrorCode.SUPPORT_SESSION_FORBIDDEN });
    expect(await g.prisma.contentReport.count({ where: { reporterId: family(16).parent.id } })).toBe(0);
    await owner.post(`/admin/impersonations/${opened.json.session.id}/end`);
  });
});

describe('§5.6-10: after the reporter erases their account, the report is kept and anonymous', () => {
  it('kept, reporter gone, still in the queue with its evidence', async () => {
    const group = groupOf(17);
    const messageId = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Kept after erasure.');
    const filed = await (await as(family(17).parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'spam' });
    await g.prisma.$queryRawUnsafe(`select chat.erase_account($1::uuid, 'pd57 reports spec')::text`, await accountIdOf(family(17).parent.subject));
    const row = await g.prisma.contentReport.findUniqueOrThrow({ where: { id: filed.json.id } });
    expect(row).toMatchObject({ reporterId: null, reporterAccountId: null, reporterKind: 'contact', status: 'open' });
    const detail = await (await as(m.superAdmin.subject)).get(`/moderation/reports/${filed.json.id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.evidence.body).toBe('Kept after erasure.');
    // It can still be answered and closed; there is just nobody to read the answer.
    const closed = await (await as(m.superAdmin.subject)).post(`/moderation/reports/${filed.json.id}/resolve`, { resolution: 'no_action', answer: 'Closed.' });
    expect(closed.status).toBe(200);
  });
});

describe('§5.5: staff of another organization reach nothing', () => {
  it('the other academy\'s Super Admin: an empty queue, and 404 on the detail, take and resolve', async () => {
    const group = groupOf(18);
    const messageId = await post(group.conversationId, 'teacher', group.teacherIds[0]!, 'Org A only.');
    const filed = await (await as(family(18).parent.subject)).post('/reports', { targetKind: 'message', messageId, reason: 'spam' });
    const other = await as(otherOwnerSubject);
    const list = await other.get('/moderation/reports');
    expect({ status: list.status, json: list.json }).toEqual({ status: 200, json: [] });
    for (const r of [
      await other.get(`/moderation/reports/${filed.json.id}`),
      await other.post(`/moderation/reports/${filed.json.id}/take`),
      await other.post(`/moderation/reports/${filed.json.id}/resolve`, { resolution: 'no_action', answer: 'x' }),
      await other.get(`/moderation/reports/not-a-uuid`),
    ]) {
      expect({ status: r.status, code: r.code }).toEqual({ status: 404, code: CommErrorCode.REPORT_NOT_FOUND });
    }
    const row = await g.prisma.contentReport.findUniqueOrThrow({ where: { id: filed.json.id } });
    expect(row).toMatchObject({ status: 'open', takenBy: null });
    expect(await g.prisma.auditLog.count({ where: { action: 'report.viewed', entityId: filed.json.id } })).toBe(0);
  });
});
