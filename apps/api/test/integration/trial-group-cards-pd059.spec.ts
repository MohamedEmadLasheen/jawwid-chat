/**
 * PD-59 / F7 (owner decision 2026-11-21): a Sales representative is NOT kept out of their teachers' trial
 * groups; instead they READ only the trial cards whose prospect is assigned to them. Real HTTP, real
 * database, the real card path (TrialGroupService.postCard), the real outbox worker. Synthetic data only.
 *
 * Staff: super admin, Sales manager, Sales representatives A and B, Operations, the Teachers department and
 * the teacher whose group it is. Reps A and B (and the manager) are seated in the group. Cards: a text, then
 * the trial cards of A's prospect, B's prospect and an UNOWNED prospect.
 *
 *   1. every read path: message list + pagination, pins, single-message routes, search (this chat and all),
 *      export rows, the chat list's preview and unread count, the unread route;
 *   2. fan-out: the realtime event and the Notification Center skip a representative who may not read;
 *   3. the others (manager, super admin, Operations, the teacher, Teachers department) read everything;
 *   4. the card follows the CURRENT owner: reassigning B's lead to A moves it.
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
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { MessageService } from '@communication/messages/message.service';
import { ConversationService } from '@communication/conversations/conversation.service';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { LessonModule } from '../../src/lessons/lesson.module';
import { SalesPipelineModule } from '../../src/sales-pipeline/sales-pipeline.module';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { CardKind } from '../../src/communication/contracts/vocab';
import { CommErrorCode } from '../../src/platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { PrismaService } from '../../src/platform/prisma.service';
import { salesRepScope, salesRepsAmong } from '../../src/lessons/sales-rep-scope';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd59-cards-spec-password-1';
const DOMAIN = 'pd59cards.qa.jawwid.test';

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
  const account = await g.prisma.account.create({
    data: { organizationId: orgId, subject, kind: 'staff', status: 'active', isActive: true },
  });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
  const s = await g.prisma.staff.create({ data: { organizationId: orgId, name, role, isActive: true, accountId: account.id } });
  if (sales) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, $2::uuid, $3::uuid, 'supervisor')`,
      s.id, orgId, m.departments.sales,
    );
  }
  who[key] = { id: s.id, subject };
}

/** What the realtime publisher was asked to deliver (the outbox worker's fan-out). */
const sent: Array<{ via: string; to: string[]; event: string; payload: any; except?: string[] }> = [];
const recording = {
  toUsers: async (ids: string[], event: string, payload: unknown) => void sent.push({ via: 'users', to: ids, event, payload }),
  toThread: async (id: string, event: string, payload: unknown) => void sent.push({ via: 'thread', to: [id], event, payload }),
  toThreadAudience: async (id: string, event: string, payload: unknown, audience: { exceptActors?: string[] }) =>
    void sent.push({ via: 'thread', to: [id], event, payload, except: audience.exceptActors }),
};

const NAME_A = 'Zebulon Alpha-Prospect';
const NAME_B = 'Quasar Bravo-Prospect';
const NAME_U = 'Nimbus Unowned-Prospect';
let prospectA: string;
let prospectB: string;
let prospectU: string;
let trialA: string;
let trialB: string;
let trialU: string;
let conv: string;
let textId: string;
let cardA: string;
let cardB: string;
let cardU: string;

async function rows(sql: string, ...args: unknown[]) {
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    await tx.$executeRawUnsafe(sql, ...args);
  });
}
let slot = 0;
async function trialFor(prospect: string, name: string, by: string): Promise<string> {
  const hours = String(24 * 3 + 2 * ++slot);
  const id = randomUUID();
  await rows(
    `insert into chat.lesson (id, organization_id, teacher_id, kind, starts_at, ends_at, created_by, created_by_kind, prospect_id)
     values ($1::uuid, $2::uuid, $3::uuid, 'trial', now() - ($6 || ' hours')::interval, now() - ($6 || ' hours')::interval + interval '30 minutes', $4::uuid, 'staff', $5::uuid)`,
    id, orgId, m.teachers[0].id, by, prospect, hours);
  void name;
  return id;
}
/** Post a card through the real path and return its message id. */
async function postTrialCard(trialId: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const groups = app.get(TrialGroupService, { strict: false });
  const startsAt = new Date(Date.now() - 3 * 86_400_000);
  await g.prisma.$transaction((tx) =>
    groups.postCard(tx, {
      id: trialId, organizationId: orgId, teacherId: m.teachers[0].id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      prospect: { displayName: name, level: 'beginner' },
    }, null, CardKind.TRIAL_BOOKED, extra));
  const last = await g.prisma.message.findFirst({ where: { conversationId: conv, type: 'card' }, orderBy: { seq: 'desc' }, select: { id: true } });
  return last!.id;
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd59cards-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd59cards-${orgId.slice(0, 8)}', 'PD-59 trial cards QA academy')`,
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
    organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD),
  });
  who.superAdmin = { id: m.superAdmin.id, subject: m.superAdmin.subject };
  who.manager = { id: m.salesManager.id, subject: m.salesManager.subject };
  who.ops = { id: m.supervisors[0].id, subject: m.supervisors[0].subject };
  who.teachers = { id: m.teacherSupervisors[0].id, subject: m.teacherSupervisors[0].subject };
  who.teacher = { id: m.teachers[0].id, subject: m.teachers[0].subject };
  await staffWho('repA', 'rep_a', 'admin', true);
  await staffWho('repB', 'rep_b', 'admin', true);

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, SalesPipelineModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;

  // Prospects: A's and B's through the real create path; one with no owner (the pre-PD-59 shape).
  prospectA = (await http('repA', 'POST', '/sales-pipeline/leads', { displayName: NAME_A, contact: { parentName: 'Synthetic Parent One', phone: '+15557780001' } })).json.id;
  prospectB = (await http('repB', 'POST', '/sales-pipeline/leads', { displayName: NAME_B, contact: { parentName: 'Synthetic Parent Two', phone: '+15557780002' } })).json.id;
  prospectU = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.trial_prospect (id, organization_id, display_name, created_by) values ($1::uuid, $2::uuid, $3, $4::uuid)`,
    prospectU, orgId, NAME_U, who.ops.id);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.trial_student (prospect_id, organization_id, position, display_name) values ($1::uuid, $2::uuid, 1, $3)`,
    prospectU, orgId, NAME_U);
  trialA = await trialFor(prospectA, NAME_A, who.repA.id);
  trialB = await trialFor(prospectB, NAME_B, who.repB.id);
  trialU = await trialFor(prospectU, NAME_U, who.ops.id);

  // The group, with both representatives and the manager seated.
  const open = await http('manager', 'POST', `/trials/teachers/${m.teachers[0].id}/group`);
  expect(open.status).toBe(201);
  conv = (open.json.conversationId ?? open.json.id) as string;
  for (const k of ['repA', 'repB', 'manager']) expect([k, (await http(k, 'POST', `/trials/groups/${conv}/join`)).status < 300]).toEqual([k, true]);

  const text = await http('manager', 'POST', `/conversations/${conv}/messages`, { type: 'text', body: 'hello trial group', clientMessageId: randomUUID() });
  expect(text.status).toBeLessThan(300);
  textId = text.json.id ?? text.json.message?.id;
  cardA = await postTrialCard(trialA, NAME_A);
  cardB = await postTrialCard(trialB, NAME_B);
  cardU = await postTrialCard(trialU, NAME_U);
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await g.prisma.outboxEvent.deleteMany({});
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd59cards-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

const listIds = async (k: string, qs = '') => ((await http(k, 'GET', `/conversations/${conv}/messages${qs}`)).json.messages as Array<{ id: string }>).map((x) => x.id);
const seqOf = async (id: string) => (await g.prisma.message.findUniqueOrThrow({ where: { id } })).seq!.toString();
const row = async (k: string) => {
  const r = await http(k, 'GET', '/conversations');
  return (r.json.conversations as any[]).find((c) => c.id === conv);
};
const ALL = () => [textId, cardA, cardB, cardU];

describe('1. every read path hides another representative\'s (and an unowned) trial card from a representative', () => {
  it('the message page', async () => {
    const a = await listIds('repA');
    expect(a).toEqual(expect.arrayContaining([textId, cardA]));
    expect(a).not.toContain(cardB);
    expect(a).not.toContain(cardU);
    const b = await listIds('repB');
    expect(b).toEqual(expect.arrayContaining([textId, cardB]));
    expect(b).not.toContain(cardA);
    expect(b).not.toContain(cardU);
    for (const k of ['repA', 'repB']) {
      const text = JSON.stringify((await http(k, 'GET', `/conversations/${conv}/messages`)).json);
      const other = k === 'repA' ? [NAME_B, NAME_U, 'Bravo', 'Unowned'] : [NAME_A, NAME_U, 'Alpha', 'Unowned'];
      for (const s of other) expect([k, s, text.includes(s)]).toEqual([k, s, false]);
    }
  });

  it('pagination: walking back and catching up with before/after, one at a time, never surfaces a hidden card', async () => {
    const seen: string[] = [];
    let before: string | null = null;
    for (let i = 0; i < 10; i++) {
      const r: Res = await http('repA', 'GET', `/conversations/${conv}/messages?limit=1${before ? `&before=${before}` : ''}`);
      seen.push(...r.json.messages.map((x: { id: string }) => x.id));
      before = r.json.messages.length ? await seqOf(r.json.messages[r.json.messages.length - 1].id) : null;
      if (!before) break;
    }
    expect(seen).toEqual(expect.arrayContaining([cardA, textId]));
    expect(seen).not.toContain(cardB);
    expect(seen).not.toContain(cardU);
    const afterFirst = await listIds('repA', '?after=0&limit=50');
    expect(afterFirst).not.toContain(cardB);
    expect(afterFirst).not.toContain(cardU);
  });

  it('the chat list row: the preview is the newest card the viewer may read, and the unread count excludes the hidden ones', async () => {
    expect((await row('repA')).lastMessage.seq).toBe(await seqOf(cardA));
    expect((await row('repB')).lastMessage.seq).toBe(await seqOf(cardB));
    expect((await row('repA')).unreadCount).toBe(2); // the text and its own card
    expect((await row('repB')).unreadCount).toBe(2);
    expect((await http('repA', 'GET', `/conversations/${conv}/messages/unread`)).json.unread).toBe(2);
    expect((await http('repB', 'GET', `/conversations/${conv}/messages/unread`)).json.unread).toBe(2);
    expect((await http('repA', 'GET', `/conversations/${conv}`)).json.unreadCount).toBe(2);
    expect((await http('repA', 'GET', `/conversations/${conv}`)).json.lastMessage.seq).toBe(await seqOf(cardA));
  });

  it('search never returns a card (cards are not matched), for a representative or anyone else; ordinary text is still found', async () => {
    for (const k of ['repA', 'repB', 'manager']) {
      for (const needle of ['Zebulon', 'Quasar', 'Nimbus']) {
        expect([k, needle, JSON.stringify((await http(k, 'GET', `/conversations/${conv}/messages/search?q=${needle}`)).json).includes(needle)]).toEqual([k, needle, false]);
        expect([k, needle, JSON.stringify((await http(k, 'GET', `/me/search?q=${needle}`)).json).includes(needle)]).toEqual([k, needle, false]);
      }
      expect((await http(k, 'GET', `/conversations/${conv}/messages/search?q=hello`)).json.hits).toHaveLength(1);
    }
  });

  it('the export rows, pins and the id-based routes treat a hidden card as absent', async () => {
    const messages = app.get(MessageService, { strict: false });
    const actor = await app.get(ConversationService, { strict: false }).requireActor(who.repA.id);
    const exported: string[] = [];
    for await (const batch of messages.exportRows(actor, conv, null)) exported.push(...batch.map((b) => b.row.id));
    expect(exported).toEqual(expect.arrayContaining([cardA, textId]));
    expect(exported).not.toContain(cardB);
    expect(exported).not.toContain(cardU);
    // pin / star / info / react: on a hidden card the answer is "message not found" for THAT id; the very same
    // call on a card the rep may read is not (so the 404 is the filter, not a wrong route or a wrong body).
    const absent = await http('repA', 'POST', `/conversations/${conv}/messages/${randomUUID()}/star`);
    expect([absent.status, absent.code]).toEqual([404, CommErrorCode.MESSAGE_NOT_FOUND]);
    for (const tail of [['POST', 'star'], ['POST', 'pin'], ['GET', 'info'], ['POST', 'reactions']] as const) {
      const call = (id: string) => http('repA', tail[0], `/conversations/${conv}/messages/${id}/${tail[1]}`, tail[0] === 'POST' ? { emoji: '\u{1F44D}' } : undefined);
      const hidden = await call(cardB);
      expect([tail[1], hidden.status, hidden.code, hidden.json]).toEqual([tail[1], 404, CommErrorCode.MESSAGE_NOT_FOUND, absent.json]);
      const visible = await call(cardA);
      expect([tail[1], visible.code === CommErrorCode.MESSAGE_NOT_FOUND]).toEqual([tail[1], false]);
    }
    expect((await http('repA', 'POST', `/conversations/${conv}/messages/${cardA}/star`)).status).toBeLessThan(300);
    const starred = (await http('repA', 'GET', '/me/starred')).json.items as Array<{ message: { id: string } }>;
    expect(starred.map((s) => s.message.id)).toEqual([cardA]);
    // a reply to a hidden card is refused as an absent target
    const reply = await http('repA', 'POST', `/conversations/${conv}/messages`, { type: 'text', body: 'replying', replyToMessageId: cardB, clientMessageId: randomUUID() });
    expect(reply.status).toBe(404);
  });
});

describe('2. fan-out: the realtime event and the Notification Center skip a representative who may not read the card', () => {
  it('message.created for a trial card excludes the representatives who may not read it (and nobody else)', async () => {
    sent.length = 0;
    const worker = new OutboxWorker(g.prisma, g.notifications, recording as never, g.identity, g.pipeline);
    while ((await worker.drain(500)) > 0) { /* the seed's own events first */ }
    const exceptOf = (messageId: string) => {
      const e = sent.find((s) => s.event === 'message.created' && s.payload.messageId === messageId);
      expect(e).toBeDefined();
      return new Set(e!.except ?? []);
    };
    expect(exceptOf(cardA)).toEqual(new Set([who.repB.id]));
    expect(exceptOf(cardB)).toEqual(new Set([who.repA.id]));
    expect(exceptOf(cardU)).toEqual(new Set([who.repA.id, who.repB.id]));
    expect(exceptOf(textId)).toEqual(new Set());
    // The Center keeps one entry per person per chat and records each message it counted.
    const center = async (messageId: string, k: string) =>
      Number((await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `select count(*) n from chat.notification_item_message im join chat.notification_item i on i.id = im.item_id
          where im.message_id = $1::uuid and i.recipient_id = $2::uuid`, messageId, who[k].id))[0].n);
    expect([await center(cardA, 'repA'), await center(cardA, 'repB')]).toEqual([1, 0]);
    expect([await center(cardB, 'repA'), await center(cardB, 'repB')]).toEqual([0, 1]);
    expect([await center(cardU, 'repA'), await center(cardU, 'repB')]).toEqual([0, 0]);
    expect([await center(cardU, 'manager'), await center(cardU, 'teacher')]).toEqual([1, 1]);
  });
});

describe('3. everyone else reads all of it', () => {
  it.each(['manager', 'superAdmin', 'ops', 'teacher', 'teachers'])('%s reads every message and the newest preview', async (k) => {
    const r = await http(k, 'GET', `/conversations/${conv}/messages`);
    expect([k, r.status]).toEqual([k, 200]);
    expect((r.json.messages as Array<{ id: string }>).map((x) => x.id)).toEqual(expect.arrayContaining(ALL()));
    expect(JSON.stringify(r.json)).toEqual(expect.stringContaining(NAME_B));
  });

  it('a member of the manager / teacher seat sees the full unread count and the newest card as the preview', async () => {
    for (const k of ['manager', 'teacher', 'teachers']) {
      const c = await row(k);
      if (!c) continue;
      expect([k, c.lastMessage.seq]).toEqual([k, await seqOf(cardU)]);
      expect([k, c.unreadCount]).toEqual([k, k === 'manager' ? 3 : 4]); // the manager sent the text
    }
  });
});

describe('4. the card follows the CURRENT owner of its prospect', () => {
  it('reassigning B\'s lead to A moves the card: A reads it (message page, preview, unread), B no longer does', async () => {
    const r = await http('manager', 'POST', `/sales-pipeline/leads/${prospectB}/owner`, { ownerId: who.repA.id });
    expect(r.status).toBeLessThan(300);
    const a = await listIds('repA');
    expect(a).toEqual(expect.arrayContaining([textId, cardA, cardB]));
    expect(a).not.toContain(cardU);
    const b = await listIds('repB');
    expect(b).toEqual(expect.arrayContaining([textId]));
    expect(b).not.toContain(cardA);
    expect(b).not.toContain(cardB);
    expect((await row('repA')).lastMessage.seq).toBe(await seqOf(cardB));
    expect((await row('repA')).unreadCount).toBe(3);
    expect((await row('repB')).unreadCount).toBe(1);
    expect((await row('repB')).lastMessage.seq).toBe(await seqOf(textId));
  });

  it('a card posted after the reassignment is announced to the CURRENT owner only', async () => {
    sent.length = 0;
    const later = await postTrialCard(trialB, NAME_B, { note: 'after the move' });
    const w = new OutboxWorker(g.prisma, g.notifications, recording as never, g.identity, g.pipeline);
    while ((await w.drain(500)) > 0) { /* all pending */ }
    const e = sent.find((s) => s.event === 'message.created' && s.payload.messageId === later);
    expect(new Set(e?.except ?? [])).toEqual(new Set([who.repB.id]));
    expect(await listIds('repA')).toContain(later);
    expect(await listIds('repB')).not.toContain(later);
  });

  it('a card for a prospect with NO owner is hidden from both representatives, and readable by the manager', async () => {
    expect(await listIds('repA')).not.toContain(cardU);
    expect(await listIds('repB')).not.toContain(cardU);
    expect(await listIds('manager')).toContain(cardU);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 5. hardening: roles that are NOT representatives, parity of the two statements of the rule, fail-closed,
//    forward, the pins list. Fresh fixtures: section 4 moved B's first lead to A.
// ---------------------------------------------------------------------------------------------------------

/** A prospect owned (through the real create path) by `owner`, one trial for it, and its card. */
async function freshCard(owner: string, name: string, extra: Record<string, unknown> = {}): Promise<{ prospect: string; trial: string; card: string }> {
  const prospect = (await http(owner, 'POST', '/sales-pipeline/leads', { displayName: name, contact: { parentName: `Synthetic Parent ${name}`, phone: `+1555779${String(++slot).padStart(4, '0')}` } })).json.id as string;
  const trial = await trialFor(prospect, name, who[owner].id);
  const card = await postTrialCard(trial, name, extra);
  return { prospect, trial, card };
}
const drainAll = async () => {
  sent.length = 0;
  const w = new OutboxWorker(g.prisma, g.notifications, recording as never, g.identity, g.pipeline);
  while ((await w.drain(500)) > 0) { /* all pending */ }
};
const exceptFor = (messageId: string) => new Set(sent.find((x) => x.event === 'message.created' && x.payload.messageId === messageId)?.except ?? []);

describe('5a. a Sales member who is ALSO the manager of Operations or of the Teachers department is not a representative', () => {
  // The guarded path cannot make this person (a department member must be admin/coverage, a manager must have
  // the manager role), so the rows are written the way a legacy or hand-repaired database could hold them,
  // with the guard triggers off. The rule says such a person is on the trial desk and keeps full visibility.
  const originalManager = new Map<string, string | null>();
  async function dualRole(key: string, kind: 'operations' | 'teachers'): Promise<void> {
    await staffWho(key, key, 'admin', true);
    const [d] = await g.prisma.$queryRawUnsafe<Array<{ id: string; manager_id: string | null }>>(
      `select id::text, manager_id::text from chat.department where organization_id = $1::uuid and kind = $2`, orgId, kind);
    originalManager.set(d.id, d.manager_id);
    await rows(`update chat.department set manager_id = $1::uuid where id = $2::uuid`, who[key].id, d.id);
  }
  afterAll(async () => {
    for (const [id, manager] of originalManager) await rows(`update chat.department set manager_id = $1::uuid where id = $2::uuid`, manager, id);
  });

  it('reads every trial card and is never excluded from the realtime event', async () => {
    await dualRole('repOps', 'operations');
    await dualRole('repTeachers', 'teachers');
    for (const k of ['repOps', 'repTeachers']) expect([k, (await http(k, 'POST', `/trials/groups/${conv}/join`)).status < 300]).toEqual([k, true]);
    const b = await freshCard('repB', 'Orchid Dual-Role-Prospect');
    await drainAll();
    // a plain representative who does not own it (A) is excluded; the owner (B) and the two dual-role people are not
    expect(exceptFor(b.card)).toEqual(new Set([who.repA.id]));
    for (const k of ['repOps', 'repTeachers']) expect([k, await listIds(k, '?limit=100')]).toEqual([k, expect.arrayContaining([b.card, cardU, cardA])]);
    const own = await listIds('repB', '?limit=100');
    expect([own.includes(b.card), own.includes(cardU)]).toEqual([true, false]);
    expect(await listIds('repA', '?limit=100')).not.toContain(b.card);
    for (const k of ['repOps', 'repTeachers']) {
      const reps = await salesRepsAmong(g.prisma, orgId, [who[k].id]);
      expect([k, reps.size]).toEqual([k, 0]);
    }
  });
});

describe('5b. salesRepScope and salesRepsAmong state one rule', () => {
  it('agree on every actor shape (rep, Sales manager, super admin, Operations, Teachers, departed, another organization)', async () => {
    const lessons = app.get(LessonService, { strict: false });
    const prisma = app.get(PrismaService, { strict: false });
    // an inactive, departed Sales member, and a Sales member of ANOTHER organization
    const departed = await g.prisma.staff.create({ data: { organizationId: orgId, name: 'departed_sales', role: 'admin', isActive: false, leftAt: new Date() } });
    await rows(`insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, $2::uuid, $3::uuid, 'supervisor')`, departed.id, orgId, m.departments.sales);
    const org2 = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${org2}'::uuid, 'pd59cards-${org2.slice(0, 8)}', 'other academy')`);
    const outsider = await g.prisma.staff.create({ data: { organizationId: org2, name: 'outsider_sales', role: 'admin', isActive: true } });
    await rows(`insert into chat.department (organization_id, kind, display_name) values ($1::uuid, 'sales', 'Sales')`, org2);
    await rows(`insert into chat.department_member (staff_id, organization_id, department_id, position)
                select $1::uuid, $2::uuid, id, 'supervisor' from chat.department where organization_id = $2::uuid and kind = 'sales'`, outsider.id, org2);
    // label, staff id, organization, isActive, staff role, is a representative
    const shapes: Array<[string, string, string, boolean, string, boolean]> = [
      ['rep A', who.repA.id, orgId, true, 'admin', true],
      ['rep B', who.repB.id, orgId, true, 'admin', true],
      ['Sales manager', who.manager.id, orgId, true, 'manager', false],
      ['super admin', who.superAdmin.id, orgId, true, 'super_admin', false],
      ['Operations supervisor', who.ops.id, orgId, true, 'admin', false],
      ['Teachers supervisor', who.teachers.id, orgId, true, 'admin', false],
      ['the teacher', who.teacher.id, orgId, true, 'admin', false],
      ['departed Sales member', departed.id, orgId, false, 'admin', true],
      ['Sales member of another organization (in its own)', outsider.id, org2, true, 'admin', true],
    ];
    for (const [label, id, org, active, role, expected] of shapes) {
      const actor = { actorId: id, kind: 'staff', displayName: label, locale: 'en', isActive: active, staffRole: role, organizationId: org } as never;
      const viaScope = (await salesRepScope(prisma, lessons, actor)) !== null;
      const viaAmong = (await salesRepsAmong(prisma, org, [id])).has(id);
      expect([label, 'scope', viaScope]).toEqual([label, 'scope', expected]);
      expect([label, 'among', viaAmong]).toEqual([label, 'among', expected]);
    }
    // another organization's staff are never this organization's representatives
    expect((await salesRepsAmong(prisma, orgId, [outsider.id])).size).toBe(0);
    // null = every staff member of the organization: the representatives only
    const all = await salesRepsAmong(prisma, orgId, null);
    expect(all.has(who.repA.id) && all.has(who.repB.id) && all.has(departed.id)).toBe(true);
    for (const k of ['manager', 'superAdmin', 'ops', 'teachers', 'teacher']) expect([k, all.has(who[k].id)]).toEqual([k, false]);
    expect(all.has(outsider.id)).toBe(false);
  });
});

describe('5c. fail closed: a card that does not name a readable trial is hidden from every representative', () => {
  it('no trialId, a trialId that is not a uuid, a trial that does not exist, and a trial without a prospect', async () => {
    const mk = (extra: Record<string, unknown>, trial: string) => postTrialCard(trial, 'Nebula Orphan-Prospect', extra);
    // postCard spreads `extra` over trialId: undefined drops the key from the JSON, null and a string replace it
    const noKey = await mk({ trialId: undefined }, trialA);
    const notUuid = await mk({ trialId: 'not-a-uuid' }, trialA);
    const nullKey = await mk({ trialId: null }, trialA);
    const missingTrial = await mk({ trialId: randomUUID() }, trialA);
    // a real trial row whose prospect_id is NULL (if the schema allows one)
    const noProspect = randomUUID();
    let orphan: string | null = null;
    try {
      await rows(
        `insert into chat.lesson (id, organization_id, teacher_id, kind, starts_at, ends_at, created_by, created_by_kind, prospect_id)
         values ($1::uuid, $2::uuid, $3::uuid, 'trial', now() - interval '9 days', now() - interval '9 days' + interval '30 minutes', $4::uuid, 'staff', null)`,
        noProspect, orgId, m.teachers[0].id, who.ops.id);
      orphan = await mk({}, noProspect);
    } catch {
      orphan = null;
    }
    const generated = await g.prisma.$queryRawUnsafe<Array<{ trial_id: string | null }>>(
      `select trial_id::text from chat.message_card where message_id = any($1::uuid[])`, [noKey, notUuid, nullKey]);
    expect(generated.map((r) => r.trial_id)).toEqual([null, null, null]);
    const hidden = [noKey, notUuid, missingTrial, nullKey, ...(orphan ? [orphan] : [])];
    for (const k of ['repA', 'repB']) {
      const ids = await listIds(k, '?limit=100');
      for (const id of hidden) expect([k, id, ids.includes(id)]).toEqual([k, id, false]);
    }
    for (const k of ['manager', 'superAdmin', 'ops', 'teacher', 'teachers']) {
      const ids = await listIds(k, '?limit=100');
      for (const id of hidden) expect([k, id, ids.includes(id)]).toEqual([k, id, true]);
    }
    await drainAll();
    for (const id of hidden) expect([id, exceptFor(id).has(who.repA.id), exceptFor(id).has(who.repB.id)]).toEqual([id, true, true]);
  });
});

describe('5d. forward and pins', () => {
  it('forwarding a hidden card is "message not found"; a card the rep may read is "not forwardable" (cards never leave); the manager gets the latter for either', async () => {
    const f = (actor: string, id: string) => http(actor, 'POST', `/conversations/${conv}/messages/forward`, { messageIds: [id], toConversationIds: [randomUUID()] });
    const hidden = await f('repA', cardU);
    expect([hidden.status, hidden.code]).toEqual([404, CommErrorCode.MESSAGE_NOT_FOUND]);
    const own = await f('repA', cardA);
    expect([own.status, own.code]).toEqual([403, CommErrorCode.MESSAGE_NOT_FORWARDABLE]);
    const manager = await f('manager', cardU);
    expect([manager.status, manager.code]).toEqual([403, CommErrorCode.MESSAGE_NOT_FORWARDABLE]);
  });

  it('the pins list shows a representative only the pinned cards they may read', async () => {
    const x = await freshCard('repA', 'Vega Pin-Alpha');
    const y = await freshCard('repB', 'Rigel Pin-Bravo');
    for (const id of [x.card, y.card]) expect([id, (await http('manager', 'POST', `/conversations/${conv}/messages/${id}/pin`)).status < 300]).toEqual([id, true]);
    const pins = async (k: string) => ((await http(k, 'GET', `/conversations/${conv}/messages/pins`)).json.pins as Array<{ message: { id: string } }>).map((p) => p.message.id);
    const a = await pins('repA');
    expect(a).toContain(x.card);
    expect(a).not.toContain(y.card);
    const b = await pins('repB');
    expect(b).toContain(y.card);
    expect(b).not.toContain(x.card);
    expect(await pins('manager')).toEqual(expect.arrayContaining([x.card, y.card]));
    // and rep A cannot pin B's card
    const intruder = await http('repA', 'POST', `/conversations/${conv}/messages/${y.card}/pin`);
    expect([intruder.status, intruder.code]).toEqual([404, CommErrorCode.MESSAGE_NOT_FOUND]);
  });
});
