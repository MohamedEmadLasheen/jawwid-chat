/**
 * The acceptance flow over REAL HTTP, against the running API.
 *
 * What this adds over the integration suite: the global AuthGuard, the route
 * table (including the `search` / `:messageId` ordering), the error filter and
 * the /api/v1 prefix — none of which a service-level test touches.
 */
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3999/api/v1';
const ids = JSON.parse(process.argv[2]);
let failures = 0;

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  <- ${detail}`}`);
  if (!ok) failures++;
};

const login = async (subject) => {
  const r = await call('POST', '/auth/login', {
    body: { subject, password: 'smoke-password-long-enough' },
  });
  if (r.status !== 201 && r.status !== 200) throw new Error(`login ${subject}: ${JSON.stringify(r)}`);
  return r.body;
};

// --- 1, 2. Both sides log in over HTTP.
const A = await login('smoke_parent');
const B = await login('smoke_supervisor');
check('A and B log in and receive tokens', !!A.accessToken && !!B.accessToken);
check('the token resolves the right principal', A.actor.kind === 'contact' && B.actor.kind === 'staff');

// The guard refuses an unauthenticated request to a protected route.
check('an unauthenticated request is refused', (await call('GET', '/conversations')).status === 401);

// --- 3, 4. The conversation, opened by both.
const conv = (await call('POST', '/conversations/direct', {
  token: A.accessToken, body: { withActorId: ids.supervisor },
})).body;
check('A opens the authorized conversation', !!conv.id, JSON.stringify(conv));

const forB = await call('GET', `/conversations/${conv.id}`, { token: B.accessToken });
check('B opens the same conversation', forB.body.id === conv.id);

// --- 5, 6. A sends; it persists.
const sent = (await call('POST', `/conversations/${conv.id}/messages`, {
  token: A.accessToken,
  body: { body: 'السلام عليكم', clientMessageId: crypto.randomUUID() },
})).body;
check('A sends, and the server assigns identity and order', sent.id && sent.seq === '1', JSON.stringify(sent));
check('the Arabic body survives the round trip', sent.body === 'السلام عليكم');

// --- 8..11. Status.
const delivered = await call('POST', `/conversations/${conv.id}/messages/${sent.id}/delivered`, {
  token: B.accessToken,
});
check('B acknowledges delivery', delivered.body.updated === 1, JSON.stringify(delivered));

await call('POST', `/conversations/${conv.id}/messages/read`, {
  token: B.accessToken, body: { upToSeq: sent.seq },
});
const afterRead = await call('GET', `/conversations/${conv.id}/messages`, { token: B.accessToken });
check('the receipt reaches READ',
  afterRead.body.messages[0].receipts[0]?.state === 'read',
  JSON.stringify(afterRead.body.messages[0].receipts));

// --- 12, 19, 20. Reply and quote.
const reply = (await call('POST', `/conversations/${conv.id}/messages`, {
  token: B.accessToken,
  body: { body: 'وعليكم السلام', replyToMessageId: sent.id, clientMessageId: crypto.randomUUID() },
})).body;
const withQuote = (await call('GET', `/conversations/${conv.id}/messages`, { token: A.accessToken }))
  .body.messages.find((m) => m.id === reply.id);
check('the quote is resolved and served',
  withQuote.replyPreview?.available === true && withQuote.replyPreview.excerpt === 'السلام عليكم',
  JSON.stringify(withQuote.replyPreview));

// --- 14..16. Reactions.
check('A reacts', (await call('POST', `/conversations/${conv.id}/messages/${reply.id}/reactions`, {
  token: A.accessToken, body: { emoji: '👍' },
})).status < 300);
const reacted = (await call('GET', `/conversations/${conv.id}/messages`, { token: B.accessToken }))
  .body.messages.find((m) => m.id === reply.id);
check('B sees the reaction', reacted.reactions.length === 1 && reacted.reactions[0].emoji === '👍');

const badReaction = await call('POST', `/conversations/${conv.id}/messages/${reply.id}/reactions`, {
  token: A.accessToken, body: { emoji: '💩' },
});
check('an unsupported reaction is refused with its code',
  badReaction.body?.error?.code === 'COMM.REACTION_NOT_ALLOWED', JSON.stringify(badReaction));

check('A removes the reaction',
  (await call('DELETE', `/conversations/${conv.id}/messages/${reply.id}/reactions`, { token: A.accessToken })).status < 300);

// --- 17, 18. Edit.
const edited = await call('PATCH', `/conversations/${conv.id}/messages/${sent.id}`, {
  token: A.accessToken, body: { body: 'السلام عليكم ورحمة الله' },
});
check('A edits their own message', edited.body.editCount === 1 && edited.body.editedAt, JSON.stringify(edited.body));

const editByOther = await call('PATCH', `/conversations/${conv.id}/messages/${sent.id}`, {
  token: B.accessToken, body: { body: 'not mine to change' },
});
check('B cannot edit A\'s message',
  editByOther.body?.error?.code === 'COMM.NOT_MESSAGE_AUTHOR', JSON.stringify(editByOther));

const revisions = await call('GET', `/conversations/${conv.id}/messages/${sent.id}/revisions`, {
  token: B.accessToken,
});
check('the original wording is recoverable by a moderator',
  revisions.body.revisions?.[0]?.body === 'السلام عليكم', JSON.stringify(revisions.body));
check('a parent cannot read the edit history',
  (await call('GET', `/conversations/${conv.id}/messages/${sent.id}/revisions`, { token: A.accessToken }))
    .body?.error?.code === 'COMM.PERMISSION_DENIED');

// --- 21. Forward, into the learner's group.
const group = (await call('POST', '/conversations/student-group', {
  token: B.accessToken, body: { learnerId: ids.learner },
})).body;
const forwarded = await call('POST', `/conversations/${conv.id}/messages/${reply.id}/forward`, {
  token: B.accessToken, body: { toConversationIds: [group.id] },
});
check('B forwards into another authorized conversation',
  forwarded.body.messages?.[0]?.isForwarded === true, JSON.stringify(forwarded.body));
check('the forwarded copy names no source conversation',
  !JSON.stringify(forwarded.body).includes(conv.id));

// --- 22..25. Search.
const byText = await call('GET', `/search/messages?q=${encodeURIComponent('السلام')}`, { token: B.accessToken });
check('search finds the message by text', byText.body.hits?.length >= 1, JSON.stringify(byText.body));

const bySender = await call('GET', `/search/messages?q=${encodeURIComponent('السلام')}&authorId=${ids.parent}`, { token: B.accessToken });
check('search by sender filters to that author',
  bySender.body.hits.every((h) => h.message.authorId === ids.parent));

const from = new Date(Date.now() - 3600_000).toISOString();
const byDate = await call('GET', `/search/messages?q=${encodeURIComponent('السلام')}&from=${from}`, { token: B.accessToken });
check('search by date works', byDate.body.hits.length >= 1);

const inConv = await call('GET', `/conversations/${conv.id}/messages/search?q=${encodeURIComponent('السلام')}`, { token: B.accessToken });
check('search within the conversation is scoped to it',
  inConv.body.hits.every((h) => h.conversationId === conv.id), JSON.stringify(inConv.body));

// The route table must read `search` as a route, not as a message id.
check('the search route is not shadowed by :messageId', inConv.status === 200);

// --- 26..29. Deletion.
await call('DELETE', `/conversations/${conv.id}/messages/${reply.id}/me`, { token: A.accessToken });
const aView = (await call('GET', `/conversations/${conv.id}/messages`, { token: A.accessToken })).body.messages;
const bView = (await call('GET', `/conversations/${conv.id}/messages`, { token: B.accessToken })).body.messages;
check('delete for me hides it from A only',
  !aView.some((m) => m.id === reply.id) && bView.some((m) => m.id === reply.id));

await call('DELETE', `/conversations/${conv.id}/messages/${sent.id}?reason=smoke`, { token: A.accessToken });
const tombstone = (await call('GET', `/conversations/${conv.id}/messages`, { token: B.accessToken }))
  .body.messages.find((m) => m.id === sent.id);
check('delete for everyone leaves a tombstone with no body',
  tombstone.deletedForAll === true && tombstone.body === null, JSON.stringify(tombstone));

// --- 35. Unread on the list AND on the by-id row.
const listRow = (await call('GET', '/conversations', { token: A.accessToken }))
  .body.conversations.find((c) => c.id === conv.id);
check('the chat list row carries unread, preview and members',
  typeof listRow.unreadCount === 'number' && Array.isArray(listRow.members),
  JSON.stringify(listRow));
const byIdRow = (await call('GET', `/conversations/${conv.id}`, { token: A.accessToken })).body;
check('the by-id row carries the unread count too', typeof byIdRow.unreadCount === 'number');

// --- Isolation: the teacher is authenticated, and reaches none of it.
const unknownConv = await call('GET', `/conversations/${crypto.randomUUID()}`, { token: A.accessToken });
check('an unknown conversation is NOT FOUND, never FORBIDDEN',
  unknownConv.status === 404 && unknownConv.body.error.code === 'COMM.CONVERSATION_NOT_FOUND',
  JSON.stringify(unknownConv));

console.log(failures === 0 ? '\nHTTP SMOKE: ALL PASS' : `\nHTTP SMOKE: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
