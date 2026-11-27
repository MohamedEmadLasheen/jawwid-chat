import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders, makeStaff } from '@/test/utils'
import type { ChatConversation, ChatMessage } from './chatApi'
import { cardFallbackText, conversationTone, toneOfKind } from './chatView'
import { waitingFirst } from './ThreadStart'

/**
 * The workspace around the conversation: the pane that says who to answer
 * first, the list's keys, the family beside the thread, and the internal-note
 * composer that cannot be mistaken for a message.
 */
const fakeSocket = {
  connected: true,
  on() {},
  off() {},
  emit() {},
  timeout: () => ({ emitWithAck: async () => ({ ok: true }) }),
}
vi.mock('@/core/realtime/RealtimeProvider', () => ({
  useRealtime: () => ({ state: 'connected', hasEverConnected: true, socket: fakeSocket }),
}))

const { ChatPage } = await import('./ChatPage')

const ADMIN = makeStaff({ id: 'staff_a', role: 'admin' })

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
    lastActivityAt: '2026-10-14T08:00:00.000Z',
    archivedAt: null,
    unreadCount: 0,
    ...over,
  }
}

const MESSAGE: ChatMessage = {
  id: 'm1',
  conversationId: 'c1',
  seq: '1',
  authorKind: 'contact',
  authorId: 'parent-1',
  authorDisplayName: 'Parent One',
  type: 'text',
  body: 'body m1',
  visibility: 'customer',
  moderation: 'published',
  clientMessageId: null,
  deletedForAll: false,
  createdAt: '2026-10-14T08:00:00.000Z',
  attachments: [],
} as ChatMessage

const WITH_PARENT = conv('c1', {
  members: [
    { actorId: 'staff_a', actorKind: 'staff', memberRole: 'admin', isSilent: false, displayName: 'Admin A' },
    { actorId: 'parent-1', actorKind: 'contact', memberRole: 'parent', isSilent: false, displayName: 'Parent One' },
  ],
})

const PARENT = {
  id: 'parent-1',
  name: 'Parent One',
  relationship: 'parent',
  isActive: true,
  avatarUrl: null,
  family: { id: 'fam-1', name: 'One family' },
  contact: { phone: '+20 100 555 0101', email: null, countryCode: null, subdivisionCode: null, location: null, locationSource: null, locationUpdatedAt: null, region: null },
  suggestedCountryCode: null,
  suggestedCallingCode: null,
  timeZone: { app: null, estimate: null, mismatch: false },
  adminNote: null,
  childrenCount: 2,
  children: [
    { id: 'k1', name: 'Kid One', avatarUrl: null },
    { id: 'k2', name: 'Kid Two', avatarUrl: null },
  ],
  updatedAt: null,
  access: { canEdit: false },
}

const person = { id: 's', name: 'Someone' }
const BILLING = {
  familyId: 'fam-1',
  today: '2026-11-27',
  paymentMethod: 'bank_transfer',
  currency: 'EGP',
  planMonths: 3,
  settingsVersion: 'v1',
  instalments: [
    { id: 'i1', planId: null, label: 'Term 2/4', child: null, amountMinor: 360000, currency: 'EGP', dueDate: '2026-10-26', status: 'overdue', days: 32, createdAt: '2026-09-01T08:00:00.000Z', createdBy: person, payment: null, void: null, paidMinor: 0, remainingMinor: 360000, partial: false, requestId: null },
    { id: 'i2', planId: null, label: 'Term 3/4', child: null, amountMinor: 360000, currency: 'EGP', dueDate: '2026-12-26', status: 'upcoming', days: 29, createdAt: '2026-09-01T08:00:00.000Z', createdBy: person, payment: null, void: null, paidMinor: 0, remainingMinor: 360000, partial: false, requestId: null },
  ],
  totals: [{ currency: 'EGP', paidMinor: 360000, outstandingMinor: 1800000, overdueMinor: 960000 }],
  canRecord: true,
  requests: [
    { id: 'r1', purpose: 'instalment', label: 'Package 2/3', status: 'open', amountMinor: 240000, paidMinor: 0, remainingMinor: 240000, currency: 'EGP', child: null, instalmentId: null, planMonths: null, periodStart: null, periodEnd: null, expiresAt: '2026-12-10T00:00:00.000Z', createdAt: '2026-11-20T08:00:00.000Z' },
  ],
  payments: [
    { id: 'p0', method: 'cash', amountMinor: 100000, refundedMinor: 0, currency: 'EGP', paidOn: '2026-08-28', recordedAt: '2026-08-28T10:00:00.000Z', requestId: null, instalmentId: null, child: null, reference: null, invoice: null },
    { id: 'p1', method: 'cash', amountMinor: 360000, refundedMinor: 0, currency: 'EGP', paidOn: '2026-09-28', recordedAt: '2026-09-28T10:00:00.000Z', requestId: null, instalmentId: null, child: null, reference: null, invoice: null },
  ],
  invoices: [],
  receipts: [],
  canVerify: false,
  cardAvailable: false,
}

type Answer = unknown | { status: number }
const refused = (status: number): Answer => ({ status })

/** GET by path; anything not listed is a 404, as the real API answers what it does not offer. */
function stubApi(conversations: ChatConversation[], routes: Record<string, Answer> = {}) {
  const calls: string[] = []
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api\/v1/, '')
      calls.push(path)
      if (path in routes) {
        const answer = routes[path]
        const status = (answer as { status?: number } | null)?.status
        return typeof status === 'number' && Object.keys(answer as object).length === 1
          ? json({ error: { code: status === 403 ? 'AUTH.FORBIDDEN' : 'NOT_FOUND', message: 'no' } }, status)
          : json(answer)
      }
      if (path === '/me') return json(ADMIN)
      if (path === '/conversations') return json({ conversations })
      if (path === '/presence') return json({ presence: [] })
      const m = path.match(/^\/conversations\/([^/]+)(\/messages(\/read)?)?$/)
      if (m) {
        const id = decodeURIComponent(m[1]!)
        if (!m[2]) return json(conversations.find((c) => c.id === id) ?? {})
        if (m[3]) return json({ ok: true })
        return json({ messages: [{ ...MESSAGE, conversationId: id }], nextBefore: null })
      }
      return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)
    }),
  )
  return calls
}

function Where() {
  const { pathname } = useLocation()
  return <output data-testid="where">{pathname}</output>
}

function renderChat(route = '/chat') {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:conversationId" element={<ChatPage />} />
      </Routes>
      <Where />
    </>,
    { route, staff: ADMIN },
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('the thread pane before a conversation is chosen', () => {
  it('orders what waits: needing a reply before merely unread, the longest wait first; archived and closed left out', () => {
    const order = waitingFirst([
      conv('read'),
      conv('unread-old', { unreadCount: 2, lastActivityAt: '2026-10-10T08:00:00.000Z' }),
      conv('needs-new', { needsReply: true, lastActivityAt: '2026-10-14T09:00:00.000Z' }),
      conv('needs-old', { needsReply: true, lastActivityAt: '2026-10-12T08:00:00.000Z' }),
      conv('needs-archived', { needsReply: true, viewerState: { archived: true } as ChatConversation['viewerState'] }),
      conv('needs-closed', { needsReply: true, archivedAt: '2026-10-13T08:00:00.000Z' }),
    ]).map((c) => c.id)
    expect(order).toEqual(['needs-old', 'needs-new', 'unread-old'])
  })

  it('names the conversation to answer first, says how many more wait, and opens it', async () => {
    stubApi([
      conv('c1', { title: 'Read already' }),
      conv('c2', { title: 'Wrote today', needsReply: true, lastActivityAt: '2026-10-14T09:00:00.000Z' }),
      conv('c3', { title: 'Waited longest', needsReply: true, lastActivityAt: '2026-10-12T08:00:00.000Z' }),
    ])
    renderChat()
    const start = (await screen.findByRole('button', { name: 'Open conversation' })).closest('.cw-start') as HTMLElement
    expect(within(start).getByRole('heading', { level: 2, name: 'Waited longest' })).toBeInTheDocument()
    expect(within(start).getByText('Needs reply')).toBeInTheDocument()
    expect(within(start).getByText('and 1 more waiting')).toBeInTheDocument()

    fireEvent.click(within(start).getByRole('button', { name: 'Open conversation' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/chat/c3')
  })

  it('says so in one calm line when nothing waits', async () => {
    stubApi([conv('c1')])
    renderChat()
    expect(await screen.findByText('No conversation is waiting for a reply.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open conversation' })).not.toBeInTheDocument()
  })
})

describe('the list from the keyboard', () => {
  const rows = () => [...document.querySelectorAll<HTMLElement>('#chat-list .conv-row')]

  it('J and K walk the rows (by letter or by physical key), and stop at the ends', async () => {
    stubApi([conv('c1'), conv('c2'), conv('c3')])
    renderChat()
    await screen.findByText('Group c3')

    fireEvent.keyDown(document.body, { key: 'j', code: 'KeyJ' })
    expect(rows()[0]).toHaveFocus()
    fireEvent.keyDown(document.body, { key: 'j', code: 'KeyJ' })
    expect(rows()[1]).toHaveFocus()
    // An Arabic layout sends another letter from the same key.
    fireEvent.keyDown(document.body, { key: 'ت', code: 'KeyJ' })
    expect(rows()[2]).toHaveFocus()
    fireEvent.keyDown(document.body, { key: 'j', code: 'KeyJ' })
    expect(rows()[2]).toHaveFocus()
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK' })
    expect(rows()[1]).toHaveFocus()
  })

  it('leaves the keys alone while typing in a field or holding a modifier', async () => {
    stubApi([conv('c1'), conv('c2')])
    renderChat()
    await screen.findByText('Group c2')
    const search = screen.getByRole('searchbox', { name: 'Search chats and messages' })
    search.focus()
    fireEvent.keyDown(search, { key: 'j', code: 'KeyJ' })
    expect(search).toHaveFocus()
    // Ctrl/Cmd+K is the global search's, never the list's.
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', metaKey: true })
    expect(rows().some((r) => r === document.activeElement)).toBe(false)
  })

  it('Escape goes back to the list, but not from inside the message box', async () => {
    stubApi([conv('c1'), conv('c2')])
    renderChat('/chat/c1')
    const box = await screen.findByLabelText('Message')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.getByTestId('where')).toHaveTextContent('/chat/c1')

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/chat$/)
  })

  it('Escape closes an open dialog first and stays in the conversation', async () => {
    stubApi([WITH_PARENT])
    renderChat('/chat/c1')
    await screen.findByLabelText('Message')
    fireEvent.click(screen.getByRole('button', { name: 'Conversation info' }))
    const sheet = await screen.findByRole('dialog', { name: 'Group info' })
    fireEvent.keyDown(sheet, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Group info' })).not.toBeInTheDocument())
    expect(screen.getByTestId('where')).toHaveTextContent('/chat/c1')
  })
})

describe('the family beside the conversation', () => {
  const FAMILY_ROUTES = {
    '/instalments/access': { billingReader: true },
    '/parent-profiles/parent-1': PARENT,
    '/families/fam-1/billing': BILLING,
    '/learners/k1/profile': { id: 'k1', name: 'Kid One', avatarUrl: null, age: null, course: null, teacher: { id: 't9', name: 'Teacher Nine' }, schedule: [], viewer: 'staff' },
  }
  const openInfo = async () => {
    await screen.findByLabelText('Message')
    fireEvent.click(screen.getByRole('button', { name: 'Conversation info' }))
    return screen.findByRole('dialog', { name: 'Group info' })
  }

  it('shows the parent, the children with their teacher, the package, the last payment, what is due and the open request', async () => {
    stubApi([WITH_PARENT], FAMILY_ROUTES)
    renderChat('/chat/c1')
    const sheet = await openInfo()
    const family = await within(sheet).findByRole('region', { name: 'Family' })

    expect(within(family).getByRole('link', { name: 'Parent One' })).toHaveAttribute('href', '/parents/parent-1')
    expect(within(family).getByText('+20 100 555 0101')).toHaveAttribute('dir', 'ltr')
    // What is owed, in the display face; late money is marked late.
    const figure = within(family).getByText('18,000.00')
    expect(figure).toHaveClass('numeral')
    expect(figure.closest('.cw-fam__sum')).toHaveClass('cw-fam__sum--late')
    expect(within(family).getByText(/9,600\.00 overdue · 32 days late/)).toBeInTheDocument()
    // Children link to their profiles; a teacher shows where the server answered, and is simply absent where it did not.
    expect(within(family).getByRole('link', { name: 'Kid One' })).toHaveAttribute('href', '/students/k1')
    expect(await within(family).findByText('Teacher Nine')).toBeInTheDocument()
    expect(within(family).getByRole('link', { name: 'Kid Two' })).toBeInTheDocument()
    expect(within(family).getByText('3-month plan')).toBeInTheDocument()
    // The newest payment, not the first in the list.
    expect(within(family).getByText(/3,600\.00/)).toBeInTheDocument()
    expect(within(family).queryByText(/1,000\.00/)).not.toBeInTheDocument()
    expect(within(family).getByText('Package 2/3')).toBeInTheDocument()
    expect(within(family).getByRole('link', { name: 'Parent profile' })).toHaveAttribute('href', '/parents/parent-1')
  })

  it('opens the Parent Profile dialogs for recording and requesting a payment', async () => {
    stubApi([WITH_PARENT], FAMILY_ROUTES)
    renderChat('/chat/c1')
    const sheet = await openInfo()
    const family = await within(sheet).findByRole('region', { name: 'Family' })
    const before = screen.getAllByRole('dialog').length
    fireEvent.click(within(family).getByRole('button', { name: 'Record payment' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(before + 1)
  })

  it('is money-blind when the server refuses the money: the parent stays, no figure, no zero, no payment buttons', async () => {
    stubApi([WITH_PARENT], { ...FAMILY_ROUTES, '/families/fam-1/billing': refused(403) })
    renderChat('/chat/c1')
    const sheet = await openInfo()
    const family = await within(sheet).findByRole('region', { name: 'Family' })
    expect(within(family).getByRole('link', { name: 'Parent One' })).toBeInTheDocument()
    expect(within(family).queryByText('Amount due')).not.toBeInTheDocument()
    expect(within(family).queryByText(/0\.00/)).not.toBeInTheDocument()
    expect(within(family).queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument()
    expect(within(family).queryByRole('button', { name: 'Request payment' })).not.toBeInTheDocument()
  })

  it('is absent, without a word, when the server refuses the family (403 or 404)', async () => {
    stubApi([WITH_PARENT], { ...FAMILY_ROUTES, '/parent-profiles/parent-1': refused(403), '/families/fam-1/billing': refused(404) })
    renderChat('/chat/c1')
    const sheet = await openInfo()
    await within(sheet).findByText('Members')
    await waitFor(() => expect(within(sheet).queryByRole('region', { name: 'Family' })).not.toBeInTheDocument())
    // Nothing of it is left behind: no heading, no figure, no action.
    expect(within(sheet).queryByText('Amount due')).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('link', { name: 'Parent profile' })).not.toBeInTheDocument()
  })

  it('does not ask for a family at all when the profile is not offered to this viewer', async () => {
    const calls = stubApi([WITH_PARENT], { '/instalments/access': { billingReader: false } })
    renderChat('/chat/c1')
    const sheet = await openInfo()
    await within(sheet).findByText('Members')
    expect(calls.some((p) => p.startsWith('/parent-profiles') || p.startsWith('/families'))).toBe(false)
  })
})

describe('an internal note cannot be mistaken for a message', () => {
  it('turns the whole composer to note paper and says who sees it; back to a message, both go', async () => {
    stubApi([conv('c1')])
    renderChat('/chat/c1')
    const box = await screen.findByLabelText('Message')
    const composer = box.closest('.cw-composer') as HTMLElement
    expect(composer).not.toHaveClass('cw-composer--internal')
    expect(screen.queryByText(/Staff only/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Internal note/ }))
    expect(composer).toHaveClass('cw-composer--internal')
    expect(within(composer).getByText('Staff only — the family and the teacher never see it')).toBeInTheDocument()

    fireEvent.click(within(composer).getByRole('button', { name: 'Message' }))
    expect(composer).not.toHaveClass('cw-composer--internal')
    expect(screen.queryByText(/Staff only/)).not.toBeInTheDocument()
  })
})

describe('who a monogram stands for', () => {
  it('tints by who the conversation is with', () => {
    expect(conversationTone({ type: 'family_group' })).toBe('parent')
    expect(conversationTone({ type: 'student_group' })).toBe('parent')
    expect(conversationTone({ type: 'trial_group' })).toBe('lead')
    expect(conversationTone({ type: 'teacher_supervision' })).toBe('teacher')
    expect(conversationTone({ type: 'department_room' })).toBe('staff')
    const direct = (kind: string) => ({ type: 'direct', members: [{ actorId: 'me', actorKind: 'staff' }, { actorId: 'x', actorKind: kind }] })
    expect(conversationTone(direct('contact'), 'me')).toBe('parent')
    expect(conversationTone(direct('teacher'), 'me')).toBe('teacher')
    expect(conversationTone(direct('staff'), 'me')).toBe('staff')
    expect(toneOfKind('contact')).toBe('parent')
    expect(toneOfKind('teacher')).toBe('teacher')
    expect(toneOfKind('staff')).toBe('staff')
  })

  it("a card's fallback text loses its leading pictograph and nothing else", () => {
    expect(cardFallbackText('\u{1F4C5} Scheduled call\nMonthly follow-up 5:30')).toBe('Scheduled call\nMonthly follow-up 5:30')
    expect(cardFallbackText('Plain words, 24 lessons')).toBe('Plain words, 24 lessons')
  })
})
