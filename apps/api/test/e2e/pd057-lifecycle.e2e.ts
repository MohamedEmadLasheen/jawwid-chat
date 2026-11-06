/**
 * PD-57 · the Report and Block lifecycle, black box against the REAL built API
 * and outbox worker (scripts/qa/e2e-smoke.sh starts them, seeds them and runs
 * every test/e2e/*.e2e.ts). Nothing is constructed in-process: HTTP under
 * /api/v1 and a socket.io client, exactly as the apps talk to the server.
 *
 * Closure plan docs/release/pd57-closure-plan-2026-11-06.md: PD-57 is not
 * complete until this lifecycle works against the real backend.
 *
 *   1. report: a parent reports a teacher's message; a duplicate folds into it
 *   2. moderation scope (D-3): out-of-department staff get 404; the department's
 *      manager sees it with the reported person and acts on it
 *   3. resolve `warned`: the reporter reads the answer (no reviewer); the subject
 *      gets a Code of Conduct reminder that never names the report; the
 *      reporter's report_answered arrives through the real worker
 *   4. child safety (D-4): the Super Admin is told at once; a department manager
 *      cannot open it
 *   5. block (D-5): the blocked teacher's new message is hidden for the parent
 *      on the server (REST and realtime), visible to its author; staff cannot
 *      block; unblock restores it at once
 *
 * Synthetic seed only. A different one-child family from smoke.e2e.ts, so the
 * two files never touch each other's data.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';

jest.setTimeout(180_000);

const BASE = (process.env.E2E_BASE_URL ?? '').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const accounts: Array<{ subject: string; name: string; role: string }> = JSON.parse(
  readFileSync(process.env.E2E_MANIFEST ?? '', 'utf8'),
).accounts;
const password = readFileSync(process.env.E2E_PASSWORD_FILE ?? '', 'utf8').trim();

const byRole = (role: (r: string) => boolean, name?: string) => {
  const hit = accounts.filter((x) => role(x.role) && (name === undefined || x.name === name));
  if (!hit.length) throw new Error(`no seeded account with that role${name ? ` named ${name}` : ''}`);
  return hit;
};
const ONE_CHILD_PARENT = (r: string) => r.startsWith('parent (1 children');

type Session = { token: string; actorId: string };
type Reply = { status: number; json: any; code?: string };

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Reply> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json, code: json?.error?.code ?? json?.code };
}

async function login(subject: string): Promise<Session> {
  const r = await call('POST', '/auth/login', undefined, { username: subject, password });
  if (r.status !== 200) throw new Error(`login: HTTP ${r.status} ${r.code ?? ''}`);
  return { token: r.json.accessToken, actorId: r.json.actor.actorId };
}

/** Waits for the real worker: polls until `check` returns a value, or fails after 45 s. */
async function eventually<T>(what: string, check: () => Promise<T | undefined | null | false>): Promise<T> {
  const until = Date.now() + 45_000;
  for (;;) {
    const v = await check();
    if (v) return v as T;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const inbox = async (s: Session) => ((await call('GET', '/me/notifications?limit=50', s.token)).json?.entries ?? []) as Array<{
  id: string; title: string; body: string; refs: Record<string, string>;
}>;

const sockets: Socket[] = [];
function connect(s: Session): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token: s.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    const timer = setTimeout(() => reject(new Error('socket did not connect in 15 s')), 15_000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });
}

let parent: Session;
let teacher: Session;
let teacherId: string;
let superAdmin: Session;
let teachersManager: Session;
let salesManager: Session;
let groupId: string;
let messageId: string;
let reportId: string;

beforeAll(async () => {
  if (!BASE || !password) throw new Error('E2E_BASE_URL and E2E_PASSWORD_FILE are required; run scripts/qa/e2e-smoke.sh');
  // The second one-child family (smoke.e2e.ts uses the first).
  parent = await login(byRole(ONE_CHILD_PARENT)[1]!.subject);
  const mine = await call('GET', '/conversations', parent.token);
  groupId = mine.json.conversations.find((c: { type: string }) => c.type === 'family_group')?.id;
  if (!groupId) throw new Error('the parent has no family group');
  const members: Array<{ actorId: string; actorKind: string; displayName: string }> =
    (await call('GET', `/conversations/${groupId}`, parent.token)).json.members ?? [];
  const t = members.find((m) => m.actorKind === 'teacher');
  if (!t) throw new Error('the family group has no teacher');
  teacherId = t.actorId;
  [teacher, superAdmin, teachersManager, salesManager] = await Promise.all([
    login(byRole((r) => r === 'teacher', t.displayName)[0]!.subject),
    login(byRole((r) => r === 'super_admin')[0]!.subject),
    login(byRole((r) => r === 'teachers manager')[0]!.subject),
    login(byRole((r) => r === 'sales manager')[0]!.subject),
  ]);
  const sent = await call('POST', `/conversations/${groupId}/messages`, teacher.token, {
    body: `pd57 e2e ${randomUUID()}`, clientMessageId: randomUUID(),
  });
  if (sent.status !== 201) throw new Error(`teacher message: HTTP ${sent.status}`);
  messageId = sent.json.id;
});

afterAll(() => {
  for (const s of sockets) s.close();
});

describe('1. report', () => {
  it('a parent reports the teacher\'s message: 201, open, due in 24 hours; the duplicate answers 200 with the same report', async () => {
    const before = Date.now();
    const r = await call('POST', '/reports', parent.token, { targetKind: 'message', messageId, reason: 'harassment' });
    expect(r.status).toBe(201);
    expect(Object.keys(r.json).sort()).toEqual(['dueAt', 'id', 'status']);
    expect(r.json.status).toBe('open');
    const due = new Date(r.json.dueAt).getTime();
    expect(due - before).toBeGreaterThan(24 * 3_600_000 - 5 * 60_000);
    expect(due - before).toBeLessThan(24 * 3_600_000 + 5 * 60_000);
    reportId = r.json.id;
    const again = await call('POST', '/reports', parent.token, { targetKind: 'message', messageId, reason: 'harassment' });
    expect({ status: again.status, id: again.json.id }).toEqual({ status: 200, id: reportId });
  });

  it('the teacher cannot report their own message, and nobody reads another person\'s reports', async () => {
    const self = await call('POST', '/reports', teacher.token, { targetKind: 'message', messageId, reason: 'spam' });
    expect({ status: self.status, code: self.code }).toEqual({ status: 400, code: 'COMM.REPORT_SELF' });
    const theirs = await call('GET', '/me/reports', teacher.token);
    expect((theirs.json as Array<{ id: string }>).map((x) => x.id)).not.toContain(reportId);
  });
});

describe('2. moderation scope (D-2, D-3)', () => {
  it('a manager of another department gets 404, never 403; the Teachers manager and the Super Admin see it with the reported person', async () => {
    const out = await call('GET', `/moderation/reports/${reportId}`, salesManager.token);
    expect(out.status).toBe(404);
    for (const s of [teachersManager, superAdmin]) {
      const queue = await call('GET', '/moderation/reports', s.token);
      expect(queue.status).toBe(200);
      const row = (Array.isArray(queue.json) ? queue.json : queue.json.items).find((x: { id: string }) => x.id === reportId);
      expect(row).toMatchObject({ targetKind: 'message', reason: 'harassment', subject: { kind: 'teacher', id: teacherId } });
      expect(JSON.stringify(row)).not.toContain(parent.actorId);
    }
    const detail = await call('GET', `/moderation/reports/${reportId}`, teachersManager.token);
    expect(detail.status).toBe(200);
    expect(detail.json).toMatchObject({ canAct: true, subject: { kind: 'teacher', id: teacherId } });
    expect(detail.json.evidence?.body).toEqual(expect.stringContaining('pd57 e2e'));
    expect(JSON.stringify(detail.json)).not.toContain(parent.actorId);
  });
});

describe('3. resolve, and the reporter answered (through the real worker)', () => {
  it('warned: the reporter reads the answer with no reviewer; the subject gets a reminder that never names the report', async () => {
    const answer = 'Thank you. We have spoken to the teacher.';
    const done = await call('POST', `/moderation/reports/${reportId}/resolve`, teachersManager.token, {
      resolution: 'warned', note: 'e2e', answer,
    });
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ status: 'actioned', resolution: 'warned' });

    const mine = (await call('GET', '/me/reports', parent.token)).json as Array<Record<string, unknown>>;
    const row = mine.find((x) => x.id === reportId)!;
    expect(row).toMatchObject({ status: 'actioned', answer: { text: answer } });
    expect(JSON.stringify(row)).not.toContain(teachersManager.actorId);

    const answered = await eventually('report_answered in the parent\'s inbox', async () =>
      (await inbox(parent)).find((e) => e.refs?.reportId === reportId));
    expect(JSON.stringify(answered)).not.toContain(teachersManager.actorId);

    const warning = await eventually('the conduct reminder in the teacher\'s inbox', async () =>
      (await inbox(teacher)).find((e) => /conduct|السلوك/i.test(`${e.title} ${e.body}`)));
    expect(JSON.stringify(warning)).not.toContain(reportId);
    expect(JSON.stringify(warning)).not.toContain(parent.actorId);
  });
});

describe('4. child safety (D-4)', () => {
  it('the Super Admin is told at once; the department\'s manager cannot open it', async () => {
    const r = await call('POST', '/reports', parent.token, {
      targetKind: 'person', subject: { kind: 'teacher', id: teacherId }, reason: 'child_safety',
    });
    expect(r.status).toBe(201);
    const id = r.json.id as string;
    await eventually('report_child_safety in the Super Admin\'s inbox', async () =>
      (await inbox(superAdmin)).find((e) => e.refs?.reportId === id));
    expect((await call('GET', `/moderation/reports/${id}`, teachersManager.token)).status).toBe(404);
    expect((await call('GET', `/moderation/reports/${id}`, superAdmin.token)).status).toBe(200);
  });
});

describe('5. block, enforced on the server (D-5)', () => {
  let blockId: string;
  let hiddenId: string;

  it('staff cannot block a family', async () => {
    const r = await call('POST', '/me/blocks', superAdmin.token, { subject: { kind: 'contact', id: parent.actorId } });
    expect({ status: r.status, code: r.code }).toEqual({ status: 403, code: 'COMM.BLOCK_NOT_ALLOWED' });
  });

  it('the parent blocks the teacher; the teacher\'s next message is hidden for the parent over REST and realtime, never for its author', async () => {
    const b = await call('POST', '/me/blocks', parent.token, { subject: { kind: 'teacher', id: teacherId } });
    expect(b.status).toBe(201);
    expect(b.json).toMatchObject({ subject: { kind: 'teacher', id: teacherId } });
    blockId = b.json.id;
    expect(((await call('GET', '/me/blocks', parent.token)).json as Array<{ id: string }>).map((x) => x.id)).toContain(blockId);

    const socket = await connect(parent);
    const sub = await socket.timeout(10_000).emitWithAck('conversation.subscribe', { conversationId: groupId });
    expect(sub).toEqual(expect.objectContaining({ ok: true }));
    const body = `pd57 e2e hidden ${randomUUID()}`;
    const live = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no message.created within 30 s')), 30_000);
      socket.on('message.created', (e: Record<string, unknown>) => {
        if (e.messageId === hiddenId) { clearTimeout(timer); resolve(e); }
      });
    });
    const sent = await call('POST', `/conversations/${groupId}/messages`, teacher.token, { body, clientMessageId: randomUUID() });
    expect(sent.status).toBe(201);
    hiddenId = sent.json.id;
    const event = await live;
    expect(event.hiddenByBlock).toBe(true);
    expect(JSON.stringify(event)).not.toContain(body);

    const forParent = (await call('GET', `/conversations/${groupId}/messages?limit=30`, parent.token)).json.messages
      .find((m: { id: string }) => m.id === hiddenId);
    expect(forParent).toMatchObject({ hiddenByBlock: true });
    expect(JSON.stringify(forParent)).not.toContain(body);
    const forAuthor = (await call('GET', `/conversations/${groupId}/messages?limit=30`, teacher.token)).json.messages
      .find((m: { id: string }) => m.id === hiddenId);
    expect(forAuthor.body).toBe(body);
    expect(forAuthor.hiddenByBlock).toBeFalsy();
  });

  it('unblocking restores the message at once', async () => {
    expect((await call('DELETE', `/me/blocks/${blockId}`, parent.token)).status).toBe(204);
    const m = (await call('GET', `/conversations/${groupId}/messages?limit=30`, parent.token)).json.messages
      .find((x: { id: string }) => x.id === hiddenId);
    expect(m.hiddenByBlock).toBeFalsy();
    expect(m.body).toEqual(expect.stringContaining('pd57 e2e hidden'));
  });
});
