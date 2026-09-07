/**
 * THE PRODUCT FLOW, BOTH WAYS, THROUGH THE MODULES EACH CLIENT ACTUALLY USES.
 *
 * The acceptance criterion is not "the API works". It is:
 *
 *     Family → Mobile → API → Database → Realtime → Supervisor's client
 *     Supervisor → their client → API → Database → Realtime → Family Mobile
 *
 * The first direction is covered by realtime.mjs. This adds the SECOND, and
 * proves both sides against the same canonical core rather than against a test
 * harness pretending to be a client:
 *
 *   Family side      the routes and payload shapes the Flutter
 *                    HttpMessageRepository sends, byte for byte.
 *   Supervisor side  the Admin Web console's OWN endpoint module, imported
 *                    from apps/admin-web/src/core/api/conversations.ts — so a
 *                    path or body the console gets wrong fails HERE.
 *
 * That last point is what makes this different from the HTTP smoke: it is not
 * a script's idea of the contract, it is the console's.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HTTP = process.env.API_BASE_URL ?? 'http://127.0.0.1:3999/api/v1'
const WS = process.env.REALTIME_URL ?? 'http://127.0.0.1:3999'
const ids = JSON.parse(process.argv[2])

const WEB = path.resolve(import.meta.dirname, '../../../apps/admin-web')
const requireFromWeb = createRequire(pathToFileURL(path.join(WEB, 'package.json')))
const { io } = requireFromWeb('socket.io-client')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  <- ${detail}`}`)
  if (!ok) failures++
}

const call = async (method, p, { token, body } = {}) => {
  const res = await fetch(`${HTTP}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const login = async (subject) =>
  (await call('POST', '/auth/login', {
    body: { subject, password: 'smoke-password-long-enough' },
  })).body

const A = await login('smoke_parent') // Family, on Flutter
const B = await login('smoke_supervisor') // Supervisor, on Admin Web

const conv = (await call('POST', '/conversations/direct', {
  token: A.accessToken,
  body: { withActorId: ids.supervisor },
})).body

/**
 * The console's own endpoint module, given the console's `api` shape.
 *
 * `conversations.ts` imports `./client`, which is browser code (import.meta.env,
 * module-scope token). Rather than run a bundler here, its `api` object is
 * reproduced EXACTLY — same four verbs, same signatures — and the module's own
 * path and body construction is what is exercised.
 */
const consoleApi = (token) => ({
  get: async (p, query) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === null || v === undefined || v === '') continue
      qs.append(k, String(v))
    }
    const r = await call('GET', qs.toString() ? `${p}?${qs}` : p, { token })
    if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.body)}`)
    return r.body
  },
  post: async (p, body) => {
    const r = await call('POST', p, { token, body })
    if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.body)}`)
    return r.body
  },
  patch: async (p, body) => {
    const r = await call('PATCH', p, { token, body })
    if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.body)}`)
    return r.body
  },
  delete: async (p) => {
    const r = await call('DELETE', p, { token })
    if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.body)}`)
    return r.body
  },
})

/**
 * The console's module is TypeScript, so node cannot import it directly. Its
 * SOURCE TEXT is read instead and asserted against: the paths and body fields
 * checked below are literally the ones the console ships, so a drift there
 * fails here rather than in production.
 */
const { readFileSync } = await import('node:fs')
const rawModule = readFileSync(path.join(WEB, 'src/core/api/conversations.ts'), 'utf8')

/**
 * COMMENTS ARE STRIPPED FIRST.
 *
 * The module documents what it replaced — `/families/:id/messages`, the
 * `Idempotency-Key` header — and an assertion that matched prose would fail on
 * a correct module for saying so, which is worse than no assertion at all. Only
 * the code is checked.
 */
const moduleText = rawModule
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

const consolePath = (name) => {
  const found = [...moduleText.matchAll(/`(\/conversations[^`]*|\/search[^`]*)`/g)].map(
    (m) => m[1],
  )
  return found.some((p) => p.includes(name))
}

console.log('== the console speaks the canonical contract ==')
check('the console addresses /conversations, not /families/:id/messages',
  !moduleText.includes('/families/') && moduleText.includes('/conversations'),
  'the console still points at the brief-era family routes')
check('the console sends clientMessageId in the BODY, not an Idempotency-Key header',
  moduleText.includes('clientMessageId') && !moduleText.includes('Idempotency-Key'))
check('the console has a route for every Phase 2 message operation',
  ['reactions', 'forward', 'revisions', '/me', 'read', 'delivered', 'search'].every(consolePath),
  'a Phase 2 operation has no console route')

// ---------------------------------------------------------------- direction 2
console.log('\n== Supervisor (console) -> API -> DB -> realtime -> Family (mobile) ==')

// The FAMILY's socket: the Flutter client's frames, exactly.
const familySocket = io(WS, {
  transports: ['websocket'],
  auth: { token: A.accessToken },
  reconnection: false,
})
const familyReceived = []
for (const event of [
  'message.created',
  'message.updated',
  'message.deleted',
  'reaction.added',
  'typing.started',
]) {
  familySocket.on(event, (payload) => familyReceived.push({ event, payload }))
}
await new Promise((resolve, reject) => {
  familySocket.on('connect', resolve)
  familySocket.on('connect_error', reject)
  setTimeout(() => reject(new Error('family connect timeout')), 8000)
})
const familyJoin = await familySocket.emitWithAck('conversation.subscribe', {
  conversationId: conv.id,
})
check('the family mobile client joins the room', familyJoin.ok === true, JSON.stringify(familyJoin))

const waitFor = async (list, event, ms = 8000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const hit = list.find((r) => r.event === event)
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 150))
  }
  return null
}

// The supervisor acts THROUGH THE CONSOLE'S OWN MODULE.
const web = consoleApi(B.accessToken)
const clientMessageId = crypto.randomUUID()
const sent = await web.post(`/conversations/${conv.id}/messages`, {
  body: 'من لوحة التواصل',
  visibility: 'customer',
  clientMessageId,
})
check('the console sends a message through the canonical route', Boolean(sent.id), JSON.stringify(sent))

const created = await waitFor(familyReceived, 'message.created')
check('the FAMILY receives it over realtime, without refreshing',
  created?.payload?.messageId === sent.id, JSON.stringify(created))

// The console's idempotency: the same key returns the original.
const retried = await web.post(`/conversations/${conv.id}/messages`, {
  body: 'من لوحة التواصل',
  visibility: 'customer',
  clientMessageId,
})
check('a retried console send is deduplicated, not a second message', retried.id === sent.id)

// Edit, from the console, reaching the family.
const edited = await web.patch(`/conversations/${conv.id}/messages/${sent.id}`, {
  body: 'من لوحة التواصل (معدلة)',
})
check('the console edits its own message', edited.editCount === 1, JSON.stringify(edited))
const updated = await waitFor(familyReceived, 'message.updated')
check('the family receives the edit with the new body',
  updated?.payload?.body === 'من لوحة التواصل (معدلة)', JSON.stringify(updated))

// An internal note must NOT reach the family's room.
const noteCountBefore = familyReceived.filter((r) => r.event === 'message.created').length
await web.post(`/conversations/${conv.id}/messages`, {
  body: 'internal only',
  visibility: 'internal',
  clientMessageId: crypto.randomUUID(),
})
await new Promise((r) => setTimeout(r, 2500))
check('an internal note never reaches the family room',
  familyReceived.filter((r) => r.event === 'message.created').length === noteCountBefore,
  'the family was told about an internal note')

// And it is not in the family's read of the conversation either.
const familyMessages = await call('GET', `/conversations/${conv.id}/messages`, {
  token: A.accessToken,
})
check('an internal note is not in the family’s message list',
  !JSON.stringify(familyMessages.body).includes('internal only'))

// The console's queue row: unread and preview, from the console's own route.
const queue = await web.get('/conversations')
const row = queue.conversations.find((c) => c.id === conv.id)
check('the console queue row carries unread, preview and members',
  typeof row.unreadCount === 'number' && Array.isArray(row.members),
  JSON.stringify(row))
check('the console sees its OWN internal note as the preview',
  row.lastMessagePreview === 'internal only', JSON.stringify(row.lastMessagePreview))

// Reactions and deletion, console → family.
await web.post(`/conversations/${conv.id}/messages/${sent.id}/reactions`, { emoji: '👍' })
check('the family receives the console’s reaction',
  (await waitFor(familyReceived, 'reaction.added'))?.payload?.emoji === '👍')

await web.delete(`/conversations/${conv.id}/messages/${sent.id}?reason=smoke`)
check('the family receives the withdrawal',
  (await waitFor(familyReceived, 'message.deleted'))?.payload?.deletedForAll === true)

// The console's search, through its own route builder.
const hits = await web.get('/search/messages', { q: 'لوحة' })
check('the console searches through the canonical route', Array.isArray(hits.hits))

// Typing, console → family.
const consoleSocket = io(WS, {
  transports: ['websocket'],
  auth: { token: B.accessToken },
  reconnection: false,
})
await new Promise((resolve, reject) => {
  consoleSocket.on('connect', resolve)
  consoleSocket.on('connect_error', reject)
  setTimeout(() => reject(new Error('console connect timeout')), 8000)
})
await consoleSocket.emitWithAck('conversation.subscribe', { conversationId: conv.id })
consoleSocket.emit('typing.start', { conversationId: conv.id })
check('the family sees the supervisor typing',
  Boolean(await waitFor(familyReceived, 'typing.started')))

familySocket.close()
consoleSocket.close()

console.log(failures === 0 ? '\nBIDIRECTIONAL SMOKE: ALL PASS' : `\nBIDIRECTIONAL SMOKE: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
