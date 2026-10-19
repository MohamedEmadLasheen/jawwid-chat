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
    const seqs = [...document.querySelectorAll('article[data-seq]')].map((a) => a.getAttribute('data-seq'))
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

    await waitFor(() => expect(document.querySelector('article[data-pending]')).toBeNull())
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
