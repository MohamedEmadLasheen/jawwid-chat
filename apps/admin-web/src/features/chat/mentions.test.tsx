import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders, makeStaff } from '@/test/utils'
import type { ChatConversation, ChatMessage } from './chatApi'
import { activeMentionQuery, insertMention, mentionSegments, spansFor } from './mentions'

/**
 * PD-36 @mentions in Admin Web: the text helpers, the @ picker, the chips, the
 * list's "Mentioned" row, the Join / Step in banner and Group Info's waiting rows.
 */

describe('mention text helpers', () => {
  it('finds the @query before the caret, only at a word start', () => {
    expect(activeMentionQuery('hi @La', 6)).toEqual({ start: 3, query: 'La' })
    expect(activeMentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(activeMentionQuery('mail a@b.com', 12)).toBeNull()
    expect(activeMentionQuery('hi @La ila', 10)).toBeNull()
    expect(activeMentionQuery('مرحبا @لي', 9)).toEqual({ start: 6, query: 'لي' })
  })

  it('inserts "@label " in place of the query', () => {
    expect(insertMention('hi @La there', 6, 3, 'Laila Mansour')).toEqual({ text: 'hi @Laila Mansour  there', caret: 18 })
  })

  it('finds each picked mention in the final text; one retyped away mentions nobody', () => {
    const picked = [
      { label: 'Laila', target: { actorId: 'a' } },
      { label: 'Laila Mansour', target: { actorId: 'b' } },
      { label: 'Gone', target: { actorId: 'c' } },
    ]
    expect(spansFor('@Laila Mansour and @Laila', picked)).toEqual([
      { start: 0, length: 14, actorId: 'b' },
      { start: 19, length: 6, actorId: 'a' },
    ])
  })

  it('measures Arabic in the UTF-16 units the server stores', () => {
    const text = 'شكرا @ليلى'
    expect(spansFor(text, [{ label: 'ليلى', target: { actorId: 'x' } }])).toEqual([{ start: 5, length: 5, actorId: 'x' }])
  })

  it('cuts a body into text and chips; a span that does not fit is plain text', () => {
    expect(mentionSegments('hi @Laila ok', [{ start: 3, length: 6, actorId: 'a', role: null }])).toEqual([
      { text: 'hi ' },
      { text: '@Laila', mention: { start: 3, length: 6, actorId: 'a', role: null } },
      { text: ' ok' },
    ])
    expect(mentionSegments('hi', [{ start: 0, length: 9, actorId: 'a', role: null }])).toEqual([{ text: 'hi' }])
  })
})

// --- the workspace -------------------------------------------------------

const fakeSocket = {
  connected: true,
  handlers: new Map<string, Set<(p: unknown) => void>>(),
  on(event: string, h: (p: unknown) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(h)
  },
  off(event: string, h: (p: unknown) => void) {
    this.handlers.get(event)?.delete(h)
  },
  emit() {},
  timeout() {
    return { emitWithAck: async () => ({ ok: true }) }
  },
}
vi.mock('@/core/realtime/RealtimeProvider', () => ({
  useRealtime: () => ({ state: 'connected', hasEverConnected: true, socket: fakeSocket }),
}))
const { ChatPage } = await import('./ChatPage')

const ME = makeStaff({ id: 'staff_mgr', role: 'manager' })

function conv(id: string, over: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id,
    type: 'family_group',
    familyId: 'fam-1',
    learnerId: null,
    title: `Group ${id}`,
    state: 'open',
    needsReply: false,
    lastSeq: '1',
    lastActivityAt: '2026-10-26T08:00:00.000Z',
    archivedAt: null,
    unreadCount: 0,
    members: [
      { actorId: 'sup-1', actorKind: 'staff', memberRole: 'admin', isSilent: false, displayName: 'Noura Adel' },
      { actorId: 'parent-1', actorKind: 'contact', memberRole: 'parent', isSilent: false, displayName: 'Parent One' },
    ],
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
    createdAt: '2026-10-26T08:00:00.000Z',
    attachments: [],
    ...over,
  }
}

const summons = (over = {}) => ({
  mentionId: 'mn-1',
  kind: 'summons' as const,
  state: 'pending',
  mentionedById: 'parent-1',
  at: '2026-10-26T08:00:00.000Z',
  seen: false,
  expiresAt: '2026-11-02T08:00:00.000Z',
  ...over,
})

function stubApi(state: { conversations: ChatConversation[]; messages: Record<string, ChatMessage[]> }) {
  const calls: Array<{ method: string; path: string; body: unknown; query: string }> = []
  const json = (data: unknown, status = 200) =>
    new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const path = url.pathname.replace(/^\/api\/v1/, '')
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path, body, query: url.search })
      if (path === '/me') return json(ME)
      if (path === '/conversations' && method === 'GET') return json({ conversations: state.conversations })
      if (/\/mention-candidates$/.test(path)) {
        return json({
          people: [
            { actorId: 'sup-1', actorKind: 'staff', displayName: 'Noura Adel', staffRole: 'admin', isMember: true },
            { actorId: 'owner-1', actorKind: 'staff', displayName: 'Owner Person', staffRole: 'super_admin', isMember: false },
          ],
          roles: [],
        })
      }
      if (/\/mentions\/seen$/.test(path)) return json(null, 204)
      if (/^\/mentions\/[^/]+\/dismiss$/.test(path)) return json({ state: 'dismissed' })
      if (/\/join$/.test(path)) return json({ id: 'seat-1' })
      const m = path.match(/^\/conversations\/([^/]+)(\/messages(\/read)?)?$/)
      if (m) {
        const id = decodeURIComponent(m[1]!)
        if (!m[2]) return json(state.conversations.find((c) => c.id === id) ?? {})
        if (m[3]) return json({ ok: true })
        if (method === 'GET') return json({ messages: state.messages[id] ?? [], nextBefore: null })
        const saved = msg(`srv-${Date.now()}`, 99, { conversationId: id, authorKind: 'staff', authorId: ME.id, body: body.body, clientMessageId: body.clientMessageId })
        ;(state.messages[id] ??= []).push(saved)
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
    { route, staff: ME },
  )
}

describe('PD-36 in the chat workspace', () => {
  beforeEach(() => fakeSocket.handlers.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('a chat that asked me in, unopened, leads the list -- above a pinned one -- with "Mentioned"', async () => {
    stubApi({
      conversations: [
        conv('pinned', { title: 'Pinned chat', viewerState: { pinned: true, archived: false, mutedUntil: null } }),
        conv('asked', { title: 'Asked chat', viewerState: { pinned: false, archived: false, mutedUntil: null, mention: summons() } }),
      ],
      messages: {},
    })
    renderChat()
    await screen.findByText('Asked chat')
    const rows = [...document.querySelectorAll('.conv-row__name')].map((n) => n.textContent)
    expect(rows).toEqual(['Asked chat', 'Pinned chat'])
    expect(screen.getByText('Mentioned')).toBeInTheDocument()
  })

  it('asked into a group: the banner offers Join and "Not for me", and the composer waits', async () => {
    const calls = stubApi({
      conversations: [conv('c1', { viewerState: { pinned: false, archived: false, mutedUntil: null, mention: summons() } })],
      messages: { c1: [msg('m1', 1)] },
    })
    renderChat('/chat/c1')
    expect(await screen.findByRole('button', { name: 'Join' })).toBeInTheDocument()
    expect(screen.getByText(/Mentioned by/)).toHaveTextContent('Parent One')
    expect(screen.queryByLabelText('Message')).toBeNull()
    // Opening it is seeing it.
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/conversations/c1/mentions/seen')).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => {
      const join = calls.find((c) => c.method === 'POST' && c.path === '/conversations/c1/join')
      expect(join?.body).toEqual({ reason: 'mention', sourceId: 'mn-1' })
    })
  })

  it('asked into a 1:1: "Step in" takes the effective seat; "Not for me" dismisses', async () => {
    const calls = stubApi({
      conversations: [conv('d1', { type: 'direct', viewerState: { pinned: false, archived: false, mutedUntil: null, mention: summons() } })],
      messages: { d1: [] },
    })
    renderChat('/chat/d1')
    fireEvent.click(await screen.findByRole('button', { name: 'Step in' }))
    await waitFor(() => {
      const join = calls.find((c) => c.method === 'POST' && c.path === '/conversations/d1/join')
      expect(join?.body).toEqual({ reason: 'mention', sourceId: 'mn-1' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Not for me' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/mentions/mn-1/dismiss')).toBe(true))
  })

  it('the @ picker offers who the server offers, and the send carries the span', async () => {
    const calls = stubApi({ conversations: [conv('c1', { members: [...conv('c1').members!, { actorId: ME.id, actorKind: 'staff', memberRole: 'admin', isSilent: false, displayName: 'Me' }] })], messages: { c1: [] } })
    renderChat('/chat/c1')
    const box = await screen.findByLabelText('Message')
    fireEvent.change(box, { target: { value: 'hi @Ow', selectionStart: 6 } })
    const list = await screen.findByRole('listbox', { name: 'Mention someone' })
    expect(await within(list).findByText('Asked to join')).toBeInTheDocument()
    fireEvent.mouseDown(within(list).getByText('@Owner Person'))
    expect((box as HTMLTextAreaElement).value).toBe('hi @Owner Person ')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.path === '/conversations/c1/messages')
      expect(post?.body).toMatchObject({ body: 'hi @Owner Person', mentions: [{ start: 3, length: 13, actorId: 'owner-1' }] })
    })
  })

  it('draws a mention as a chip, and my own mention as mine', async () => {
    stubApi({
      conversations: [conv('c1')],
      messages: {
        c1: [msg('m1', 1, { body: 'hi @Laila look', mentions: [{ start: 3, length: 6, actorId: ME.id, role: null }], mentionsViewer: true })],
      },
    })
    renderChat('/chat/c1')
    const chip = await screen.findByText('@Laila')
    expect(chip.tagName).toBe('BDI')
    expect(chip).toHaveClass('cw-mention--me')
    expect(chip.closest('.cw-msg')).toHaveClass('cw-msg--mentions-me')
  })
})
