import { describe, expect, it, vi, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders, makeStaff } from '@/test/utils'
import { IDLE_MEDIA, type CallMedia } from '@/features/calls/callMedia'

/** PD-13 chat cards: drawn with Join, enabled only inside the join window. */

const fakeSocket = {
  connected: true,
  on() {},
  off() {},
  emit() {},
  timeout() {
    return { emitWithAck: async () => ({ ok: true }) }
  },
}
vi.mock('@/core/realtime/RealtimeProvider', () => ({
  useRealtime: () => ({ state: 'connected', hasEverConnected: true, socket: fakeSocket }),
}))

const { CallProvider } = await import('@/features/calls/CallProvider')
const { ChatPage } = await import('@/features/chat/ChatPage')

const ADMIN = makeStaff({ id: 'staff_a', role: 'admin' })
const MIN = 60_000

const createMedia = (): CallMedia => ({
  async connect() {},
  async setMicrophoneMuted() {},
  async startAudio() {},
  async disconnect() {},
  subscribe(l) {
    l({ ...IDLE_MEDIA })
    return () => undefined
  },
})

function payload(id: string, fromOffsetMin: number, untilOffsetMin: number) {
  const now = Date.now()
  return {
    scheduledCallId: id,
    kind: 'scheduled',
    title: `Title ${id}`,
    startsAt: new Date(now + (fromOffsetMin + 10) * MIN).toISOString(),
    joinableFrom: new Date(now + fromOffsetMin * MIN).toISOString(),
    joinableUntil: new Date(now + untilOffsetMin * MIN).toISOString(),
    when: 'Mon 20 Oct, 15:30',
    byName: 'Admin A',
  }
}

function cardMessage(id: string, seq: number, kind: string, p: Record<string, unknown>) {
  return {
    id,
    conversationId: 'c1',
    seq: String(seq),
    authorKind: 'staff',
    authorId: 'staff_b',
    authorDisplayName: 'Admin B',
    type: 'card',
    body: `fallback body ${id}`,
    visibility: 'customer',
    moderation: 'published',
    clientMessageId: null,
    deletedForAll: false,
    createdAt: '2026-10-19T08:00:00.000Z',
    attachments: [],
    card: { kind, payload: p },
  }
}

let requests: Array<{ method: string; path: string }>
function stubApi(messages: unknown[]) {
  requests = []
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  const conversation = {
    id: 'c1',
    type: 'student_group',
    familyId: 'f',
    learnerId: 'l',
    title: 'Group One',
    state: 'open',
    needsReply: false,
    lastSeq: '9',
    lastActivityAt: '2026-10-19T08:00:00.000Z',
    archivedAt: null,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const path = url.pathname.replace(/^\/api\/v1/, '')
      const method = init?.method ?? 'GET'
      requests.push({ method, path })
      if (path === '/me') return json(ADMIN)
      if (path === '/conversations') return json({ conversations: [conversation] })
      if (path === '/conversations/c1') return json(conversation)
      if (path === '/conversations/c1/messages') return json({ messages, nextBefore: null })
      if (path === '/conversations/c1/messages/read') return json({ ok: true })
      if (path === '/conversations/c1/call-capability') return json({ canCall: false, code: 'X' })
      if (/^\/scheduled-calls\/[^/]+\/join$/.test(path)) return json({ callId: 'call-j', conversationId: 'c1', mode: 'started' })
      return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
    }),
  )
}

function renderThread() {
  return renderWithProviders(
    <CallProvider createMedia={createMedia}>
      <Routes>
        <Route path="/chat/:conversationId" element={<ChatPage />} />
      </Routes>
    </CallProvider>,
    { route: '/chat/c1', staff: ADMIN },
  )
}

const cardOf = (kind: string, index = 0) =>
  [...document.querySelectorAll<HTMLElement>(`[data-card-kind="${kind}"]`)][index]!

afterEach(() => vi.unstubAllGlobals())

describe('Scheduled-call cards in the chat thread', () => {
  it('Join is enabled only inside [joinableFrom, joinableUntil]', async () => {
    stubApi([
      cardMessage('m1', 1, 'call_scheduled', payload('sc-soon', 30, 160)), // not open yet
      cardMessage('m2', 2, 'call_scheduled', payload('sc-now', -5, 100)), // open
      cardMessage('m3', 3, 'call_link', payload('sc-gone', -200, -60)), // closed
    ])
    renderThread()
    await screen.findByText('Title sc-now')

    const soon = cardOf('call_scheduled', 0)
    expect(within(soon).getByText('Scheduled call')).toBeInTheDocument()
    expect(within(soon).getByText('When: Mon 20 Oct, 15:30')).toBeInTheDocument()
    expect(within(soon).getByText('By: Admin A')).toBeInTheDocument()
    expect(within(soon).getByRole('button', { name: 'Join' })).toBeDisabled()
    expect(within(soon).getByText('Join opens 10 minutes before the start.')).toBeInTheDocument()

    const link = cardOf('call_link')
    expect(within(link).getByText('Call link')).toBeInTheDocument()
    expect(within(link).getByRole('button', { name: 'Join' })).toBeDisabled()
    expect(within(link).getByText('The join window has closed.')).toBeInTheDocument()

    const open = cardOf('call_scheduled', 1)
    const join = within(open).getByRole('button', { name: 'Join' })
    expect(join).toBeEnabled()
    // The card replaces the plain-text fallback.
    expect(screen.queryByText('fallback body m2')).not.toBeInTheDocument()

    await userEvent.click(join)
    await waitFor(() =>
      expect(requests.filter((r) => r.method === 'POST' && r.path === '/scheduled-calls/sc-now/join')).toHaveLength(1),
    )
  })

  it('a cancellation card is muted and has no Join; an unknown card keeps its body text', async () => {
    stubApi([
      cardMessage('m1', 1, 'call_schedule_cancelled', payload('sc-x', -5, 100)),
      cardMessage('m2', 2, 'lesson_summary', { lessonId: 'L1' }),
      cardMessage('m3', 3, 'call_scheduled', { title: 'no id here' }),
    ])
    renderThread()
    await screen.findByText('fallback body m2')

    const cancelled = cardOf('call_schedule_cancelled')
    expect(cancelled).toHaveClass('cp-card--muted')
    expect(within(cancelled).getByText('Scheduled call cancelled')).toBeInTheDocument()
    expect(within(cancelled).queryByRole('button')).not.toBeInTheDocument()
    // A malformed call card cannot be joined, so it is shown as text.
    expect(screen.getByText('fallback body m3')).toBeInTheDocument()
  })
})
