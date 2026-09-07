/**
 * Realtime over a REAL socket, against the running API.
 *
 * What this proves that nothing else does: the gateway authenticates the
 * handshake with the same bearer token HTTP uses, refuses a forged one,
 * authorizes the room join, and actually delivers the events the outbox
 * publishes — end to end, sender's HTTP POST to recipient's socket frame.
 */
// socket.io-client belongs to apps/admin-web -- it is the package that already
// depends on it. Adding a client library to the API's dependency tree purely
// for a smoke test would be the wrong place to put it.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WEB = path.resolve(import.meta.dirname, '../../../apps/admin-web');
const requireFromWeb = createRequire(pathToFileURL(path.join(WEB, 'package.json')));
const { io } = requireFromWeb('socket.io-client');

const HTTP = process.env.API_BASE_URL ?? 'http://127.0.0.1:3999/api/v1';
const WS = process.env.REALTIME_URL ?? 'http://127.0.0.1:3999';
const ids = JSON.parse(process.argv[2]);
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  <- ${detail}`}`);
  if (!ok) failures++;
};

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${HTTP}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};
const login = (subject) =>
  call('POST', '/auth/login', { body: { subject, password: 'smoke-password-long-enough' } });

const A = await login('smoke_parent');
const B = await login('smoke_supervisor');
const conv = await call('POST', '/conversations/direct', {
  token: A.accessToken, body: { withActorId: ids.supervisor },
});

// --- A forged handshake is disconnected.
// Socket.IO establishes the transport before the gateway's handler runs, so a
// forged token shows as "connected, then dropped". Only the final state is the
// verdict, and what matters is that the socket is not left usable.
await new Promise((resolve) => {
  const bad = io(WS, { transports: ['websocket'], auth: { token: 'not-a-token' }, reconnection: false });
  setTimeout(async () => {
    const stillUp = bad.connected;
    let joined = null;
    if (stillUp) {
      joined = await bad.emitWithAck('conversation.subscribe', { conversationId: conv.id })
        .catch(() => null);
    }
    check('a forged token cannot reach a conversation',
      !stillUp || joined?.ok !== true, JSON.stringify({ stillUp, joined }));
    bad.close();
    resolve();
  }, 2500);
});

// --- B connects for real and subscribes.
const socket = io(WS, { transports: ['websocket'], auth: { token: B.accessToken }, reconnection: false });
const received = [];
for (const event of ['message.created', 'message.updated', 'message.deleted',
                     'message.receipt.updated', 'reaction.added', 'typing.started']) {
  socket.on(event, (payload) => received.push({ event, payload }));
}

await new Promise((resolve, reject) => {
  socket.on('connect', resolve);
  socket.on('connect_error', reject);
  setTimeout(() => reject(new Error('connect timeout')), 8000);
});
check('B authenticates the socket with the same bearer token', socket.connected);

const sub = await socket.emitWithAck('conversation.subscribe', { conversationId: conv.id });
check('the server authorizes the room join', sub.ok === true, JSON.stringify(sub));

const refused = await socket.emitWithAck('conversation.subscribe', {
  conversationId: '00000000-0000-0000-0000-000000000000',
});
check('a conversation the actor cannot read is refused', refused.ok === false, JSON.stringify(refused));

// --- A sends over HTTP; B must receive it on the socket.
const sent = await call('POST', `/conversations/${conv.id}/messages`, {
  token: A.accessToken, body: { body: 'realtime هنا', clientMessageId: crypto.randomUUID() },
});
const waitFor = async (event, ms = 8000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hit = received.find((r) => r.event === event);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
};

const created = await waitFor('message.created');
check('B receives message.created without refetching anything',
  created?.payload?.messageId === sent.id, JSON.stringify(created));
check('the event carries no body — the read path decides what B may see',
  created && !('body' in created.payload), JSON.stringify(created?.payload));

// --- A edits; B receives the update with the new body.
await call('PATCH', `/conversations/${conv.id}/messages/${sent.id}`, {
  token: A.accessToken, body: { body: 'realtime هنا (معدلة)' },
});
const updated = await waitFor('message.updated');
check('B receives message.updated carrying the new body',
  updated?.payload?.body === 'realtime هنا (معدلة)', JSON.stringify(updated));

// --- B acknowledges delivery over the SOCKET; A's receipt advances.
const ack = await socket.emitWithAck('message.delivered', { messageIds: [sent.id] });
check('the socket carries the delivery acknowledgement', ack.updated === 1, JSON.stringify(ack));
const receipt = await waitFor('message.receipt.updated');
check('the receipt transition is broadcast',
  receipt?.payload?.state === 'delivered', JSON.stringify(receipt));

// --- A reacts; B receives it.
await call('POST', `/conversations/${conv.id}/messages/${sent.id}/reactions`, {
  token: A.accessToken, body: { emoji: '👍' },
});
const reaction = await waitFor('reaction.added');
check('B receives the reaction with its emoji and actor',
  reaction?.payload?.emoji === '👍' && reaction.payload.actorId === ids.parent,
  JSON.stringify(reaction));

// --- A deletes for everyone; B receives the withdrawal.
await call('DELETE', `/conversations/${conv.id}/messages/${sent.id}?reason=smoke`, { token: A.accessToken });
const deleted = await waitFor('message.deleted');
check('B receives message.deleted', deleted?.payload?.deletedForAll === true, JSON.stringify(deleted));

socket.close();
console.log(failures === 0 ? '\nREALTIME SMOKE: ALL PASS' : `\nREALTIME SMOKE: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
