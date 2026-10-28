import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { chatCopy } from './copy'
import { renderWithProviders, makeStaff } from '@/test/utils'
import type { ChatConversation, ChatMessage, ChatTheme } from './chatApi'

/**
 * The session's socket, as the chat workspace sees it. Records what the page
 * asked the server for and lets a test play the server's events.
 */
type Handler = (payload: unknown) => void
const fakeSocket = {
  connected: true,
  handlers: new Map<string, Set<Handler>>(),
  emitted: [] as Array<{ event: string; payload: unknown }>,
  subscribeAnswers: [] as Array<{ ok: boolean; code?: string }>,
  on(event: string, h: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(h)
  },
  off(event: string, h: Handler) {
    this.handlers.get(event)?.delete(h)
  },
  emit(event: string, payload: unknown) {
    this.emitted.push({ event, payload })
  },
  timeout() {
    return {
      emitWithAck: async (event: string, payload: unknown) => {
        fakeSocket.emitted.push({ event, payload })
        return fakeSocket.subscribeAnswers.shift() ?? { ok: true }
      },
    }
  },
  /** The server publishes an event to this socket. */
  serverEmits(event: string, payload: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(payload)
  },
  listenerCount(event: string) {
    return this.handlers.get(event)?.size ?? 0
  },
  reset() {
    this.handlers.clear()
    this.emitted = []
    this.subscribeAnswers = []
    this.connected = true
  },
}

vi.mock('@/core/realtime/RealtimeProvider', () => ({
  useRealtime: () => ({ state: 'connected', hasEverConnected: true, socket: fakeSocket }),
}))

// A wallpaper is prepared on a canvas, which jsdom does not have: the test
// stands in for that one step and checks everything around it.
vi.mock('@/features/profile/photo', async (original) => ({
  ...(await original<typeof import('@/features/profile/photo')>()),
  prepareWallpaper: vi.fn(async () => ({ blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }), previewUrl: 'blob:wall' })),
}))

// Imported after the mock.
const { ChatPage } = await import('./ChatPage')

const ADMIN = makeStaff({ id: 'staff_a', role: 'admin' })

function conv(id: string, over: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id,
    type: 'student_group',
    familyId: 'fam-1',
    learnerId: 'l-1',
    title: `Group ${id}`,
    state: 'open',
    needsReply: false,
    lastSeq: '2',
    lastActivityAt: '2026-10-14T08:00:00.000Z',
    archivedAt: null,
    unreadCount: 0,
    ...over,
  }
}

function msg(id: string, seq: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    conversationId: 'c1',
    seq: String(seq),
    authorKind: 'contact',
    authorId: 'parent-1',
    authorDisplayName: 'Parent One',
    type: 'text',
    body: `body ${id}`,
    visibility: 'customer',
    moderation: 'published',
    clientMessageId: null,
    deletedForAll: false,
    createdAt: '2026-10-14T08:00:00.000Z',
    attachments: [],
    ...over,
  }
}

/** A tiny in-memory API: GET list, GET conversation, GET/POST messages, POST read. */
function stubApi(state: {
  conversations: ChatConversation[]
  messages: Record<string, ChatMessage[]>
  failSend?: { status: number; code: string; message: string } | null
  /** PD-37: what GET /presence answers. */
  presence?: Array<{ actorId: string; online: boolean; lastSeenAt: string | null }>
  /** PD-37: what GET …/messages/:id/info answers, by message id. */
  info?: Record<string, unknown>
}) {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const path = url.pathname.replace(/^\/api\/v1/, '')
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path, body })

      if (path === '/me') return json(ADMIN)
      if (path === '/conversations' && method === 'GET') return json({ conversations: state.conversations })
      if (path === '/presence') return json({ presence: state.presence ?? [] })
      const info = path.match(/^\/conversations\/[^/]+\/messages\/([^/]+)\/info$/)
      if (info) {
        const found = state.info?.[decodeURIComponent(info[1]!)]
        return found ? json(found) : json({ error: { code: 'COMM.NOT_MESSAGE_AUTHOR', message: 'no' } }, 403)
      }
      const m = path.match(/^\/conversations\/([^/]+)(\/messages(\/read)?)?$/)
      if (m) {
        const id = decodeURIComponent(m[1]!)
        if (!m[2]) return json(state.conversations.find((c) => c.id === id) ?? {}, 200)
        if (m[3]) return json({ ok: true })
        if (method === 'GET') {
          const all = [...(state.messages[id] ?? [])].sort((a, b) => Number(b.seq) - Number(a.seq))
          return json({ messages: all.slice(0, 50), nextBefore: null })
        }
        if (state.failSend) {
          return json({ error: { code: state.failSend.code, message: state.failSend.message } }, state.failSend.status)
        }
        const list = (state.messages[id] ??= [])
        const existing = list.find((x) => x.clientMessageId === body.clientMessageId)
        if (existing) return json(existing)
        const saved = msg(`srv-${list.length + 100}`, list.length + 100, {
          conversationId: id,
          authorKind: 'staff',
          authorId: ADMIN.id,
          body: body.body,
          visibility: body.visibility,
          clientMessageId: body.clientMessageId,
        })
        list.push(saved)
        return json(saved, 201)
      }
      return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
    }),
  )
  return calls
}

function renderChat(route = '/chat') {
  return renderWithProviders(
    <Routes>
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/chat/:conversationId" element={<ChatPage />} />
    </Routes>,
    { route, staff: ADMIN },
  )
}

describe('Admin chat workspace', () => {
  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it('lists the conversations the SERVER returned and subscribes to each, once', async () => {
    stubApi({ conversations: [conv('c1'), conv('c2', { title: 'Second', unreadCount: 3 })], messages: {} })
    renderChat()

    expect(await screen.findByText('Group c1')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getByLabelText('3 unread')).toBeInTheDocument()

    await waitFor(() => {
      const subs = fakeSocket.emitted.filter((e) => e.event === 'conversation.subscribe')
      expect(subs.map((s) => (s.payload as { conversationId: string }).conversationId).sort()).toEqual(['c1', 'c2'])
    })
  })

  it('opens on "Waiting for a reply" from the Dashboard: exactly the rows the waiting tile counts (PD-44)', async () => {
    stubApi({
      conversations: [
        conv('c1', { title: 'Parent wrote last', state: 'waiting_on_jawwid', needsReply: true }),
        conv('c2', { title: 'We answered', state: 'waiting_on_customer' }),
        conv('c3', { title: 'Resolved while waiting', state: 'resolved', needsReply: true }),
        conv('c4', { title: 'Closed conversation', state: 'waiting_on_jawwid', needsReply: true, archivedAt: '2026-10-20T08:00:00.000Z' }),
        // Archived by this viewer only: the server still counts it, so the view shows it.
        conv('c5', { title: 'Put away by me', state: 'waiting_on_jawwid', needsReply: true, viewerState: { archived: true } as ChatConversation['viewerState'] }),
      ],
      messages: {},
    })
    renderChat('/chat?view=waiting')

    const chip = await screen.findByRole('button', { name: /Waiting for a reply/ })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Parent wrote last')).toBeInTheDocument()
    expect(screen.getByText('Put away by me')).toBeInTheDocument()
    expect(screen.queryByText('We answered')).not.toBeInTheDocument()
    expect(screen.queryByText('Resolved while waiting')).not.toBeInTheDocument()
    expect(screen.queryByText('Closed conversation')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect(await screen.findByText('We answered')).toBeInTheDocument()
  })

  it('offers "Waiting for a reply" only while something waits', async () => {
    stubApi({ conversations: [conv('c1', { state: 'waiting_on_customer' })], messages: {} })
    renderChat()
    await screen.findByText('Group c1')
    expect(screen.queryByRole('button', { name: /Waiting for a reply/ })).not.toBeInTheDocument()
  })

  it('renders a thread in server (seq) order, numerically', async () => {
    stubApi({
      conversations: [conv('c1')],
      messages: { c1: [msg('m10', 10), msg('m9', 9), msg('m2', 2)] },
    })
    renderChat('/chat/c1')

    await screen.findByText('body m10')
    const seqs = [...document.querySelectorAll('[data-seq]')].map((a) => a.getAttribute('data-seq'))
    expect(seqs).toEqual(['2', '9', '10'])
  })

  it('a message.created event re-reads the thread from the server; nothing comes from the payload', async () => {
    const state = { conversations: [conv('c1')], messages: { c1: [msg('m1', 1)] } }
    stubApi(state)
    renderChat('/chat/c1')
    await screen.findByText('body m1')

    state.messages.c1.push(msg('m2', 2, { body: 'reply from the teacher', authorKind: 'teacher' }))
    act(() => {
      fakeSocket.serverEmits('message.created', { conversationId: 'c1', messageId: 'm2', seq: '2', body: 'FORGED' })
    })

    expect(await screen.findByText('reply from the teacher')).toBeInTheDocument()
    expect(screen.queryByText('FORGED')).not.toBeInTheDocument()
  })

  it('a sent message appears ONCE: the pending echo is replaced by the server copy', async () => {
    const state = { conversations: [conv('c1')], messages: { c1: [msg('m1', 1)] } }
    const calls = stubApi(state)
    renderChat('/chat/c1')
    await screen.findByText('body m1')

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello parent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(document.querySelector('[data-pending]')).toBeNull())
    expect(screen.getAllByText('hello parent')).toHaveLength(1)
    const post = calls.find((c) => c.method === 'POST' && c.path === '/conversations/c1/messages')!
    expect((post.body as { clientMessageId: string }).clientMessageId).toMatch(/[0-9a-f-]{36}/)
  })

  it('a refused send is shown as NOT sent with the server reason, and Retry reuses the same id', async () => {
    const state: Parameters<typeof stubApi>[0] = {
      conversations: [conv('c1')],
      messages: { c1: [] },
      failSend: { status: 403, code: 'COMM.NOT_ON_DUTY', message: 'staff is not on duty for this family' },
    }
    const calls = stubApi(state)
    renderChat('/chat/c1')
    await screen.findByText('No messages yet.')

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'will fail' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Not sent')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('staff is not on duty for this family')

    state.failSend = null
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByText('Not sent')).toBeNull())

    const posts = calls.filter((c) => c.method === 'POST' && c.path === '/conversations/c1/messages')
    expect(posts).toHaveLength(2)
    expect((posts[0]!.body as { clientMessageId: string }).clientMessageId).toBe(
      (posts[1]!.body as { clientMessageId: string }).clientMessageId,
    )
    expect(screen.getAllByText('will fail')).toHaveLength(1)
  })

  it('marks the conversation read up to the newest seq on screen', async () => {
    const calls = stubApi({ conversations: [conv('c1')], messages: { c1: [msg('m1', 1), msg('m7', 7)] } })
    renderChat('/chat/c1')
    await screen.findByText('body m7')

    await waitFor(() => {
      const read = calls.find((c) => c.path === '/conversations/c1/messages/read')
      expect(read?.body).toEqual({ upToSeq: '7' })
    })
  })

  it('unmounting removes exactly its listeners and unsubscribes: a remount does not stack handlers', async () => {
    stubApi({ conversations: [conv('c1')], messages: {} })
    const first = renderChat()
    await screen.findByText('Group c1')
    expect(fakeSocket.listenerCount('message.created')).toBe(1)

    first.unmount()
    expect(fakeSocket.listenerCount('message.created')).toBe(0)
    expect(fakeSocket.listenerCount('connect')).toBe(0)
    expect(fakeSocket.emitted.some((e) => e.event === 'conversation.unsubscribe')).toBe(true)

    renderChat()
    await screen.findByText('Group c1')
    expect(fakeSocket.listenerCount('message.created')).toBe(1)
  })

  it('after a reconnect every held conversation is subscribed again (rooms do not survive one)', async () => {
    stubApi({ conversations: [conv('c1'), conv('c2')], messages: {} })
    renderChat()
    await screen.findByText('Group c2')
    await waitFor(() =>
      expect(fakeSocket.emitted.filter((e) => e.event === 'conversation.subscribe')).toHaveLength(2),
    )

    fakeSocket.emitted = []
    act(() => fakeSocket.serverEmits('connect', undefined))

    await waitFor(() =>
      expect(fakeSocket.emitted.filter((e) => e.event === 'conversation.subscribe')).toHaveLength(2),
    )
  })

  it('a subscribe that loses the handshake race is retried; a real refusal is not', async () => {
    fakeSocket.subscribeAnswers = [{ ok: false, code: 'COMM.UNKNOWN_ACTOR' }, { ok: true }]
    stubApi({ conversations: [conv('c1')], messages: {} })
    renderChat()
    await screen.findByText('Group c1')
    await waitFor(
      () => expect(fakeSocket.emitted.filter((e) => e.event === 'conversation.subscribe')).toHaveLength(2),
      { timeout: 2000 },
    )

    fakeSocket.reset()
    fakeSocket.subscribeAnswers = [{ ok: false, code: 'COMM.STAFF_OUT_OF_SCOPE' }]
    stubApi({ conversations: [conv('c9')], messages: {} })
    renderChat()
    await screen.findByText('Group c9')
    await new Promise((r) => setTimeout(r, 400))
    expect(
      fakeSocket.emitted.filter(
        (e) => e.event === 'conversation.subscribe' && (e.payload as { conversationId: string }).conversationId === 'c9',
      ),
    ).toHaveLength(1)
  })

  it('PD-14: no approve or reject anywhere -- a message held before it shows its badge only, and the queue is never asked for', async () => {
    const calls = stubApi({
      conversations: [conv('c1')],
      messages: { c1: [msg('t1', 1, { authorKind: 'teacher', body: 'lesson notes', moderation: 'pending' })] },
    })
    renderChat('/chat/c1')
    expect(await screen.findByText('Awaiting approval')).toBeInTheDocument()
    expect(screen.getByText('lesson notes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /reject/i })).toBeNull()
    expect(calls.some((c) => c.path.startsWith('/approvals'))).toBe(false)
  })

  it('a system message is rendered as words, never as its raw JSON', async () => {
    stubApi({
      conversations: [conv('c1')],
      messages: { c1: [msg('s1', 1, { authorKind: 'system', authorId: null, body: '{"kind":"group.created","learner":"Learner One"}' })] },
    })
    renderChat('/chat/c1')
    expect(await screen.findByText('Student Group created for Learner One')).toBeInTheDocument()
    expect(screen.queryByText(/"kind"/)).toBeNull()
  })

  it('rapid switching between conversations leaves one listener per event and one subscription per conversation', async () => {
    const convs = Array.from({ length: 5 }, (_, i) => conv(`c${i}`, { title: `Group c${i}` }))
    stubApi({ conversations: convs, messages: Object.fromEntries(convs.map((c) => [c.id, [msg(`m-${c.id}`, 1, { conversationId: c.id })]])) })
    renderChat('/chat/c0')
    await screen.findByText('body m-c0')

    for (let round = 0; round < 4; round++) {
      const list = screen.getByRole('list', { name: 'Conversations' })
      for (const c of convs) fireEvent.click(within(list).getByText(`Group ${c.id}`))
    }
    await screen.findByText('body m-c4')

    for (const event of ['message.created', 'conversation.updated', 'connect']) {
      expect(fakeSocket.listenerCount(event)).toBe(1)
    }
    const subscribes = fakeSocket.emitted.filter((e) => e.event === 'conversation.subscribe')
    expect(subscribes.map((x) => (x.payload as { conversationId: string }).conversationId).sort()).toEqual(
      convs.map((c) => c.id).sort(),
    )
    expect(fakeSocket.emitted.some((e) => e.event === 'conversation.unsubscribe')).toBe(false)
  })
})

describe('Super admin: a new 1:1 chat (PD-8)', () => {
  const SUPER = makeStaff({ id: 'staff_super', role: 'super_admin' })
  const user = (id: string, principalKind: string, displayName: string, isActive = true) => ({
    principalKind, id, displayName, staffRole: principalKind === 'staff' ? 'admin' : null,
    familyId: principalKind === 'contact' ? 'fam-1' : null, isActive, hasLogin: true,
    accountStatus: 'active', lastLoginAt: null, createdAt: '2026-10-01T00:00:00.000Z',
  })

  function stubSuperApi() {
    const conversations: ChatConversation[] = []
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api\/v1/, '')
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        calls.push({ method, path, body })
        if (path === '/me') return json(SUPER)
        if (path === '/admin/users') {
          return json({
            truncated: false,
            users: [
              user('t-1', 'teacher', 'Teacher Tamer'),
              user('p-1', 'contact', 'Parent Pakinam'),
              user('s-1', 'staff', 'Staff Samir'),
              user('t-2', 'teacher', 'Teacher Gone', false),
            ],
          })
        }
        if (path === '/conversations/direct' && method === 'POST') {
          const c = conv('d-1', { type: 'direct', title: null, learnerId: null, members: [] } as Partial<ChatConversation>)
          conversations.push(c)
          return json(c, 201)
        }
        if (path === '/conversations') return json({ conversations })
        const m = path.match(/^\/conversations\/([^/]+)(\/messages)?$/)
        if (m) return m[2] ? json({ messages: [], nextBefore: null }) : json(conversations.find((c) => c.id === m[1]) ?? {})
        return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
      }),
    )
    return calls
  }

  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it('offers active teachers and parents -- never staff -- and opens the chat the server returns', async () => {
    const calls = stubSuperApi()
    renderWithProviders(
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:conversationId" element={<ChatPage />} />
      </Routes>,
      { route: '/chat', staff: SUPER },
    )
    fireEvent.click(await screen.findByRole('button', { name: 'New chat or group' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New chat' }))
    const dialog = await screen.findByRole('dialog', { name: 'New chat' })
    expect(await within(dialog).findByText('Teacher Tamer')).toBeInTheDocument()
    expect(within(dialog).getByText('Parent Pakinam')).toBeInTheDocument()
    // Staff-to-staff is refused server-side, and an inactive person cannot be reached.
    expect(within(dialog).queryByText('Staff Samir')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Teacher Gone')).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search by name' }), { target: { value: 'pak' } })
    expect(within(dialog).queryByText('Teacher Tamer')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByText('Parent Pakinam'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls.find((c) => c.path === '/conversations/direct')).toMatchObject({ method: 'POST', body: { withActorId: 'p-1' } })
  })

  it('is not offered to an operator', async () => {
    stubApi({ conversations: [conv('c1')], messages: {} })
    renderChat()
    await screen.findByText('Group c1')
    // An operator's menu offers a family group, never a 1:1 with anyone.
    fireEvent.click(screen.getByRole('button', { name: 'New chat or group' }))
    expect(await screen.findByRole('menuitem', { name: 'New family group' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'New chat' })).not.toBeInTheDocument()
  })
})

describe('Chat workspace: message, chat and group actions', () => {
  type Call = { method: string; path: string; body: unknown; url: string }

  /** A small API for the actions: every request is recorded; the routes answer like the server. */
  function stubActions(state: { conversations: ChatConversation[]; messages: Record<string, ChatMessage[]> }) {
    const calls: Call[] = []
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input)
        const path = new URL(url, 'http://localhost').pathname.replace(/^\/api\/v1/, '')
        const method = init?.method ?? 'GET'
        const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body
        calls.push({ method, path, body, url })
        if (path === '/me') return json(ADMIN)
        if (path === '/org/group-candidates') {
          return json({
            families: [
              {
                familyId: 'fam-1',
                displayName: 'Family One',
                parents: [{ id: 'parent-1', name: 'Parent One' }, { id: 'parent-2', name: 'Parent Two' }],
                children: [{ id: 'l-1', name: 'Child', supervisor: { id: 'staff_a', name: 'Admin A' }, teacher: { id: 't-9', name: 'Teacher Nine' } }],
              },
            ],
          })
        }
        if (path.startsWith('/storage/') && method === 'PUT') return new Response(null, { status: 201 })
        if (path === '/conversations' && method === 'GET') return json({ conversations: state.conversations })
        const m = path.match(/^\/conversations\/([^/]+)(\/.*)?$/)
        if (m) {
          const id = decodeURIComponent(m[1]!)
          const rest = m[2] ?? ''
          if (!rest) return json(state.conversations.find((c) => c.id === id) ?? {})
          if (rest === '/preferences' || rest === '/members') return json({ ok: true })
          if (rest === '/messages/read') return json({ ok: true })
          if (rest === '/messages/attachments/authorize') {
            return json({ objectKey: 'k-1', uploadUrl: 'http://storage.test/api/v1/storage/k-1?sig=x', method: 'PUT', headers: {}, expiresAt: '2030-01-01T00:00:00Z' })
          }
          if (/^\/messages\/[^/]+\/reactions$/.test(rest)) return json({ ok: true })
          if (rest === '/messages' && method === 'GET') return json({ messages: [...(state.messages[id] ?? [])].reverse(), nextBefore: null })
          if (rest === '/messages' && method === 'POST') {
            const saved = msg('srv-1', 99, { conversationId: id, authorKind: 'staff', authorId: ADMIN.id, body: body.body ?? null, clientMessageId: body.clientMessageId })
            ;(state.messages[id] ??= []).push(saved)
            return json(saved, 201)
          }
        }
        return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
      }),
    )
    return calls
  }

  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it('replies: the quote shows above the box and the send carries replyToMessageId', async () => {
    const calls = stubActions({ conversations: [conv('c1')], messages: { c1: [msg('m1', 1)] } })
    renderChat('/chat/c1')
    await screen.findByText('body m1')

    fireEvent.click(screen.getByRole('button', { name: 'Message options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reply' }))
    expect(screen.getByText('Replying to Parent One')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'answer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/conversations/c1/messages')?.body).toMatchObject({
        body: 'answer',
        replyToMessageId: 'm1',
      }),
    )
    expect(screen.queryByText('Replying to Parent One')).not.toBeInTheDocument()
  })

  it('reacts from the menu, and tapping your own reaction takes it back', async () => {
    const calls = stubActions({
      conversations: [conv('c1')],
      messages: { c1: [msg('m1', 1, { reactions: [{ actorId: ADMIN.id, emoji: '❤️' }, { actorId: 'parent-1', emoji: '❤️' }] })] },
    })
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    // Two people reacted with the same emoji: one chip, counted, marked as mine.
    const chip = screen.getByRole('button', { name: '❤️ 2' })
    expect(chip).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Message options' }))
    fireEvent.click(await screen.findByRole('button', { name: 'React 👍' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/messages/m1/reactions'))?.body).toEqual({ emoji: '👍' }),
    )

    fireEvent.click(chip)
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/messages/m1/reactions'))).toBe(true))
  })

  it('pins from the row menu, and an archived chat leaves All for Archived', async () => {
    const calls = stubActions({
      conversations: [
        conv('c1'),
        conv('c2', { title: 'Old group', viewerState: { pinned: false, archived: true, mutedUntil: null } }),
      ],
      messages: {},
    })
    renderChat()
    await screen.findByText('Group c1')
    expect(screen.queryByText('Old group')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Archived/ }))
    expect(await screen.findByText('Old group')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /All/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Chat options: Group c1' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin chat' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/conversations/c1/preferences')).toMatchObject({ method: 'POST', body: { pinned: true } }),
    )
  })

  it('uploads an attachment to the signed URL without the bearer, then sends it', async () => {
    const calls = stubActions({ conversations: [conv('c1')], messages: { c1: [] } })
    renderChat('/chat/c1')
    await screen.findByLabelText('Message')

    const file = new File(['png-bytes'], 'photo.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('attach-media'), { target: { files: [file] } })
    expect(screen.getByText('photo.png')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/conversations/c1/messages')).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/attachments/authorize'))?.body).toMatchObject({ kind: 'image', mimeType: 'image/png', byteSize: 9 })
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe('http://storage.test/api/v1/storage/k-1?sig=x')
    const putInit = (vi.mocked(fetch).mock.calls.find(([u]) => String(u) === put.url)![1] ?? {}) as RequestInit
    expect(new Headers(putInit.headers).has('Authorization')).toBe(false)
    expect(calls.find((c) => c.method === 'POST' && c.path === '/conversations/c1/messages')?.body).toMatchObject({
      type: 'image',
      attachments: [{ kind: 'image', objectKey: 'k-1', mimeType: 'image/png', byteSize: 9, originalName: 'photo.png' }],
    })
  })

  it('adds a member to a group from the info panel, with a reason, offering only who is not in it', async () => {
    const calls = stubActions({
      conversations: [
        conv('c1', {
          type: 'family_group',
          members: [
            { actorId: 'staff_a', actorKind: 'staff', memberRole: 'admin', isSilent: false, displayName: 'Admin A' },
            { actorId: 'parent-1', actorKind: 'contact', memberRole: 'parent', isSilent: false, displayName: 'Parent One' },
          ],
        }),
      ],
      messages: { c1: [] },
    })
    renderChat('/chat/c1')
    await screen.findByLabelText('Message')

    fireEvent.click(screen.getByRole('button', { name: 'Conversation info' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add member' })
    expect(await within(dialog).findByText('Parent Two')).toBeInTheDocument()
    expect(within(dialog).getByText('Teacher Nine')).toBeInTheDocument()
    expect(within(dialog).queryByText('Parent One')).not.toBeInTheDocument()
    // No reason, no addition.
    expect(within(dialog).getByText('Parent Two').closest('button')).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Reason for adding'), { target: { value: 'second parent' } })
    fireEvent.click(within(dialog).getByText('Parent Two'))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/conversations/c1/members')?.body).toEqual({
        action: 'add',
        actorId: 'parent-2',
        actorKind: 'contact',
        memberRole: 'parent',
        reason: 'second parent',
      }),
    )
  })
})

describe('A trial group (trial journey)', () => {
  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it('"+" offers the Trial card in a trial group, and only there', async () => {
    stubApi({
      conversations: [conv('tg', { type: 'trial_group', title: 'Teacher One' }), conv('sg', { type: 'student_group' })],
      messages: { tg: [msg('m1', 1, { conversationId: 'tg' })], sg: [msg('m2', 2, { conversationId: 'sg' })] },
    })
    const { unmount } = renderChat('/chat/tg')
    await screen.findByText('body m1')
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    expect(screen.getByRole('menuitem', { name: 'Trial' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trial' }))
    expect(await screen.findByRole('dialog', { name: 'Trial' })).toBeInTheDocument()
    unmount()

    renderChat('/chat/sg')
    await screen.findByText('body m2')
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    expect(screen.getByRole('menuitem', { name: 'Photo or video' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Trial' })).not.toBeInTheDocument()
  })

  it('PD-32: a trial group carries the Trial label in the list and the header; a student group does not', async () => {
    stubApi({
      conversations: [conv('tg', { type: 'trial_group', title: 'Teacher One' }), conv('sg', { type: 'student_group', title: 'Group sg' })],
      messages: { tg: [msg('m1', 1, { conversationId: 'tg' })], sg: [msg('m2', 2, { conversationId: 'sg' })] },
    })
    renderChat('/chat/tg')
    await screen.findByText('body m1')
    const rows = screen.getAllByRole('button', { name: /Teacher One|Group sg/ }).filter((b) => b.classList.contains('conv-row'))
    const trialRow = rows.find((r) => r.textContent?.includes('Teacher One'))!
    const groupRow = rows.find((r) => r.textContent?.includes('Group sg'))!
    expect(within(trialRow).getByTestId('trial-badge')).toHaveTextContent('Trial')
    expect(within(groupRow).queryByTestId('trial-badge')).not.toBeInTheDocument()
    const head = document.querySelector('.thread-head') as HTMLElement
    expect(within(head).getByTestId('trial-badge')).toBeInTheDocument()
  })
})

describe('Who wrote it (WhatsApp layout)', () => {
  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it('in a group: picture and name once per run, colleagues on the left, the viewer never labelled', async () => {
    stubApi({
      conversations: [conv('c1', { type: 'family_group' })],
      messages: {
        c1: [
          msg('m1', 1, { authorId: 'parent-1', authorDisplayName: 'Parent One' }),
          msg('m2', 2, { authorId: 'parent-1', authorDisplayName: 'Parent One' }),
          msg('m3', 3, { authorKind: 'staff', authorId: 'staff_b', authorDisplayName: 'Colleague B' }),
          msg('m4', 4, { authorKind: 'staff', authorId: ADMIN.id, authorDisplayName: 'Admin A' }),
        ],
      },
    })
    renderChat('/chat/c1')
    await screen.findByText('body m4')

    const row = (id: string) => screen.getByText(`body ${id}`).closest('li')!
    // A run of two from one parent: named and pictured once, the second aligned under it.
    expect(within(row('m1')).getByText('Parent One')).toBeInTheDocument()
    expect(row('m1').querySelector('.cw-msg__avatar .avatar')).not.toBeNull()
    expect(within(row('m2')).queryByText('Parent One')).not.toBeInTheDocument()
    expect(row('m2').querySelector('.cw-msg__avatar .avatar')).toBeNull()
    expect(row('m2').querySelector('.cw-msg__avatar')).not.toBeNull()
    // A colleague is someone else: left side, named.
    expect(row('m3')).toHaveClass('bubble-row--contact')
    expect(within(row('m3')).getByText('Colleague B')).toBeInTheDocument()
    // The viewer: right side, no picture, no name.
    expect(row('m4')).toHaveClass('bubble-row--staff')
    expect(row('m4').querySelector('.cw-msg__avatar')).toBeNull()
    expect(within(row('m4')).queryByText('Admin A')).not.toBeInTheDocument()
  })

  it('in a 1:1 the viewer is in, the other person is the header, not a label on every message', async () => {
    stubApi({
      conversations: [
        conv('c1', {
          type: 'direct',
          title: null,
          members: [
            { actorId: ADMIN.id, actorKind: 'staff', memberRole: 'admin', isSilent: false, displayName: 'Admin A' },
            { actorId: 'parent-1', actorKind: 'contact', memberRole: 'parent', isSilent: false, displayName: 'Parent One' },
          ],
        }),
      ],
      messages: { c1: [msg('m1', 1)] },
    })
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    const row = screen.getByText('body m1').closest('li')!
    expect(row.querySelector('.cw-msg__avatar')).toBeNull()
    expect(within(row).queryByText('Parent One')).not.toBeInTheDocument()
  })
})

describe('Profile photos', () => {
  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it("shows a sender's photo beside their message, and falls back to initials if it cannot load", async () => {
    stubApi({
      conversations: [conv('c1', { type: 'family_group' })],
      messages: { c1: [msg('m1', 1, { authorAvatarUrl: 'http://api.test/api/v1/media/avatars/contact.p.c1?s=x' })] },
    })
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    const row = screen.getByText('body m1').closest('li')!
    const img = row.querySelector('.cw-msg__avatar img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toBe('http://api.test/api/v1/media/avatars/contact.p.c1?s=x')
    fireEvent.error(img)
    await waitFor(() => expect(row.querySelector('.cw-msg__avatar img')).toBeNull())
    expect(within(row.querySelector('.cw-msg__avatar') as HTMLElement).getByText('PO')).toBeInTheDocument()
  })

  it("a 1:1 row shows the other person's photo; a child's group shows the child's", async () => {
    stubApi({
      conversations: [
        conv('d1', {
          type: 'direct',
          title: null,
          learnerId: null,
          members: [
            { actorId: ADMIN.id, actorKind: 'staff', memberRole: 'admin', isSilent: false, displayName: 'Admin A', avatarUrl: 'http://x/me' },
            { actorId: 'p1', actorKind: 'contact', memberRole: 'parent', isSilent: false, displayName: 'Parent P', avatarUrl: 'http://x/parent' },
          ],
        }),
        conv('g1', { title: 'Kid group', learner: { id: 'l-1', name: 'Kid', avatarUrl: 'http://x/kid' } }),
      ],
      messages: {},
    })
    renderChat()
    await screen.findByText('Kid group')
    const rowOf = (text: string) => screen.getByText(text).closest('li')!
    expect(rowOf('Parent P').querySelector('img')?.getAttribute('src')).toBe('http://x/parent')
    expect(rowOf('Kid group').querySelector('img')?.getAttribute('src')).toBe('http://x/kid')
  })
})

describe('Star and pin (group B)', () => {
  type Call = { method: string; path: string }
  function stubMarks(state: { messages: ChatMessage[]; pins: ChatMessage[]; starred: ChatMessage[] }) {
    const calls: Call[] = []
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api\/v1/, '')
        const method = init?.method ?? 'GET'
        calls.push({ method, path })
        if (path === '/me') return json(ADMIN)
        if (path === '/me/starred') {
          return json({ items: state.starred.map((m) => ({ starredAt: m.createdAt, conversationId: 'c1', message: { ...m, starred: true } })), nextBefore: null })
        }
        if (path === '/conversations') return json({ conversations: [conv('c1', { title: 'Kid group' })] })
        if (path === '/conversations/c1') return json(conv('c1', { title: 'Kid group' }))
        if (path === '/conversations/c1/messages/pins') {
          return json({ pins: state.pins.map((m) => ({ pinnedAt: m.createdAt, pinnedBy: 'x', message: { ...m, pinned: true } })) })
        }
        if (path === '/conversations/c1/messages') return json({ messages: [...state.messages].reverse(), nextBefore: null })
        if (/\/messages\/[^/]+\/(star|pin)$/.test(path) || path.endsWith('/messages/read')) return json({ ok: true })
        return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
      }),
    )
    return calls
  }

  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it('stars and pins from the message menu, and shows both marks', async () => {
    const calls = stubMarks({ messages: [msg('m1', 1), msg('m2', 2, { starred: true, pinned: true })], pins: [], starred: [] })
    renderChat('/chat/c1')
    await screen.findByText('body m1')

    const row2 = screen.getByText('body m2').closest('li')!
    expect(within(row2).getByLabelText('Starred')).toBeInTheDocument()
    expect(within(row2).getByLabelText('Pinned')).toBeInTheDocument()

    const row1 = screen.getByText('body m1').closest('li')!
    fireEvent.click(within(row1).getByRole('button', { name: 'Message options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Star' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/conversations/c1/messages/m1/star')).toBe(true))

    fireEvent.click(within(row1).getByRole('button', { name: 'Message options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin message' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/conversations/c1/messages/m1/pin')).toBe(true))

    // Already starred and pinned: the menu offers the undo.
    fireEvent.click(within(row2).getByRole('button', { name: 'Message options' }))
    expect(await screen.findByRole('menuitem', { name: 'Unstar' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Unpin message' })).toBeInTheDocument()
  })

  it('shows the newest pin in a bar; with several, the bar counts and moves on', async () => {
    const one = msg('m1', 1, { body: 'the schedule' })
    const two = msg('m2', 2, { body: 'the meeting link' })
    stubMarks({ messages: [one, two], pins: [one, two], starred: [] })
    renderChat('/chat/c1')
    const bar = await screen.findByRole('button', { name: /Pinned message 2 of 2/ })
    expect(within(bar).getByText('the meeting link')).toBeInTheDocument()
    fireEvent.click(bar)
    expect(await screen.findByRole('button', { name: /Pinned message 1 of 2/ })).toBeInTheDocument()
  })

  it('lists starred messages and opens the conversation a star is in', async () => {
    stubMarks({ messages: [msg('m1', 1)], pins: [], starred: [msg('s1', 9, { body: 'keep this one' })] })
    renderChat()
    await screen.findByText('Kid group')
    fireEvent.click(screen.getByRole('button', { name: 'Starred messages' }))
    const dialog = await screen.findByRole('dialog', { name: 'Starred messages' })
    fireEvent.click(await within(dialog).findByText('keep this one'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('body m1')).toBeInTheDocument()
  })
})

describe('Forward and select (group B)', () => {
  function stubForward(messages: ChatMessage[]) {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api\/v1/, '')
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        calls.push({ method, path, body })
        if (path === '/me') return json(ADMIN)
        if (path === '/conversations') {
          return json({ conversations: [conv('c1', { title: 'Kid group' }), conv('c2', { title: 'Second group' }), conv('c3', { title: 'Third group' })] })
        }
        if (path === '/conversations/c1') return json(conv('c1', { title: 'Kid group' }))
        if (path === '/conversations/c1/messages/pins') return json({ pins: [] })
        if (path === '/conversations/c1/messages') return json({ messages: [...messages].reverse(), nextBefore: null })
        if (path === '/conversations/c1/messages/forward') return json({ sent: [] })
        if (path.endsWith('/messages/read')) return json({ ok: true })
        return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
      }),
    )
    return calls
  }

  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it('labels a forwarded copy, and forwards one message from its menu to the chosen chats', async () => {
    const calls = stubForward([msg('m1', 1), msg('m2', 2, { forwarded: true })])
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    expect(within(screen.getByText('body m2').closest('li')!).getByText('Forwarded')).toBeInTheDocument()

    const row = screen.getByText('body m1').closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Message options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Forward' }))
    const dialog = await screen.findByRole('dialog', { name: 'Forward to…' })
    fireEvent.click(await within(dialog).findByText('Second group'))
    fireEvent.click(within(dialog).getByText('Third group'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to 2' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/conversations/c1/messages/forward')?.body).toEqual({ messageIds: ['m1'], toConversationIds: ['c2', 'c3'] }),
    )
    expect(await screen.findByText('Forwarded to 2 chats')).toBeInTheDocument()
  })

  it('select mode: choose several, then forward them together', async () => {
    const calls = stubForward([msg('m1', 1), msg('m2', 2), msg('m3', 3)])
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Select messages' }))

    // Composer gives way to the selection bar; tapping a message selects it.
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('body m1'))
    fireEvent.click(screen.getByText('body m3'))
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    const bar = screen.getByRole('toolbar', { name: '2 selected' })
    fireEvent.click(within(bar).getByRole('button', { name: /Forward/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Forward to…' })
    fireEvent.click(await within(dialog).findByText('Second group'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to 1' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/conversations/c1/messages/forward')?.body).toEqual({ messageIds: ['m1', 'm3'], toConversationIds: ['c2'] }),
    )
    // Done: back to the composer.
    expect(await screen.findByLabelText('Message')).toBeInTheDocument()
  })
})

describe('Labels and quick replies (group B, staff only)', () => {
  type Label = { id: string; name: string; color: string }
  function stubTools(state: {
    labels: Label[]
    applied: Record<string, string[]>
    team: Array<{ id: string; shortcut: string; body: string; scope: 'team' }>
    mine: Array<{ id: string; shortcut: string; body: string; scope: 'mine' }>
  }) {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    const labelsOf = (id: string) => state.labels.filter((l) => (state.applied[id] ?? []).includes(l.id))
    const withLabels = (c: ChatConversation) => ({ ...c, labels: labelsOf(c.id) })
    const all = [conv('c1', { title: 'Kid group' }), conv('c2', { title: 'Second group' })]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api\/v1/, '')
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        calls.push({ method, path, body })
        if (path === '/me') return json(ADMIN)
        if (path === '/conversations') return json({ conversations: all.map(withLabels) })
        if (path === '/conversations/c1') return json(withLabels(all[0]!))
        if (path === '/conversations/c1/labels' && method === 'PUT') {
          state.applied.c1 = body.labelIds
          return json({ labels: labelsOf('c1') })
        }
        if (path === '/conversations/c1/messages/pins') return json({ pins: [] })
        if (path === '/conversations/c1/messages') return json({ messages: [msg('m1', 1)], nextBefore: null })
        if (path.endsWith('/messages/read')) return json({ ok: true })
        if (path === '/me/labels' && method === 'GET') return json({ labels: state.labels.map((l) => ({ ...l, conversationCount: 0 })) })
        if (path === '/me/labels' && method === 'POST') {
          const label = { id: `lb-${state.labels.length + 1}`, name: body.name, color: body.color }
          state.labels.push(label)
          return json(label, 201)
        }
        if (path === '/quick-replies' && method === 'GET') return json({ team: state.team, mine: state.mine })
        if (path === '/quick-replies' && method === 'POST') {
          const reply = { id: `qr-${state.mine.length + 10}`, shortcut: body.shortcut, body: body.body, scope: body.scope }
          if (body.scope === 'mine') state.mine.push(reply)
          return json(reply, 201)
        }
        return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
      }),
    )
    return calls
  }

  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it("shows the viewer's own labels on rows, and filters the list by one", async () => {
    stubTools({ labels: [{ id: 'lb-1', name: 'VIP', color: '5' }], applied: { c2: ['lb-1'] }, team: [], mine: [] })
    renderChat()
    const second = (await screen.findByText('Second group')).closest('li')!
    expect(within(second).getByText('VIP')).toBeInTheDocument()

    const filter = screen.getByRole('group', { name: 'Filter by label' })
    fireEvent.click(within(filter).getByRole('button', { name: 'VIP' }))
    expect(screen.queryByText('Kid group')).not.toBeInTheDocument()
    expect(screen.getByText('Second group')).toBeInTheDocument()
    // Again clears it.
    fireEvent.click(within(filter).getByRole('button', { name: 'VIP' }))
    expect(screen.getByText('Kid group')).toBeInTheDocument()
  })

  it('labels a chat from its menu: tick an existing label, or make a new one in a colour', async () => {
    const calls = stubTools({ labels: [{ id: 'lb-1', name: 'VIP', color: '5' }], applied: {}, team: [], mine: [] })
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Labels…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Labels' })
    expect(within(dialog).getByText(/private/)).toBeInTheDocument()

    fireEvent.click(await within(dialog).findByRole('checkbox'))
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PUT').at(-1)).toEqual({ method: 'PUT', path: '/conversations/c1/labels', body: { labelIds: ['lb-1'] } }),
    )

    fireEvent.change(within(dialog).getByLabelText('New label'), { target: { value: 'Late payment' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Colour 3' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/me/labels')?.body).toEqual({ name: 'Late payment', color: '3' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ labelIds: ['lb-1', 'lb-2'] }),
    )
  })

  it('"/" suggests quick replies; Enter puts the text in the box and sends nothing', async () => {
    const calls = stubTools({
      labels: [],
      applied: {},
      team: [{ id: 'qr-1', shortcut: 'schedule', body: 'Classes are Sunday to Thursday.', scope: 'team' }],
      mine: [{ id: 'qr-2', shortcut: 'sig', body: '— Admin A', scope: 'mine' }],
    })
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    const box = screen.getByLabelText('Message')
    fireEvent.change(box, { target: { value: '/sch' } })
    const list = await screen.findByRole('listbox', { name: 'Quick replies' })
    expect((await within(list).findAllByRole('option')).map((o) => o.textContent)).toEqual([expect.stringContaining('/schedule')])

    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box).toHaveValue('Classes are Sunday to Thursday.')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/conversations/c1/messages')).toBe(false)

    // An unknown shortcut says so; Escape lets a literal "/..." be typed.
    fireEvent.change(box, { target: { value: '/nothing' } })
    expect(await screen.findByText('No reply with that shortcut.')).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('manages quick replies from the + menu: add a personal one, then insert it', async () => {
    const calls = stubTools({ labels: [], applied: {}, team: [], mine: [] })
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Quick replies' }))
    const dialog = await screen.findByRole('dialog', { name: 'Quick replies' })
    fireEvent.click(within(dialog).getByRole('button', { name: /My replies/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add reply' }))
    fireEvent.change(within(dialog).getByLabelText('Shortcut'), { target: { value: 'thanks' } })
    fireEvent.change(within(dialog).getByLabelText('Reply text'), { target: { value: 'Thank you, we will follow up.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/quick-replies')?.body).toEqual({
        shortcut: 'thanks',
        body: 'Thank you, we will follow up.',
        scope: 'mine',
      }),
    )
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Insert' }))
    expect(screen.queryByRole('dialog', { name: 'Quick replies' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue('Thank you, we will follow up.')
  })
})

describe('Edit and favorites', () => {
  type Call = { method: string; path: string; body: unknown }
  function stubWorkspace(state: {
    conversations: ChatConversation[]
    messages: ChatMessage[]
    editRefusal?: { status: number; code: string; message: string }
  }) {
    const calls: Call[] = []
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api\/v1/, '')
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        calls.push({ method, path, body })
        if (path === '/me') return json(ADMIN)
        if (path === '/conversations') return json({ conversations: state.conversations })
        if (path === '/me/labels') return json({ labels: [{ id: 'lb1', name: 'Payment issue', color: '1', conversationCount: 0 }] })
        const prefs = path.match(/^\/conversations\/([^/]+)\/preferences$/)
        if (prefs) {
          const c = state.conversations.find((x) => x.id === prefs[1])!
          c.viewerState = { pinned: false, archived: false, mutedUntil: null, ...c.viewerState, ...body }
          return json({ ok: true })
        }
        const edit = path.match(/^\/conversations\/c1\/messages\/([^/]+)$/)
        if (edit && method === 'PATCH') {
          if (state.editRefusal) {
            return json({ error: { code: state.editRefusal.code, message: state.editRefusal.message } }, state.editRefusal.status)
          }
          const m = state.messages.find((x) => x.id === edit[1])!
          Object.assign(m, { body: body.body, editedAt: new Date().toISOString() })
          return json(m)
        }
        if (path === '/conversations/c1/messages') return json({ messages: [...state.messages].reverse(), nextBefore: null })
        if (path === '/conversations/c1/messages/pins') return json({ pins: [] })
        if (path.endsWith('/messages/read')) return json({ ok: true })
        const one = path.match(/^\/conversations\/([^/]+)$/)
        if (one) return json(state.conversations.find((x) => x.id === one[1]) ?? {})
        return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
      }),
    )
    return calls
  }

  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  const recent = () => new Date(Date.now() - 60_000).toISOString()
  const mine = (id: string, seq: number, over: Partial<ChatMessage> = {}) =>
    msg(id, seq, { authorKind: 'staff', authorId: ADMIN.id, authorDisplayName: 'Me', createdAt: recent(), ...over })

  it('edits my own recent text message in the composer, and marks it edited', async () => {
    const state = { conversations: [conv('c1')], messages: [mine('m1', 1, { body: 'Lesson at 5' })] }
    const calls = stubWorkspace(state)
    renderChat('/chat/c1')
    const row = (await screen.findByText('Lesson at 5')).closest('li')!

    fireEvent.click(within(row).getByRole('button', { name: 'Message options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    const box = screen.getByLabelText('Editing message') as HTMLTextAreaElement
    expect(box.value).toBe('Lesson at 5')
    // No attachments or voice while editing: the bar is text only.
    expect(screen.queryByRole('button', { name: 'Record voice message' })).not.toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'Lesson at 6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }))

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/conversations/c1/messages/m1', body: { body: 'Lesson at 6' } }),
    )
    const edited = (await screen.findByText('Lesson at 6')).closest('li')!
    expect(within(edited).getByText('Edited')).toBeInTheDocument()
    // Back to an empty composer for a new message.
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('')
  })

  it("offers Edit only on my own recent text: not on others' messages, nor after the window", async () => {
    stubWorkspace({
      conversations: [conv('c1')],
      messages: [mine('old', 1, { body: 'old one', createdAt: '2026-01-01T08:00:00.000Z' }), msg('theirs', 2, { body: 'their one' })],
    })
    renderChat('/chat/c1')
    for (const text of ['old one', 'their one']) {
      const row = (await screen.findByText(text)).closest('li')!
      fireEvent.click(within(row).getByRole('button', { name: 'Message options' }))
      await screen.findByRole('menuitem', { name: 'Reply' })
      expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument()
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    }
  })

  it("PD-14: an admin in charge edits a parent's old message and may delete it for everyone; a colleague's is not theirs to edit", async () => {
    const state = {
      conversations: [conv('c1', { viewerModerates: ['teacher', 'contact'] })],
      messages: [
        msg('p1', 1, { body: 'rude words' }),
        msg('s1', 2, { body: 'colleague note', authorKind: 'staff', authorId: 'staff-2', authorDisplayName: 'Colleague' }),
      ],
    }
    const calls = stubWorkspace(state)
    renderChat('/chat/c1')

    const colleague = (await screen.findByText('colleague note')).closest('li')!
    fireEvent.click(within(colleague).getByRole('button', { name: 'Message options' }))
    await screen.findByRole('menuitem', { name: 'Reply' })
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete for everyone' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    // Days old: an author's window has long closed, a moderator has none.
    const parentRow = screen.getByText('rude words').closest('li')!
    fireEvent.click(within(parentRow).getByRole('button', { name: 'Message options' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete for everyone' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Editing message'), { target: { value: 'kind words' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }))

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/conversations/c1/messages/p1', body: { body: 'kind words' } }),
    )
    expect(within((await screen.findByText('kind words')).closest('li')!).getByText('Edited')).toBeInTheDocument()
  })

  it('Escape cancels an edit and gives back what was being typed', async () => {
    stubWorkspace({ conversations: [conv('c1')], messages: [mine('m1', 1, { body: 'typo here' })] })
    renderChat('/chat/c1')
    const row = (await screen.findByText('typo here')).closest('li')!
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'half a draft' } })

    fireEvent.click(within(row).getByRole('button', { name: 'Message options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    fireEvent.keyDown(screen.getByLabelText('Editing message'), { key: 'Escape' })

    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('half a draft')
  })

  it("shows the server's refusal of a late edit in the viewer's words", async () => {
    stubWorkspace({
      conversations: [conv('c1')],
      messages: [mine('m1', 1, { body: 'almost late' })],
      editRefusal: { status: 403, code: 'COMM.EDIT_WINDOW_EXPIRED', message: 'the edit window of 15 minutes has expired' },
    })
    renderChat('/chat/c1')
    const row = (await screen.findByText('almost late')).closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Message options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Editing message'), { target: { value: 'too late' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }))
    expect(await screen.findByText(chatCopy.en.editWindowExpired)).toBeInTheDocument()
  })

  it('a message.updated event re-reads the thread', async () => {
    const state = { conversations: [conv('c1')], messages: [msg('m1', 1, { body: 'first wording' })] }
    stubWorkspace(state)
    renderChat('/chat/c1')
    await screen.findByText('first wording')
    Object.assign(state.messages[0]!, { body: 'second wording', editedAt: new Date().toISOString() })
    act(() => fakeSocket.serverEmits('message.updated', { conversationId: 'c1', messageId: 'm1' }))
    expect(await screen.findByText('second wording')).toBeInTheDocument()
  })

  it('adds a chat to favorites from its row menu, and the Favorites filter shows it', async () => {
    const state = { conversations: [conv('c1', { title: 'Kid one' }), conv('c2', { title: 'Kid two' })], messages: [] }
    const calls = stubWorkspace(state)
    renderChat()
    const row = (await screen.findByText('Kid two')).closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Chat options: Kid two' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add to favorites' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/conversations/c2/preferences')?.body).toEqual({ favorite: true }),
    )
    expect(await within(row).findByLabelText('Favorite')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Favorites/ }))
    expect(screen.queryByText('Kid one')).not.toBeInTheDocument()
    expect(screen.getByText('Kid two')).toBeInTheDocument()
  })

  it('PD-35: a group joined to support sits under Joined, never in the main list', async () => {
    const seat = { reason: 'supervision', joinedAt: '2026-10-26T08:00:00Z', effective: false }
    const viewerState = { pinned: false, archived: false, mutedUntil: null }
    stubWorkspace({
      conversations: [
        conv('c1', { title: 'Kid one' }),
        conv('c2', { title: 'Kid joined', viewerState: { ...viewerState, seat } }),
      ],
      messages: [],
    })
    renderChat()
    expect(await screen.findByText('Kid one')).toBeInTheDocument()
    expect(screen.queryByText('Kid joined')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Joined/ }))
    expect(screen.getByText('Kid joined')).toBeInTheDocument()
    expect(screen.queryByText('Kid one')).not.toBeInTheDocument()
  })

  it("opens the chat's labels from its row menu, not only from inside the chat", async () => {
    stubWorkspace({ conversations: [conv('c1', { title: 'Kid one' })], messages: [] })
    renderChat()
    const row = (await screen.findByText('Kid one')).closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Chat options: Kid one' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Labels…' }))
    const dialog = await screen.findByRole('dialog', { name: chatCopy.en.labels })
    expect(await within(dialog).findByText('Payment issue')).toBeInTheDocument()
  })
})

describe('Search and export (group B)', () => {
  const SUPER = makeStaff({ id: 'staff_super', role: 'super_admin' })
  function stubSearch(me = ADMIN, exportAnswer?: () => Response, pagedSearch = false) {
    const calls: Array<{ method: string; path: string; query: Record<string, string> }> = []
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    const c1 = [msg('m1', 1, { body: 'old fee notice' }), msg('m2', 2), msg('m3', 3), msg('m4', 4), msg('m5', 5, { body: 'the fee is due' })]
    const t1 = msg('t1', 1, { conversationId: 'c2', body: 'the trip is on Thursday' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost')
        const path = url.pathname.replace(/^\/api\/v1/, '')
        const query = Object.fromEntries(url.searchParams)
        calls.push({ method: init?.method ?? 'GET', path, query })
        if (path === '/me') return json(me)
        if (path === '/conversations') return json({ conversations: [conv('c1', { title: 'Kid group' }), conv('c2', { title: 'Second group' })] })
        if (path === '/conversations/c1') return json(conv('c1', { title: 'Kid group' }))
        if (path === '/conversations/c2') return json(conv('c2', { title: 'Second group' }))
        if (path.endsWith('/messages/pins')) return json({ pins: [] })
        if (path.endsWith('/messages/read')) return json({ ok: true })
        if (path === '/conversations/c1/messages') {
          // Two pages: the newest two, then the rest.
          return query.before === '4'
            ? json({ messages: c1.slice(0, 3).reverse(), nextBefore: null })
            : json({ messages: c1.slice(3).reverse(), nextBefore: '4' })
        }
        if (path === '/conversations/c2/messages') return json({ messages: [t1], nextBefore: null })
        if (path === '/conversations/c1/messages/search') {
          // Paged like the server: the newest match first, the older one behind `before`.
          if (pagedSearch) return query.before === '5' ? json({ hits: [c1[0]], nextBefore: null }) : json({ hits: [c1[4]], nextBefore: '5' })
          return json({ hits: [c1[4], c1[0]], nextBefore: null })
        }
        if (path === '/me/search') return json({ hits: [{ conversationId: 'c2', message: t1 }] })
        if (path === '/conversations/c1/export' && exportAnswer) return exportAnswer()
        return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
      }),
    )
    return calls
  }
  const flashed = (id: string) => !!document.querySelector(`[data-msg-id="${id}"]`)?.classList.contains('cw-msg--flash')

  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it('searches inside a chat: marks the match, and steps back to an older one, loading history to reach it', async () => {
    const calls = stubSearch()
    renderChat('/chat/c1')
    await screen.findByText('the fee is due')
    expect(screen.queryByText('old fee notice')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Search in chat' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search in chat' }), { target: { value: 'fee' } })
    expect(await screen.findByText('1 of 2')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/conversations/c1/messages/search')?.query).toEqual({ q: 'fee' })
    expect(within(document.querySelector<HTMLElement>('[data-msg-id="m5"]')!).getByText('fee').tagName).toBe('MARK')

    fireEvent.click(screen.getByRole('button', { name: 'Older match' }))
    expect(await screen.findByText('2 of 2')).toBeInTheDocument()
    // Not on screen yet: the older page is fetched, then the message is shown.
    await waitFor(() => expect(calls.some((c) => c.path === '/conversations/c1/messages' && c.query.before === '4')).toBe(true))
    await waitFor(() => expect(flashed('m1')).toBe(true))
  })

  it('steps past the last loaded match by fetching the next page of matches (review fix, PR #68)', async () => {
    const calls = stubSearch(ADMIN, undefined, true)
    renderChat('/chat/c1')
    await screen.findByText('the fee is due')
    fireEvent.click(screen.getByRole('button', { name: 'Search in chat' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search in chat' }), { target: { value: 'fee' } })
    expect(await screen.findByText('1 of 1+')).toBeInTheDocument()
    // More exist on the server, so "older" stays available at the last loaded one.
    const older = screen.getByRole('button', { name: 'Older match' })
    expect(older).toBeEnabled()
    fireEvent.click(older)
    await waitFor(() => expect(calls.some((c) => c.path === '/conversations/c1/messages/search' && c.query.before === '5')).toBe(true))
    expect(await screen.findByText('2 of 2')).toBeInTheDocument()
    await waitFor(() => expect(flashed('m1')).toBe(true))
    expect(screen.getByRole('button', { name: 'Older match' })).toBeDisabled()
  })

  it('searches messages across chats only from three letters (review fix, PR #68)', async () => {
    const calls = stubSearch()
    renderChat('/chat')
    await screen.findByText('Kid group')
    const box = screen.getByRole('searchbox', { name: 'Search chats and messages' })
    fireEvent.change(box, { target: { value: 'tr' } })
    await new Promise((r) => setTimeout(r, 400))
    expect(calls.some((c) => c.path === '/me/search')).toBe(false)
    expect(screen.queryByRole('region', { name: 'Messages' })).not.toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'tri' } })
    expect(await screen.findByRole('region', { name: 'Messages' })).toBeInTheDocument()
    await waitFor(() => expect(calls.find((c) => c.path === '/me/search')?.query).toEqual({ q: 'tri' }))
  })

  it('the list search also finds messages across chats, and opens the chat at the hit', async () => {
    const calls = stubSearch()
    renderChat('/chat')
    await screen.findByText('Kid group')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search chats and messages' }), { target: { value: 'trip' } })
    const section = await screen.findByRole('region', { name: 'Messages' })
    expect(calls.find((c) => c.path === '/me/search')?.query).toEqual({ q: 'trip' })
    const hit = await within(section).findByRole('button', { name: /Second group/ })
    expect(within(hit).getByText('trip').tagName).toBe('MARK')
    fireEvent.click(hit)
    await waitFor(() => expect(document.querySelector('[data-msg-id="t1"]')).not.toBeNull())
    await waitFor(() => expect(flashed('t1')).toBe(true))
  })

  it('export is offered to the super admin only; it downloads the zip the server sends', async () => {
    stubSearch(ADMIN)
    const first = renderChat('/chat/c1')
    await screen.findByText('the fee is due')
    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }))
    await screen.findByRole('menuitem', { name: 'Select messages' })
    expect(screen.queryByRole('menuitem', { name: 'Export chat…' })).not.toBeInTheDocument()
    first.unmount()
    vi.unstubAllGlobals()

    const calls = stubSearch(SUPER, () =>
      new Response(new Blob([new Uint8Array([0x50, 0x4b, 5, 6])]), {
        status: 200,
        headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="jawwid-chat-2026-10-20-c1.zip"' },
      }),
    )
    const created = vi.fn(() => 'blob:export')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }))
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderWithProviders(
      <Routes>
        <Route path="/chat/:conversationId" element={<ChatPage />} />
      </Routes>,
      { route: '/chat/c1', staff: SUPER },
    )
    await screen.findByText('the fee is due')
    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Export chat…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Export chat' })
    expect(within(dialog).getByText(/audit log/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download .zip' }))
    await waitFor(() => expect(clicked).toHaveBeenCalled())
    expect(calls.some((c) => c.path === '/conversations/c1/export')).toBe(true)
    expect(created).toHaveBeenCalledWith(expect.any(Blob))
    expect((clicked.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('jawwid-chat-2026-10-20-c1.zip')
    expect(await screen.findByText('Export downloaded')).toBeInTheDocument()
    clicked.mockRestore()
  })
})

describe('Schedule a call from inside a chat', () => {
  function stubSchedule(canCall: boolean, refusal?: { status: number; code: string; message: string }) {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api\/v1/, '')
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        calls.push({ method, path, body })
        if (path === '/me') return json(ADMIN)
        if (path === '/conversations') return json({ conversations: [conv('c1', { title: 'Kid group' })] })
        if (path === '/conversations/c1') return json(conv('c1', { title: 'Kid group' }))
        if (path === '/conversations/c1/call-capability') return json({ canCall: canCall, code: canCall ? null : 'COMM.PARENT_CANNOT_START_GROUP_CALL' })
        if (path === '/conversations/c1/messages/pins') return json({ pins: [] })
        if (path === '/conversations/c1/messages') return json({ messages: [msg('m1', 1)], nextBefore: null })
        if (path.endsWith('/messages/read')) return json({ ok: true })
        if (path === '/scheduled-calls' && method === 'POST') {
          if (refusal) return json({ error: { code: refusal.code, message: refusal.message } }, refusal.status)
          const at = body.startsAt as string
          return json({
            id: 'sc1', conversationId: 'c1', kind: 'scheduled', title: body.title ?? null, startsAt: at,
            joinableFrom: at, joinableUntil: at, state: 'upcoming', createdBy: { actorId: ADMIN.id, displayName: 'Me' }, canCancel: true,
          }, 201)
        }
        return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
      }),
    )
    return calls
  }

  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it("schedules into THIS chat from its menu: the chat is fixed, and the card is the server's to post", async () => {
    const calls = stubSchedule(true)
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Schedule call…' }))

    const dialog = await screen.findByRole('dialog', { name: 'Schedule call' })
    expect(within(dialog).getByText('Kid group')).toBeInTheDocument()
    // Opened from inside the chat, there is no other chat to pick.
    expect(within(dialog).queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }))

    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/scheduled-calls')).toBeTruthy())
    const sent = calls.find((c) => c.method === 'POST' && c.path === '/scheduled-calls')!.body as { conversationId: string; kind: string; startsAt: string }
    expect(sent).toEqual(expect.objectContaining({ conversationId: 'c1', kind: 'scheduled' }))
    expect(new Date(sent.startsAt).getTime()).toBeGreaterThan(Date.now())
    expect(await screen.findByText('Scheduled — posted in “Kid group”')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Schedule call' })).not.toBeInTheDocument()
  })

  it('is absent, not disabled, when the server says this viewer may not call here', async () => {
    stubSchedule(false)
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }))
    await screen.findByRole('menuitem', { name: 'Select messages' })
    expect(screen.queryByRole('menuitem', { name: 'Schedule call…' })).not.toBeInTheDocument()
  })

  it("shows the server's refusal in the dialog and keeps it open", async () => {
    stubSchedule(true, { status: 403, code: 'COMM.PARENT_CANNOT_START_GROUP_CALL', message: 'only staff may start a group call' })
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Schedule call…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Schedule call' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Schedule call' })).toBeInTheDocument()
  })
})

describe('Chat theme (private, presets + own photo)', () => {
  function stubTheme() {
    const calls: Array<{ method: string; path: string; body: unknown; url: string }> = []
    const state: { theme: ChatTheme | null; wallpaperUrl: string | null } = { theme: null, wallpaperUrl: null }
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    const c1 = () => conv('c1', { title: 'Kid group', viewerState: { pinned: false, archived: false, mutedUntil: null, ...state } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input)
        const path = new URL(url, 'http://localhost').pathname.replace(/^\/api\/v1/, '')
        const method = init?.method ?? 'GET'
        const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body
        calls.push({ method, path, body, url })
        if (url.startsWith('https://storage.example/')) return new Response(null, { status: 200 })
        if (path === '/me') return json(ADMIN)
        if (path === '/conversations') return json({ conversations: [c1()] })
        if (path === '/conversations/c1') return json(c1())
        if (path === '/conversations/c1/messages/pins') return json({ pins: [] })
        if (path === '/conversations/c1/messages') return json({ messages: [msg('m1', 1)], nextBefore: null })
        if (path.endsWith('/messages/read')) return json({ ok: true })
        if (path === '/conversations/c1/theme' && method === 'PUT') {
          state.theme = (body as { theme: ChatTheme | null }).theme
          return json({ theme: state.theme })
        }
        if (path === '/conversations/c1/wallpaper/upload') {
          // As S3 grants it: lower-case, and both headers are inside the signature.
          return json({
            uploadUrl: 'https://storage.example/put/wall',
            method: 'PUT',
            objectKey: 'wallpapers/a/c1/k',
            headers: { 'content-type': 'image/webp', 'content-length': '3' },
          })
        }
        if (path === '/conversations/c1/wallpaper' && method === 'POST') {
          state.wallpaperUrl = 'http://localhost/media/wallpapers/c1?v=o&k=1'
          return json({ wallpaperUrl: state.wallpaperUrl })
        }
        if (path === '/conversations/c1/wallpaper' && method === 'DELETE') {
          state.wallpaperUrl = null
          return json({ wallpaperUrl: null })
        }
        return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
      }),
    )
    return calls
  }
  const body = () => document.querySelector<HTMLElement>('.thread-body')!

  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it('picks a preset from the menu: saved for this viewer, and the chat behind shows it', async () => {
    const calls = stubTheme()
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    expect(body().className).toBe('thread-body')

    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Chat theme…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Chat theme' })
    expect(within(dialog).getByText(/Only you see this/)).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sand' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/conversations/c1/theme', body: { theme: 'sand' } }))
    await waitFor(() => expect(body().classList.contains('cw-bg--sand')).toBe(true))
    expect(within(dialog).getByRole('radio', { name: 'Sand' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Default' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ theme: null }))
    await waitFor(() => expect(body().className).toBe('thread-body'))
  })

  it('a photo wallpaper: authorize, PUT without the bearer, commit; shown dimmed; removable', async () => {
    const calls = stubTheme()
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Chat theme…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Chat theme' })

    const input = within(dialog).getByTestId('wallpaper-file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'beach.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/conversations/c1/wallpaper')).toBe(true))
    expect(calls.find((c) => c.path === '/conversations/c1/wallpaper/upload')?.body).toEqual({ mimeType: 'image/webp', byteSize: 3 })
    const put = calls.find((c) => c.url.startsWith('https://storage.example/'))!
    expect(put.method).toBe('PUT')
    const putInit = (fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls.find(([u]) => String(u).startsWith('https://storage.example/'))![1]
    const sent = new Headers(putInit.headers)
    expect(sent.has('authorization')).toBe(false)
    // ONE content type, exactly as signed -- not "image/webp, image/webp".
    expect(sent.get('content-type')).toBe('image/webp')
    expect(calls.find((c) => c.method === 'POST' && c.path === '/conversations/c1/wallpaper')?.body).toEqual({ objectKey: 'wallpapers/a/c1/k' })

    await waitFor(() => expect(body().classList.contains('cw-bg--photo')).toBe(true))
    expect(body().style.getPropertyValue('--cw-wall')).toContain('/media/wallpapers/c1')

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Remove photo' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/conversations/c1/wallpaper')).toBe(true))
    await waitFor(() => expect(body().classList.contains('cw-bg--photo')).toBe(false))
  })
})

describe('Chat theme errors (review fix, PR #72)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("words the server's refusal in the viewer's language, and clears it when the next action succeeds", async () => {
    // A commit the server refuses for the picture's size.
    stubThemeForErrors({ code: 'COMM.CHAT_WALLPAPER_DIMENSIONS', message: 'a wallpaper must be at least 200 x 200 pixels' })
    renderChat('/chat/c1')
    await screen.findByText('body m1')
    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Chat theme…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Chat theme' })

    fireEvent.change(within(dialog).getByTestId('wallpaper-file'), { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(chatCopy.en.wallpaperRefused['COMM.CHAT_WALLPAPER_DIMENSIONS']!)
    expect(within(dialog).queryByText(/at least 200 x 200 pixels/)).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sand' }))
    await waitFor(() => expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument())
  })
})

/** The theme stub, for the errors suite (same routes as above). */
function stubThemeForErrors(refuseCommit?: { code: string; message: string }) {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  let theme: string | null = null
  const c1 = () => conv('c1', { title: 'Kid group', viewerState: { pinned: false, archived: false, mutedUntil: null, theme: theme as never } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, 'http://localhost').pathname.replace(/^\/api\/v1/, '')
      const method = init?.method ?? 'GET'
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      if (url.startsWith('https://storage.example/')) return new Response(null, { status: 200 })
      if (path === '/me') return json(ADMIN)
      if (path === '/conversations') return json({ conversations: [c1()] })
      if (path === '/conversations/c1') return json(c1())
      if (path === '/conversations/c1/messages/pins') return json({ pins: [] })
      if (path === '/conversations/c1/messages') return json({ messages: [msg('m1', 1)], nextBefore: null })
      if (path.endsWith('/messages/read')) return json({ ok: true })
      if (path === '/conversations/c1/theme' && method === 'PUT') {
        theme = (body as { theme: string | null }).theme
        return json({ theme })
      }
      if (path === '/conversations/c1/wallpaper/upload') {
        return json({ uploadUrl: 'https://storage.example/put/wall', method: 'PUT', objectKey: 'wallpapers/a/c1/k', headers: { 'content-type': 'image/webp' } })
      }
      if (path === '/conversations/c1/wallpaper' && method === 'POST') {
        return refuseCommit ? json({ error: refuseCommit }, 400) : json({ wallpaperUrl: 'http://localhost/media/wallpapers/c1?v=o&k=1' })
      }
      return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
    }),
  )
}

describe('signedPutHeaders', () => {
  it("sends the grant's own content type once, and adds one only when the grant has none", async () => {
    const { signedPutHeaders } = await import('./chatApi')
    expect(signedPutHeaders('image/png', { 'content-type': 'image/png', 'content-length': '9' }).get('content-type')).toBe('image/png')
    expect(signedPutHeaders('image/png', undefined).get('content-type')).toBe('image/png')
    expect(signedPutHeaders('image/png', {}).get('content-type')).toBe('image/png')
  })
})

describe('PD-37: ticks, Message info, typing and presence', () => {
  beforeEach(() => fakeSocket.reset())
  afterEach(() => vi.unstubAllGlobals())

  it("ticks on the viewer's own messages only, as the server decided them", async () => {
    stubApi({
      conversations: [conv('c1')],
      messages: {
        c1: [
          msg('m1', 1, { authorKind: 'staff', authorId: ADMIN.id, body: 'mine and read', status: 'read' }),
          msg('m2', 2, { authorKind: 'staff', authorId: ADMIN.id, body: 'mine and delivered', status: 'delivered' }),
          msg('m3', 3, { body: 'the parent writes', status: null }),
        ],
      },
    })
    renderChat('/chat/c1')
    const read = (await screen.findByText('mine and read')).closest('li')!
    expect(within(read).getByRole('img', { name: 'Read' })).toBeInTheDocument()
    const delivered = screen.getByText('mine and delivered').closest('li')!
    expect(within(delivered).getByRole('img', { name: 'Delivered' })).toBeInTheDocument()
    const theirs = screen.getByText('the parent writes').closest('li')!
    expect(within(theirs).queryByRole('img', { name: /^(Read|Delivered|Sent)$/ })).not.toBeInTheDocument()
  })

  it('an arriving message is acknowledged as delivered, as a cursor, and message.status re-reads the thread', async () => {
    const calls = stubApi({ conversations: [conv('c1')], messages: { c1: [msg('m1', 1)] } })
    renderChat('/chat/c1')
    await screen.findByText('body m1')

    act(() => fakeSocket.serverEmits('message.created', { conversationId: 'c1', messageId: 'm2', seq: '2' }))
    expect(fakeSocket.emitted).toContainEqual({ event: 'message.delivered', payload: { conversationId: 'c1', upToSeq: '2' } })

    const reads = () => calls.filter((c) => c.method === 'GET' && c.path === '/conversations/c1/messages').length
    await waitFor(() => expect(reads()).toBeGreaterThan(1))
    const before = reads()
    act(() => fakeSocket.serverEmits('message.status', { conversationId: 'c1', items: [] }))
    await waitFor(() => expect(reads()).toBeGreaterThan(before))
  })

  it('Message info lists who read it, who has it, and that nobody is still pending', async () => {
    stubApi({
      conversations: [conv('c1')],
      messages: { c1: [msg('m1', 1, { authorKind: 'staff', authorId: ADMIN.id, body: 'please confirm', status: 'delivered' })] },
      info: {
        m1: {
          messageId: 'm1',
          status: 'delivered',
          readBy: [{ actorId: 't1', actorKind: 'teacher', displayName: 'Teacher Omar', avatarUrl: null, at: '2026-10-14T08:05:00.000Z' }],
          deliveredTo: [{ actorId: 'p1', actorKind: 'contact', displayName: 'Parent One', avatarUrl: null, at: '2026-10-14T08:01:00.000Z' }],
          pending: [],
        },
      },
    })
    renderChat('/chat/c1')
    const row = (await screen.findByText('please confirm')).closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Message options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Message info' }))
    const dialog = await screen.findByRole('dialog', { name: 'Message info' })
    expect(await within(dialog).findByText('Teacher Omar')).toBeInTheDocument()
    expect(within(dialog).getByText('Parent One')).toBeInTheDocument()
    expect(within(dialog).getByText('Nobody')).toBeInTheDocument()
  })

  it("someone else's typing shows in the header; the viewer's own and another chat's never do", async () => {
    stubApi({ conversations: [conv('c1')], messages: { c1: [msg('m1', 1)] } })
    renderChat('/chat/c1')
    await screen.findByText('body m1')

    act(() => fakeSocket.serverEmits('typing.started', { conversationId: 'c2', actorId: 't9', displayName: 'Elsewhere' }))
    act(() => fakeSocket.serverEmits('typing.started', { conversationId: 'c1', actorId: ADMIN.id, displayName: 'Me' }))
    expect(screen.queryByText(/is typing/)).not.toBeInTheDocument()

    act(() => fakeSocket.serverEmits('typing.started', { conversationId: 'c1', actorId: 't1', displayName: 'Teacher Omar' }))
    expect(await screen.findByText('Teacher Omar is typing…')).toBeInTheDocument()
    act(() => fakeSocket.serverEmits('typing.stopped', { conversationId: 'c1', actorId: 't1', displayName: 'Teacher Omar' }))
    await waitFor(() => expect(screen.queryByText('Teacher Omar is typing…')).not.toBeInTheDocument())
  })

  it('typing a message says so (throttled); an internal note never does -- the family would hear it', async () => {
    stubApi({ conversations: [conv('c1')], messages: { c1: [msg('m1', 1)] } })
    renderChat('/chat/c1')
    const box = await screen.findByPlaceholderText('Write a message… (Enter to send)')
    const starts = () => fakeSocket.emitted.filter((e) => e.event === 'typing.start')
    fireEvent.change(box, { target: { value: 'hel' } })
    expect(starts()).toEqual([{ event: 'typing.start', payload: { conversationId: 'c1' } }])
    fireEvent.change(box, { target: { value: 'hello' } }) // inside the ping interval: no second start
    expect(starts()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /Internal note/ }))
    expect(fakeSocket.emitted.map((e) => e.event)).toContain('typing.stop')
    fireEvent.change(screen.getByPlaceholderText('Internal note — parents and teachers never see it'), { target: { value: 'note' } })
    expect(starts()).toHaveLength(1)
  })

  it("a 1:1 with a colleague shows their presence as the server answered it; the viewer never asks about themselves", async () => {
    const direct = conv('d1', {
      type: 'direct',
      title: null,
      familyId: null,
      learnerId: null,
      members: [
        { actorId: ADMIN.id, actorKind: 'staff', memberRole: 'admin', isSilent: false, displayName: 'Me' },
        { actorId: 's2', actorKind: 'staff', memberRole: 'admin', isSilent: false, displayName: 'Colleague Noura' },
      ],
    })
    const calls = stubApi({
      conversations: [direct],
      messages: { d1: [msg('m1', 1, { conversationId: 'd1', authorKind: 'staff', authorId: 's2' })] },
      presence: [{ actorId: 's2', online: true, lastSeenAt: null }],
    })
    renderChat('/chat/d1')
    expect(await screen.findByText('Online')).toBeInTheDocument()
    const fetches = (vi.mocked(fetch).mock.calls as Array<[string]>).map(([u]) => String(u)).filter((u) => u.includes('/presence'))
    expect(fetches.length).toBeGreaterThan(0)
    expect(fetches.every((u) => !u.includes(ADMIN.id))).toBe(true)
    expect(calls.some((c) => c.path === '/presence')).toBe(true)
  })
})
