import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders, makeStaff } from '@/test/utils'
import type { ChatConversation, ChatMessage } from './chatApi'

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
  approvals?: Array<{ approvalId: string; conversationId: string; messageId: string }>
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
      if (path === '/approvals/pending') return json({ approvals: state.approvals ?? [] })
      const decided = path.match(/^\/approvals\/([^/]+)\/approve$/)
      if (decided && method === 'POST') {
        const a = (state.approvals ?? []).find((x) => x.approvalId === decided[1])
        const m = a && state.messages[a.conversationId]?.find((x) => x.id === a.messageId)
        if (m) m.moderation = 'published'
        state.approvals = (state.approvals ?? []).filter((x) => x.approvalId !== decided[1])
        return json({ ok: true })
      }
      if (path === '/conversations' && method === 'GET') return json({ conversations: state.conversations })
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

  it('a held teacher message can be approved from the thread; the server copy then shows as published', async () => {
    const state: Parameters<typeof stubApi>[0] = {
      conversations: [conv('c1')],
      messages: { c1: [msg('t1', 1, { authorKind: 'teacher', body: 'lesson notes', moderation: 'pending' })] },
      approvals: [{ approvalId: 'ap-1', conversationId: 'c1', messageId: 't1' }],
    }
    const calls = stubApi(state)
    renderChat('/chat/c1')

    expect(await screen.findByText('Awaiting approval')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve & publish' }))

    await waitFor(() => expect(screen.queryByText('Awaiting approval')).toBeNull())
    expect(calls.some((c) => c.method === 'POST' && c.path === '/approvals/ap-1/approve')).toBe(true)
    expect(screen.getByText('lesson notes')).toBeInTheDocument()
  })

  it('a held message NOT in this admin\'s queue offers no decision', async () => {
    stubApi({
      conversations: [conv('c1')],
      messages: { c1: [msg('t1', 1, { authorKind: 'teacher', moderation: 'pending' })] },
      approvals: [],
    })
    renderChat('/chat/c1')
    expect(await screen.findByText('Awaiting approval')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve & publish' })).toBeNull()
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
        if (path === '/approvals/pending') return json({ approvals: [] })
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
        if (path === '/approvals/pending') return json({ approvals: [] })
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
        if (path === '/approvals/pending') return json({ approvals: [] })
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
        if (path === '/approvals/pending') return json({ approvals: [] })
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
        if (path === '/approvals/pending') return json({ approvals: [] })
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
