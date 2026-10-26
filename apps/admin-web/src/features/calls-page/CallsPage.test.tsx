import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders, makeStaff } from '@/test/utils'
import { IDLE_MEDIA, type CallMedia } from '@/features/calls/callMedia'
import { toDateInput } from './model'
import { academyWallClockToIso } from '@/core/time/academyTime'

/**
 * The Calls page (PD-13) against a stubbed API. Every actor is synthetic; this
 * proves what the page asks for and draws, never what the server allows.
 */

type Handler = (payload: unknown) => void
const fakeSocket = {
  connected: true,
  handlers: new Map<string, Set<Handler>>(),
  on(event: string, h: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(h)
  },
  off(event: string, h: Handler) {
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

const { CallProvider } = await import('@/features/calls/CallProvider')
const { CallOverlay } = await import('@/features/calls/CallOverlay')
const { CallsPage } = await import('./CallsPage')
const { JoinLinkPage } = await import('./JoinLinkPage')

const ADMIN = makeStaff({ id: 'staff_a', name: 'Admin A', role: 'admin' })
const MIN = 60_000

function createMedia(): CallMedia {
  return {
    async connect() {},
    async setMicrophoneMuted() {},
    async startAudio() {},
    async disconnect() {},
    subscribe(l) {
      l({ ...IDLE_MEDIA })
      return () => undefined
    },
  }
}

const CONVERSATIONS = [
  {
    id: 'c-direct',
    type: 'direct',
    familyId: 'f-1',
    learnerId: null,
    title: null,
    state: 'open',
    needsReply: false,
    lastSeq: '1',
    lastActivityAt: '2026-10-19T08:00:00.000Z',
    archivedAt: null,
    members: [
      { actorId: 'staff_a', actorKind: 'staff', memberRole: 'member', isSilent: false, displayName: 'Admin A' },
      { actorId: 'parent-1', actorKind: 'contact', memberRole: 'member', isSilent: false, displayName: 'Parent One' },
    ],
    viewerState: { pinned: true, archived: false, mutedUntil: null },
  },
  {
    id: 'c-group',
    type: 'student_group',
    familyId: 'f-1',
    learnerId: 'l-1',
    title: 'Group Alpha',
    state: 'open',
    needsReply: false,
    lastSeq: '1',
    lastActivityAt: '2026-10-19T08:00:00.000Z',
    archivedAt: null,
    members: [],
    viewerState: { pinned: false, archived: false, mutedUntil: null },
  },
  {
    id: 'c-teacher',
    type: 'direct',
    familyId: null,
    learnerId: null,
    title: null,
    state: 'open',
    needsReply: false,
    lastSeq: '1',
    lastActivityAt: '2026-10-19T08:00:00.000Z',
    archivedAt: null,
    members: [
      { actorId: 'staff_a', actorKind: 'staff', memberRole: 'member', isSilent: false, displayName: 'Admin A' },
      { actorId: 'teacher-1', actorKind: 'teacher', memberRole: 'member', isSilent: false, displayName: 'Teacher Tee' },
    ],
  },
]

function scheduled(over: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    id: 'sc-open',
    conversationId: 'c-group',
    kind: 'scheduled',
    title: 'Weekly check-in',
    startsAt: new Date(now - 5 * MIN).toISOString(),
    joinableFrom: new Date(now - 15 * MIN).toISOString(),
    joinableUntil: new Date(now + 115 * MIN).toISOString(),
    state: 'open',
    createdBy: { actorId: 'staff_a', displayName: 'Admin A' },
    canCancel: true,
    ...over,
  }
}

const later = () => {
  const now = Date.now()
  return scheduled({
    id: 'sc-later',
    conversationId: 'c-direct',
    title: null,
    startsAt: new Date(now + 24 * 60 * MIN).toISOString(),
    joinableFrom: new Date(now + 24 * 60 * MIN - 10 * MIN).toISOString(),
    joinableUntil: new Date(now + 26 * 60 * MIN).toISOString(),
    state: 'upcoming',
    canCancel: false,
  })
}

const HISTORY_PAGE_1 = {
  items: [
    {
      id: 'call-1',
      conversationId: 'c-direct',
      type: 'direct',
      status: 'ended',
      outcome: 'answered',
      initiatorId: 'staff_a',
      startedAt: '2026-10-19T09:00:00.000Z',
      endedAt: '2026-10-19T09:02:05.000Z',
      durationSeconds: 125,
      participants: [
        { actorId: 'staff_a', actorKind: 'staff', displayName: 'Admin A', joinedAt: null, leftAt: null },
        { actorId: 'parent-1', actorKind: 'contact', displayName: 'Parent One', joinedAt: null, leftAt: null },
      ],
    },
    {
      id: 'call-2',
      conversationId: 'c-group',
      type: 'group',
      status: 'ended',
      outcome: 'missed',
      initiatorId: 'teacher-1',
      startedAt: '2026-10-18T09:00:00.000Z',
      endedAt: null,
      durationSeconds: null,
      participants: [
        { actorId: 'teacher-1', actorKind: 'teacher', displayName: 'Teacher Tee', joinedAt: null, leftAt: null },
        { actorId: 'staff_a', actorKind: 'staff', displayName: 'Admin A', joinedAt: null, leftAt: null },
      ],
    },
  ],
  nextCursor: 'cur-2',
}
const HISTORY_PAGE_2 = {
  items: [
    {
      id: 'call-3',
      conversationId: 'c-teacher',
      type: 'direct',
      status: 'ended',
      outcome: 'declined',
      initiatorId: 'teacher-1',
      startedAt: '2026-10-10T09:00:00.000Z',
      endedAt: null,
      durationSeconds: null,
      participants: [
        { actorId: 'teacher-1', actorKind: 'teacher', displayName: 'Teacher Tee', joinedAt: null, leftAt: null },
        { actorId: 'staff_a', actorKind: 'staff', displayName: 'Admin A', joinedAt: null, leftAt: null },
      ],
    },
  ],
  nextCursor: null,
}

let requests: Array<{ method: string; path: string; search: string; body: unknown }>
function stubApi(opts: { upcoming?: unknown[]; canCall?: boolean; createFails?: { status: number; code: string; message: string } } = {}) {
  requests = []
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const path = url.pathname.replace(/^\/api\/v1/, '')
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      requests.push({ method, path, search: url.search, body })
      if (path === '/me') return json(ADMIN)
      if (path === '/conversations' && method === 'GET') return json({ conversations: CONVERSATIONS })
      if (path === '/scheduled-calls' && method === 'GET') return json({ items: opts.upcoming ?? [scheduled(), later()] })
      if (path === '/scheduled-calls' && method === 'POST') {
        if (opts.createFails) {
          return json({ error: { code: opts.createFails.code, message: opts.createFails.message } }, opts.createFails.status)
        }
        return json(scheduled({ id: 'sc-new', conversationId: body.conversationId, kind: body.kind, title: body.title ?? null }), 201)
      }
      if (path === '/scheduled-calls/sc-missing') {
        return json({ error: { code: 'COMM.SCHEDULED_CALL_NOT_FOUND', message: 'scheduled call not found' } }, 404)
      }
      if (path === '/scheduled-calls/sc-open' && method === 'GET') return json(scheduled())
      const join = path.match(/^\/scheduled-calls\/([^/]+)\/join$/)
      if (join && method === 'POST') return json({ callId: 'call-j', conversationId: 'c-group', mode: 'started' })
      const cancel = path.match(/^\/scheduled-calls\/([^/]+)\/cancel$/)
      if (cancel && method === 'POST') return json(scheduled({ id: cancel[1], state: 'cancelled', canCancel: false }))
      if (path === '/calls/history') return json(url.searchParams.get('cursor') === 'cur-2' ? HISTORY_PAGE_2 : HISTORY_PAGE_1)
      if (path.endsWith('/call-capability')) {
        const canCall = opts.canCall ?? true
        return json({ canCall, code: canCall ? null : 'COMM.BR1_TEACHER_PARENT_DIRECT' })
      }
      if (path === '/calls' && method === 'POST') return json({ callId: 'call-1', roomName: 'room-x' })
      return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
    }),
  )
}

function Where() {
  const { pathname, search } = useLocation()
  return <output data-testid="where">{pathname + search}</output>
}

function renderCalls(route = '/calls', locale: 'en' | 'ar' = 'en') {
  return renderWithProviders(
    <CallProvider createMedia={createMedia}>
      <Routes>
        <Route path="/calls" element={<CallsPage />} />
        <Route path="/calls/join/:scheduledCallId" element={<JoinLinkPage />} />
        <Route path="/chat/:conversationId" element={<p>chat page</p>} />
      </Routes>
      <CallOverlay />
      <Where />
    </CallProvider>,
    { route, staff: ADMIN, locale },
  )
}

const posts = (path: string | RegExp) =>
  requests.filter((r) => r.method === 'POST' && (typeof path === 'string' ? r.path === path : path.test(r.path)))

const section = (name: string) => screen.getByRole('region', { name })

beforeEach(() => stubApi())
afterEach(() => vi.unstubAllGlobals())

describe('Calls page layout', () => {
  it('shows Upcoming, Favorites and Recent, and four action tiles that are buttons', async () => {
    renderCalls()
    expect(await screen.findByRole('heading', { level: 1, name: 'Calls' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search name' })).toBeInTheDocument()
    for (const name of ['Upcoming', 'Favorites', 'Recent']) expect(section(name)).toBeInTheDocument()

    const actions = screen.getByRole('region', { name: 'Call actions' })
    expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Start call',
      'New call link',
      'Select a member',
      'Schedule call',
    ])
    // Voice only: no video affordance anywhere on the page.
    expect(screen.queryByRole('button', { name: /video/i })).not.toBeInTheDocument()

    await within(section('Upcoming')).findByText('Weekly check-in')
    // The upcoming call with no title is named after its chat; the open one offers Join.
    expect(within(section('Upcoming')).getByText('Parent One')).toBeInTheDocument()
    expect(within(section('Upcoming')).getAllByRole('button', { name: /^Join/ })).toHaveLength(1)
    expect(within(section('Upcoming')).getByText('Open now')).toBeInTheDocument()
    expect(within(section('Upcoming')).getByText('Upcoming', { selector: '.badge' })).toBeInTheDocument()

    // Favorites are the pinned chats, each with a call button.
    expect(await within(section('Favorites')).findByRole('button', { name: 'Call Parent One' })).toBeInTheDocument()
    expect(within(section('Favorites')).queryByText('Group Alpha')).not.toBeInTheDocument()
  })

  it('draws Recent from the account history: direction, outcome, duration and the group’s own title', async () => {
    renderCalls()
    const recent = section('Recent')
    await within(recent).findByText('Group Alpha')
    const rows = within(recent).getAllByTestId('recent-row')
    expect(rows.map((r) => r.getAttribute('data-direction'))).toEqual(['outgoing', 'incoming'])
    // Outgoing iff this account initiated it.
    expect(within(rows[0]!).getByText('Outgoing')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Parent One')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Answered')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('· 2:05')).toBeInTheDocument()
    // A group call is named after the conversation, not its participants; missed is marked.
    expect(within(rows[1]!).getByText('Group Alpha')).toHaveClass('cp-row__name--missed')
    expect(within(rows[1]!).getByText('Missed')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Incoming')).toBeInTheDocument()
    expect(within(rows[1]!).queryByText(/·/)).not.toBeInTheDocument()

    await userEvent.click(within(recent).getByRole('button', { name: 'Load more' }))
    await within(recent).findByText('Teacher Tee')
    expect(requests.some((r) => r.path === '/calls/history' && r.search.includes('cursor=cur-2'))).toBe(true)
    expect(within(recent).queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('searches all three lists by name', async () => {
    renderCalls()
    await within(section('Recent')).findByText('Group Alpha')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search name' }), 'parent')

    expect(within(section('Upcoming')).queryByText('Weekly check-in')).not.toBeInTheDocument()
    expect(within(section('Upcoming')).getByText('Parent One')).toBeInTheDocument()
    expect(within(section('Favorites')).getByText('Parent One')).toBeInTheDocument()
    expect(within(section('Recent')).getAllByTestId('recent-row')).toHaveLength(1)
    expect(within(section('Recent')).queryByText('Group Alpha')).not.toBeInTheDocument()

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search name' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search name' }), 'nobody here')
    expect(within(section('Favorites')).getByText('No matches for that name.')).toBeInTheDocument()
  })

  it('renders in Arabic first, right to left', async () => {
    renderCalls('/calls', 'ar')
    expect(await screen.findByRole('heading', { level: 1, name: 'المكالمات' })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
    expect(screen.getByRole('button', { name: 'جدولة مكالمة' })).toBeInTheDocument()
  })
})

describe('Upcoming actions', () => {
  it('Join on an open call goes through POST /scheduled-calls/:id/join and rings out', async () => {
    renderCalls()
    const join = await within(section('Upcoming')).findByRole('button', { name: 'Join — Weekly check-in' })
    await userEvent.click(join)
    await waitFor(() => expect(posts('/scheduled-calls/sc-open/join')).toHaveLength(1))
    expect(posts('/calls')).toHaveLength(0)
    expect(await screen.findByRole('region', { name: 'Call' })).toBeInTheDocument()
  })

  it('Cancel lives in the row menu, asks first, then POSTs cancel', async () => {
    renderCalls()
    await within(section('Upcoming')).findByText('Weekly check-in')
    await userEvent.click(screen.getByRole('button', { name: 'Options for Weekly check-in' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancel call' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancel the scheduled call?' })
    expect(posts(/cancel$/)).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, cancel it' }))
    await waitFor(() => expect(posts('/scheduled-calls/sc-open/cancel')).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Only the creator's row offers it.
    expect(screen.queryByRole('button', { name: 'Options for Parent One' })).not.toBeInTheDocument()
  })
})

describe('Member picker', () => {
  it('Start call: lists People and Groups, checks capability, then starts through the call controller', async () => {
    renderCalls()
    await userEvent.click(await screen.findByRole('button', { name: 'Start call' }))
    const dialog = screen.getByRole('dialog', { name: 'Start a voice call' })
    const people = await within(dialog).findByRole('region', { name: 'People' })
    expect(within(people).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Parent One'),
      expect.stringContaining('Teacher Tee'),
    ])
    expect(within(within(dialog).getByRole('region', { name: 'Groups' })).getByText('Group Alpha')).toBeInTheDocument()

    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Search name' }), 'tee')
    expect(within(dialog).queryByText('Parent One')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /Teacher Tee/ }))

    await waitFor(() => expect(posts('/calls')).toHaveLength(1))
    expect(posts('/calls')[0]!.body).toEqual({ conversationId: 'c-teacher' })
    expect(requests.some((r) => r.path === '/conversations/c-teacher/call-capability')).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Start a voice call' })).not.toBeInTheDocument()
  })

  it('shows a capability refusal in place and starts nothing', async () => {
    stubApi({ canCall: false })
    renderCalls()
    await userEvent.click(await screen.findByRole('button', { name: 'Start call' }))
    const dialog = screen.getByRole('dialog', { name: 'Start a voice call' })
    await userEvent.click(await within(dialog).findByRole('button', { name: /Parent One/ }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A call can’t be made in this chat right now.')
    expect(posts('/calls')).toHaveLength(0)
  })

  it('Select a member offers Voice call, Open chat and Schedule call', async () => {
    renderCalls()
    await userEvent.click(await screen.findByRole('button', { name: 'Select a member' }))
    const dialog = screen.getByRole('dialog', { name: 'Select a member' })
    await userEvent.click(await within(dialog).findByRole('button', { name: /Group Alpha/ }))
    const menu = within(screen.getByRole('dialog')).getByRole('menu', { name: 'Group Alpha' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Voice call',
      'Open chat',
      'Schedule call',
    ])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Open chat' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/chat/c-group')
  })
})

describe('Schedule call', () => {
  const future = () => {
    const d = new Date(Date.now() + 3 * 24 * 60 * MIN)
    return { date: toDateInput(d), time: '15:30', d }
  }

  it('picker -> schedule POSTs {conversationId, kind, startsAt, title} and says where it was posted', async () => {
    renderCalls()
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule call' }))
    await userEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: /Group Alpha/ }))
    const dialog = screen.getByRole('dialog', { name: 'Schedule call' })
    const { date, time } = future()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: date } })
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: time } })
    await userEvent.type(within(dialog).getByLabelText('Title (optional)'), 'Term review')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }))

    await waitFor(() => expect(posts('/scheduled-calls')).toHaveLength(1))
    // PD-22: the typed 15:30 is Cairo time, whatever the browser's zone.
    expect(posts('/scheduled-calls')[0]!.body).toEqual({
      conversationId: 'c-group',
      kind: 'scheduled',
      startsAt: academyWallClockToIso(date, '15:30'),
      title: 'Term review',
    })
    expect((await screen.findByText('Scheduled — posted in “Group Alpha”')).closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The upcoming list is re-read.
    await waitFor(() => expect(requests.filter((r) => r.method === 'GET' && r.path === '/scheduled-calls').length).toBeGreaterThan(1))
  })

  it('refuses a time in the past without asking the server', async () => {
    renderCalls()
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule call' }))
    await userEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: /Parent One/ }))
    const dialog = screen.getByRole('dialog', { name: 'Schedule call' })
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: toDateInput(new Date(Date.now() - 2 * 24 * 60 * MIN)) } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('That time is in the past.')
    expect(posts('/scheduled-calls')).toHaveLength(0)
  })

  it('shows the server’s refusal in its own words', async () => {
    stubApi({ createFails: { status: 403, code: 'COMM.BR1_TEACHER_PARENT_DIRECT', message: 'Calls between a teacher and a parent are not allowed.' } })
    renderCalls()
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule call' }))
    await userEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: /Parent One/ }))
    const dialog = screen.getByRole('dialog', { name: 'Schedule call' })
    const { date } = future()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: date } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Calls between a teacher and a parent are not allowed.')
  })
})

describe('New call link', () => {
  it('creates a link, shows the members-only URL, and copies it', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderCalls()
    await userEvent.click(await screen.findByRole('button', { name: 'New call link' }))
    await userEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: /Parent One/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Call link' })
    const input = await within(dialog).findByLabelText('Link')
    const link = `${window.location.origin}/calls/join/sc-new`
    expect(input).toHaveValue(link)
    expect(posts('/scheduled-calls')).toHaveLength(1)
    expect(posts('/scheduled-calls')[0]!.body).toEqual({ conversationId: 'c-direct', kind: 'link' })
    expect(within(dialog).getByText('Only members of this chat can join. Nobody is rung until someone joins.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Join now' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Open chat' })).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(link)
    expect(await within(dialog).findByText('Copied')).toBeInTheDocument()
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  })
})

describe('Join-link landing', () => {
  it('a 404 says the link is not available to this account, and offers nothing to join', async () => {
    renderCalls('/calls/join/sc-missing')
    expect(await screen.findByText('This call link isn’t available to your account.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Calls' })).toHaveAttribute('href', '/calls')
  })

  it('a readable call shows its card with Join', async () => {
    renderCalls('/calls/join/sc-open')
    expect(await screen.findByRole('heading', { name: 'Weekly check-in' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => expect(posts('/scheduled-calls/sc-open/join')).toHaveLength(1))
  })
})
