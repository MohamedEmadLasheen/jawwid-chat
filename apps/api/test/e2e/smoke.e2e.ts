/**
 * G-38 · end-to-end smoke: the parent and teacher journeys, black box.
 *
 * Unlike the integration suite, nothing here is constructed in-process. The
 * built API (`dist/main.js`) and outbox worker (`dist/worker.js`) run as real
 * processes against Postgres and Redis, the accounts come from the real seed CLI
 * (`dist/cli/seed-org-chat.js`), and this file talks to them only the way the
 * apps do: HTTP under /api/v1 and a real socket.io client. So it also proves the
 * wiring the integration suite fakes: the global prefix and guards, the socket
 * handshake, and the worker -> Redis -> API relay that carries every realtime
 * event.
 *
 * Run it with `scripts/qa/e2e-smoke.sh`, which starts the stack, seeds it, runs
 * this file and stops everything. Inputs, all from that script:
 *   E2E_BASE_URL       the API origin, e.g. http://127.0.0.1:3555
 *   E2E_MANIFEST       the seed's public manifest (logins, names, roles; no ids, no secrets)
 *   E2E_PASSWORD_FILE  the seed's QA password, chmod 600. Read here, never printed.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';

jest.setTimeout(120_000);

const BASE = (process.env.E2E_BASE_URL ?? '').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const accounts: Array<{ subject: string; name: string; role: string }> = JSON.parse(
  readFileSync(process.env.E2E_MANIFEST ?? '', 'utf8'),
).accounts;
const password = readFileSync(process.env.E2E_PASSWORD_FILE ?? '', 'utf8').trim();

/** The manifest names people, never ids: ids are found the way an app finds
 *  them, through the API. */
function account(role: (r: string) => boolean, name?: string) {
  const hit = accounts.find((x) => role(x.role) && (name === undefined || x.name === name));
  if (!hit) throw new Error(`no seeded account with that role${name ? ` named ${name}` : ''}`);
  return hit;
}
const ONE_CHILD_PARENT = (r: string) => r.startsWith('parent (1 children');

type Session = { token: string; actorId: string };

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function login(subject: string): Promise<Session> {
  const r = await call('POST', '/auth/login', undefined, { username: subject, password });
  if (r.status !== 200) throw new Error(`login: HTTP ${r.status} ${r.json?.code ?? ''}`);
  return { token: r.json.accessToken, actorId: r.json.actor.actorId };
}

function connect(s: Session): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token: s.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    const timer = setTimeout(() => reject(new Error('socket did not connect in 15 s')), 15_000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function subscribe(socket: Socket, conversationId: string): Promise<{ ok: boolean; code?: string }> {
  return socket.timeout(10_000).emitWithAck('conversation.subscribe', { conversationId });
}

/** The first `message.created` for `messageId`. The worker drains the outbox on
 *  a poll and relays through Redis, so this waits generously rather than racing. */
function created(socket: Socket, messageId: string) {
  return new Promise<{ messageId: string; conversationId: string }>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message.created', on); reject(new Error('no message.created within 30 s')); }, 30_000);
    const on = (e: { messageId: string; conversationId: string }) => {
      if (e.messageId !== messageId) return;
      clearTimeout(timer);
      socket.off('message.created', on);
      resolve(e);
    };
    socket.on('message.created', on);
  });
}

const sockets: Socket[] = [];
let parent: Session;
let teach: Session;
let scheduler: Session;
let groupId: string;
let learnerId: string | undefined;
let otherGroupId: string | undefined;

beforeAll(async () => {
  if (!BASE || !password) throw new Error('E2E_BASE_URL and E2E_PASSWORD_FILE are required; run scripts/qa/e2e-smoke.sh');
  // A one-child family: its group holds the parent, the child's teacher and their supervisor.
  parent = await login(account(ONE_CHILD_PARENT).subject);
  const mine = await call('GET', '/conversations', parent.token);
  groupId = mine.json.conversations.find((c: { type: string }) => c.type === 'family_group')?.id;
  if (!groupId) throw new Error('the parent has no family group');
  const detail = (await call('GET', `/conversations/${groupId}`, parent.token)).json;
  const members: Array<{ actorKind: string; memberRole: string; displayName: string }> = detail.members ?? [];
  const teacherName = members.find((m) => m.actorKind === 'teacher')?.displayName;
  // Lessons are scheduled by the Teachers department (or the super admin).
  [teach, scheduler] = await Promise.all([
    login(account((r) => r === 'teacher', teacherName).subject),
    login(account((r) => r === 'teachers manager').subject),
  ]);
  // The child, as the app finds it: the children the group is about.
  learnerId = (await call('GET', `/conversations/${groupId}/learners`, parent.token)).json?.learners?.[0]?.id;
  // Another family's group, found by the super admin, who sees every family.
  const admin = await login(account((r) => r === 'super_admin').subject);
  const all = await call('GET', '/conversations', admin.token);
  const own = new Set(mine.json.conversations.map((c: { id: string }) => c.id));
  otherGroupId = all.json.conversations.find((c: { id: string; type: string }) => c.type === 'family_group' && !own.has(c.id))?.id;
});

afterAll(() => {
  for (const s of sockets) s.close();
});

describe('1. the stack is up', () => {
  it('liveness and readiness answer 200; the API refuses an anonymous call', async () => {
    expect((await fetch(`${BASE}/health/live`)).status).toBe(200);
    expect((await fetch(`${BASE}/health/ready`)).status).toBe(200);
    expect((await call('GET', '/conversations')).status).toBe(401);
  });

  it('a wrong password is refused', async () => {
    const r = await call('POST', '/auth/login', undefined, { username: account(ONE_CHILD_PARENT).subject, password: `${password}-wrong` });
    expect(r.status).toBe(401);
  });
});

describe('2. chat: send and receive over realtime', () => {
  it('parent and teacher both list the family group', async () => {
    for (const s of [parent, teach]) {
      const r = await call('GET', '/conversations', s.token);
      expect(r.status).toBe(200);
      expect(r.json.conversations.map((c: { id: string }) => c.id)).toContain(groupId);
    }
  });

  it('a parent message reaches the teacher live, and a retry is the same message', async () => {
    const teacherSocket = await connect(teach);
    expect(await subscribe(teacherSocket, groupId)).toEqual(expect.objectContaining({ ok: true }));

    const clientMessageId = randomUUID();
    const body = `e2e smoke ${clientMessageId}`;
    const sent = await call('POST', `/conversations/${groupId}/messages`, parent.token, { body, clientMessageId });
    expect(sent.status).toBe(201);
    const live = await created(teacherSocket, sent.json.id);
    expect(live.conversationId).toBe(groupId);

    // The event carries no body; the teacher reads it over REST.
    const read = await call('GET', `/conversations/${groupId}/messages?limit=20`, teach.token);
    expect(read.status).toBe(200);
    expect(read.json.messages.find((m: { id: string }) => m.id === sent.json.id)?.body).toBe(body);

    const retry = await call('POST', `/conversations/${groupId}/messages`, parent.token, { body, clientMessageId });
    expect(retry.status).toBeLessThan(300);
    expect(retry.json.id).toBe(sent.json.id);
  });

  it('the teacher replies and the parent receives it live', async () => {
    const parentSocket = await connect(parent);
    expect(await subscribe(parentSocket, groupId)).toEqual(expect.objectContaining({ ok: true }));
    const sent = await call('POST', `/conversations/${groupId}/messages`, teach.token, {
      body: 'e2e smoke reply',
      clientMessageId: randomUUID(),
    });
    expect(sent.status).toBe(201);
    await created(parentSocket, sent.json.id);
  });

  it("another family's group is out of reach: no list entry, no read, no live subscription", async () => {
    expect(otherGroupId).toEqual(expect.any(String));
    const list = await call('GET', '/conversations', parent.token);
    expect(list.json.conversations.map((c: { id: string }) => c.id)).not.toContain(otherGroupId);
    const read = await call('GET', `/conversations/${otherGroupId}/messages`, parent.token);
    expect([403, 404]).toContain(read.status);
    const socket = await connect(parent);
    expect((await subscribe(socket, otherGroupId!)).ok).toBe(false);
  });
});

describe('3. the lesson schedule', () => {
  let lessonId: string;

  it('the Teachers manager schedules a lesson for the child', async () => {
    expect(learnerId).toEqual(expect.any(String));
    const start = new Date(Date.now() + 2 * 86_400_000);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 45 * 60_000);
    const r = await call('POST', '/lessons', scheduler.token, { learnerId, startsAt: start.toISOString(), endsAt: end.toISOString() });
    if (r.status !== 201) throw new Error(`POST /lessons: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    lessonId = r.json.id;
    expect(lessonId).toEqual(expect.any(String));
  });

  it('the parent and the teacher both see it in their schedule', async () => {
    for (const s of [parent, teach]) {
      const r = await call('GET', '/lessons', s.token);
      expect(r.status).toBe(200);
      expect(r.json.lessons.map((l: { id: string }) => l.id)).toContain(lessonId);
    }
    // The teacher's own calendar (PD-38) carries it too.
    const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    const calendar = await call('GET', `/me/calendar?from=${day(0)}&to=${day(7)}`, teach.token);
    expect(calendar.status).toBe(200);
    expect(JSON.stringify(calendar.json)).toContain(lessonId);
  });
});

describe('4. payments', () => {
  it('the parent opens their billing view: instalments, requests and totals', async () => {
    const r = await call('GET', '/me/billing', parent.token);
    expect(r.status).toBe(200);
    expect(r.json).toEqual(
      expect.objectContaining({ instalments: expect.any(Array), requests: expect.anything(), totals: expect.anything() }),
    );
  });
});
