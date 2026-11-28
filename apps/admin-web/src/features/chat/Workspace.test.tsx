import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders, makeStaff } from '@/test/utils'
import type { ChatConversation, ChatMessage } from './chatApi'
import { cardFallbackText, conversationName, conversationTone, hasOwnName, toneOfKind, westernDigits } from './chatView'
import { chatCopy, type ChatCopy } from './copy'
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
const { callWhen } = await import('./ChatThread')

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

/** A 1:1 with the parent: the family block lists the children itself (a lesson group lists its own under it). */
const DIRECT_WITH_PARENT = conv('c1', { type: 'direct', title: null, members: WITH_PARENT.members })

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

function renderChat(route = '/chat', locale: 'en' | 'ar' = 'en') {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:conversationId" element={<ChatPage />} />
      </Routes>
      <Where />
    </>,
    { route, staff: ADMIN, locale },
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
    // The reply queue: a heading with its count, then the waiting conversations as rows, the longest wait first.
    const first = await screen.findByRole('button', { name: 'Open: Waited longest' })
    const queue = first.closest('.cw-start') as HTMLElement
    expect(within(queue).getByRole('heading', { level: 2, name: /^Needs a reply\s*2$/ })).toBeInTheDocument()
    expect(within(queue).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Waited longest', 'Wrote today'])
    // One solid button on the pane: the conversation to take now.
    expect(first).toHaveClass('btn--primary')
    expect(within(queue).getByRole('button', { name: 'Open: Wrote today' })).not.toHaveClass('btn--primary')
    expect(within(queue).queryByText('Read already')).not.toBeInTheDocument()

    fireEvent.click(first)
    expect(screen.getByTestId('where')).toHaveTextContent('/chat/c3')
  })

  it('says so in one calm line when nothing waits, and lists what is unread', async () => {
    stubApi([conv('c1'), conv('c2', { title: 'Not read yet', unreadCount: 2 })])
    renderChat()
    expect(await screen.findByRole('heading', { level: 2, name: 'No conversation is waiting for a reply.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open: Not read yet' })).toBeInTheDocument()
  })

  it('with nothing waiting and nothing unread it is one calm line', async () => {
    stubApi([conv('c1')])
    renderChat()
    expect(await screen.findByText('No conversation is waiting for a reply.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open:/ })).not.toBeInTheDocument()
  })

  it('the list is the same queue in sections: needs a reply, unread, everything else, each with its count', async () => {
    stubApi([
      conv('c1', { title: 'Read already' }),
      conv('c2', { title: 'Wrote today', needsReply: true, lastActivityAt: '2026-10-14T09:00:00.000Z' }),
      conv('c3', { title: 'Waited longest', needsReply: true, lastActivityAt: '2026-10-12T08:00:00.000Z' }),
      conv('c4', { title: 'Not read yet', unreadCount: 2 }),
      conv('c5', { title: 'Pinned and read', viewerState: { pinned: true, archived: false, mutedUntil: null } }),
    ])
    renderChat()
    await screen.findByRole('button', { name: 'Open: Waited longest' })
    const list = document.getElementById('chat-list')!
    expect(within(list).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Needs a reply2', 'Unread1', 'Everything else2'])
    expect([...list.querySelectorAll('.conv-row__name')].map((n) => n.textContent)).toEqual([
      'Waited longest', 'Wrote today', 'Not read yet', 'Pinned and read', 'Read already',
    ])
    // A row carries ONE state at its end: how long it has waited, or what is unread.
    const waited = within(list).getByText('Waited longest').closest('.conv-row') as HTMLElement
    expect(waited.querySelector('.cw-row__waited')).not.toBeNull()
    expect(within(list).getByLabelText('2 unread')).toBeInTheDocument()
    // The tabs filter within the grouping.
    fireEvent.click(within(list).getByRole('button', { name: /^Unread/ }))
    expect([...list.querySelectorAll('.conv-row__name')].map((n) => n.textContent)).toEqual(['Not read yet'])
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
    fireEvent.click(screen.getByRole('button', { name: 'Group info' }))
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
  const openInfo = async (title = 'Group info') => {
    await screen.findByLabelText('Message')
    // The conversation's name in the header opens the panel.
    fireEvent.click(screen.getByRole('button', { name: title }))
    return screen.findByRole('dialog', { name: title })
  }

  it('Family tab: money first on its own sheet, then the children with teacher and next lesson, then the parent', async () => {
    stubApi([DIRECT_WITH_PARENT], {
      ...FAMILY_ROUTES,
      '/learners/k1/profile': {
        id: 'k1', name: 'Kid One', avatarUrl: null, age: null, course: null, teacher: { id: 't9', name: 'Teacher Nine' }, viewer: 'staff',
        schedule: [{ weekday: 6, start: '14:00', durationMinutes: 30, timezone: 'Africa/Cairo', nextStartsAt: '2026-11-28T12:00:00.000Z' }],
      },
    })
    renderChat('/chat/c1')
    const sheet = await openInfo('Contact info')
    // The family leads: its tab is the one open.
    expect(await within(sheet).findByRole('button', { name: 'Family', pressed: true })).toBeInTheDocument()

    const money = await within(sheet).findByRole('region', { name: 'Payments' })
    const figure = within(money).getByText('18,000.00')
    expect(figure).toHaveClass('numeral')
    expect(figure.closest('.cw-fam__sum')).toHaveClass('cw-fam__sum--late')
    // The currency sits where the payments formatter puts it, the same side as every other amount here.
    expect(figure.closest('.cw-fam__figure')).toHaveTextContent(/^EGP\s?18,000\.00$/)
    expect(within(money).getByText(/9,600\.00 overdue, 32 days late/)).toBeInTheDocument()
    // The newest payment, not the first in the list.
    expect(within(money).getByText(/3,600\.00/)).toBeInTheDocument()
    expect(within(money).queryByText(/1,000\.00/)).not.toBeInTheDocument()
    expect(within(money).getByText('Package 2/3')).toBeInTheDocument()
    expect(within(money).getByText('3-month plan')).toBeInTheDocument()
    // ONE solid button; the rest are quiet.
    expect(within(money).getByRole('button', { name: 'Record a payment' })).toHaveClass('btn--primary')
    expect(within(money).getByRole('button', { name: 'Request payment' })).not.toHaveClass('btn--primary')
    expect(within(money).getByRole('link', { name: 'Parent file' })).toHaveAttribute('href', '/parents/parent-1')

    // Children link to their profiles; a teacher and the next lesson show where the server answered.
    const children = within(sheet).getByRole('region', { name: 'Children' })
    expect(within(children).getByRole('link', { name: 'Kid One' })).toHaveAttribute('href', '/students/k1')
    expect(await within(children).findByText('Teacher Nine')).toBeInTheDocument()
    // 12:00 UTC is 14:00 in Cairo.
    expect(within(children).getByText(/^Next lesson: Sat 28 Nov, 2:00\sPM$/)).toBeInTheDocument()
    expect(within(children).getByRole('link', { name: 'Kid Two' })).toBeInTheDocument()

    const parent = within(sheet).getByRole('region', { name: 'Parent' })
    expect(within(parent).getByRole('link', { name: 'Parent One' })).toHaveAttribute('href', '/parents/parent-1')
    expect(within(parent).getByText('+20 100 555 0101')).toHaveAttribute('dir', 'ltr')
  })

  it('Conversation tab: members, notifications and, in a lesson group, its children in full', async () => {
    stubApi([WITH_PARENT], {
      ...FAMILY_ROUTES,
      '/conversations/c1/learners': {
        learners: [{ id: 'k1', name: 'Kid One', age: 9, course: null, packageLessons: 24, teacher: { id: 't9', name: 'Teacher Nine' }, schedule: [], canEdit: false }],
      },
    })
    renderChat('/chat/c1')
    const sheet = await openInfo()
    await within(sheet).findByRole('region', { name: 'Payments' })
    // One screen, one "Children" heading: the Family tab's.
    expect(within(sheet).getAllByText('Children')).toHaveLength(1)
    expect(within(sheet).queryByText('Members')).not.toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Conversation' }))
    expect(await within(sheet).findByText('Members')).toBeInTheDocument()
    expect(within(sheet).getByText('Notifications')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Add member' })).toBeInTheDocument()
    expect(within(sheet).getAllByText('Children')).toHaveLength(1)
    expect(within(sheet).queryByRole('region', { name: 'Payments' })).not.toBeInTheDocument()
  })

  it('opens the Parent Profile dialogs for recording and requesting a payment', async () => {
    stubApi([WITH_PARENT], FAMILY_ROUTES)
    renderChat('/chat/c1')
    const sheet = await openInfo()
    const money = await within(sheet).findByRole('region', { name: 'Payments' })
    const before = screen.getAllByRole('dialog').length
    fireEvent.click(within(money).getByRole('button', { name: 'Record a payment' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(before + 1)
  })

  it('the thread header carries the one urgent fact: late money as a solid tag', async () => {
    stubApi([WITH_PARENT], FAMILY_ROUTES)
    renderChat('/chat/c1')
    const head = (await screen.findByRole('button', { name: 'Group info' })).closest('.thread-head') as HTMLElement
    const fact = await within(head).findByText(/9,600\.00 late/)
    expect(fact).toHaveClass('badge--danger')
    // It opens the panel on the family.
    fireEvent.click(fact.closest('button')!)
    expect(await screen.findByRole('dialog', { name: 'Group info' })).toBeInTheDocument()
  })

  it('money merely due is said in ink, not as a problem; nothing due says nothing', async () => {
    const calm = { ...BILLING, totals: [{ currency: 'EGP', paidMinor: 360000, outstandingMinor: 360000, overdueMinor: 0 }] }
    stubApi([WITH_PARENT], { ...FAMILY_ROUTES, '/families/fam-1/billing': calm })
    renderChat('/chat/c1')
    const head = (await screen.findByRole('button', { name: 'Group info' })).closest('.thread-head') as HTMLElement
    const due = await within(head).findByText(/3,600\.00 due/)
    expect(due).not.toHaveClass('badge--danger')
    expect(within(head).queryByText(/late/)).not.toBeInTheDocument()
  })

  it('is money-blind when the server refuses the money: the parent stays, no figure, no zero, no payment buttons', async () => {
    stubApi([DIRECT_WITH_PARENT], { ...FAMILY_ROUTES, '/families/fam-1/billing': refused(403) })
    renderChat('/chat/c1')
    const sheet = await openInfo('Contact info')
    const parent = await within(sheet).findByRole('region', { name: 'Parent' })
    expect(within(parent).getByRole('link', { name: 'Parent One' })).toBeInTheDocument()
    expect(within(sheet).queryByRole('region', { name: 'Payments' })).not.toBeInTheDocument()
    expect(within(sheet).queryByText('Amount due')).not.toBeInTheDocument()
    expect(within(sheet).queryByText(/0\.00/)).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Record a payment' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Request payment' })).not.toBeInTheDocument()
    // Nothing about money in the header either.
    expect(document.querySelector('.cw-head__fact')).toBeNull()
  })

  it('has no Family tab at all, without a word, when the server refuses the family (403 or 404)', async () => {
    stubApi([WITH_PARENT], { ...FAMILY_ROUTES, '/parent-profiles/parent-1': refused(403), '/families/fam-1/billing': refused(404) })
    renderChat('/chat/c1')
    const sheet = await openInfo()
    await within(sheet).findByText('Members')
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Family' })).not.toBeInTheDocument())
    // Nothing of it is left behind: no heading, no figure, no action.
    expect(within(sheet).queryByText('Amount due')).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('link', { name: 'Parent file' })).not.toBeInTheDocument()
  })

  it('does not ask for a family at all when the profile is not offered to this viewer', async () => {
    const calls = stubApi([WITH_PARENT], { '/instalments/access': { billingReader: false } })
    renderChat('/chat/c1')
    const sheet = await openInfo()
    await within(sheet).findByText('Members')
    expect(within(sheet).queryByRole('button', { name: 'Family' })).not.toBeInTheDocument()
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

describe('reference cards in the thread', () => {
  it('draws a case escalated by the system as a card with the way to the case, not as a system line', async () => {
    const room = conv('c1', { type: 'department_room', familyId: null, title: 'Teachers' })
    const card = {
      ...MESSAGE,
      id: 'k1',
      authorKind: 'system',
      authorId: null,
      authorDisplayName: null,
      type: 'card',
      body: '\u{1F4CC} New escalation',
      card: { kind: 'case_escalated', lessonId: null, payload: { caseId: 'case-7', ownerId: 'o1', ownerName: 'Owner One', openedBy: 'p1', openedByName: 'Opener One' } },
    }
    stubApi([room], { '/conversations/c1/messages': { messages: [card], nextBefore: null } })
    renderChat('/chat/c1')
    const link = await screen.findByRole('link', { name: 'Open in Escalations' })
    expect(link).toHaveAttribute('href', '/cases?case=case-7')
    const row = link.closest('li') as HTMLElement
    expect(row).toHaveClass('cw-msg--card')
    expect(row).not.toHaveClass('bubble-row--system')
    // Jawwid posted it: there is no sender to picture, and, as when it was a system line, nothing to do to it.
    expect(row.querySelector('.cw-msg__avatar')).toBeNull()
    expect(within(row).queryByRole('button', { name: 'Message options' })).not.toBeInTheDocument()
  })

  it('draws a card it has no drawing for from its own words: the first line is the title, the leading mark is dropped', async () => {
    const group = conv('c1', { type: 'trial_group', title: 'Teacher One' })
    const card = {
      ...MESSAGE,
      id: 'k2',
      authorKind: 'system',
      authorId: null,
      authorDisplayName: null,
      type: 'card',
      body: '\u{1F5D3} Trial lesson for Kid One\nWhen: Saturday 13:00\nLength: 30 minutes',
      card: { kind: 'trial_booked', lessonId: null, payload: {} },
    }
    stubApi([group], { '/conversations/c1/messages': { messages: [card], nextBefore: null } })
    renderChat('/chat/c1')
    const title = await screen.findByText('Trial lesson for Kid One')
    expect(title).toHaveClass('cw-card__title')
    const row = title.closest('li') as HTMLElement
    expect(row).toHaveClass('cw-msg--card')
    expect(within(row).getByText('When: Saturday 13:00')).toBeInTheDocument()
    expect(within(row).getByText('Length: 30 minutes')).toBeInTheDocument()
  })
})

describe("lines read in the pane's direction, words in their own", () => {
  it('"You:" leads a preview and what was said follows it, isolated; a name sits in its own isolated box', async () => {
    stubApi([
      conv('c1', {
        title: 'Latin Name',
        lastMessage: { seq: '1', type: 'text', text: 'Of course, I will send it.', systemKind: null, authorKind: 'staff', authorId: ADMIN.id, deleted: false, createdAt: '2026-10-14T08:00:00.000Z' },
      }),
    ])
    renderChat()
    const name = await screen.findByText('Latin Name')
    expect(name.tagName).toBe('BDI')
    expect(name.parentElement).toHaveClass('conv-row__name')
    const sub = name.closest('.conv-row')!.querySelector('.conv-row__sub') as HTMLElement
    // The line itself has no direction of its own: it follows the pane.
    expect(sub).not.toHaveAttribute('dir')
    expect(sub.firstElementChild).toHaveClass('cw-row__who')
    expect(sub.firstElementChild).toHaveTextContent('You:')
    expect(within(sub).getByText('Of course, I will send it.').tagName).toBe('BDI')
  })

  it("joins the names it composes with the UI language's separator, and leaves a given title alone", () => {
    const people = conv('c1', {
      type: 'direct',
      title: null,
      members: [
        { actorId: 'a', actorKind: 'contact', memberRole: 'parent', isSilent: false, displayName: 'Ghada E' },
        { actorId: 'b', actorKind: 'teacher', memberRole: 'teacher', isSilent: false, displayName: 'Heba R' },
      ],
    })
    expect(conversationName(people, 'me', chatCopy.en as ChatCopy)).toBe('Ghada E, Heba R')
    expect(conversationName(people, 'me', chatCopy.ar as unknown as ChatCopy)).toBe('Ghada E، Heba R')
    expect(conversationName({ ...people, title: 'A · B — C' }, 'me', chatCopy.en as ChatCopy)).toBe('A · B — C')
  })

  it('a conversation with no name of its own shows the conversations glyph, not initials of its kind', async () => {
    stubApi([conv('c1', { type: 'direct', title: null, members: [] }), conv('c2', { title: 'Named Group' })])
    renderChat()
    const named = (await screen.findByText('Named Group')).closest('.conv-row') as HTMLElement
    expect(named.querySelector('.avatar')).toHaveTextContent('NG')
    const blank = screen.getByText('Direct conversation', { selector: '.conv-row__name bdi' }).closest('.conv-row') as HTMLElement
    expect(blank.querySelector('.avatar')).toHaveClass('avatar--blank')
    expect(blank.querySelector('.avatar')).toHaveTextContent('')
    expect(hasOwnName(conv('x', { title: null }), 'me')).toBe(false)
  })
})

describe('the message box', () => {
  it("reads in the UI's direction while empty, and in the text's own once there is text", async () => {
    stubApi([conv('c1')])
    renderChat('/chat/c1', 'ar')
    const box = await screen.findByLabelText(chatCopy.ar.customer)
    expect(box).toHaveAttribute('dir', 'rtl')
    fireEvent.change(box, { target: { value: 'Hello' } })
    expect(box).toHaveAttribute('dir', 'auto')
    fireEvent.change(box, { target: { value: '' } })
    expect(box).toHaveAttribute('dir', 'rtl')
  })

  it('in English an empty box is left-to-right, and Send says its key', async () => {
    stubApi([conv('c1')])
    renderChat('/chat/c1')
    expect(await screen.findByLabelText('Message')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('title', 'Send (Enter)')
  })
})

describe('"I\'m away" is a quiet action in the list header', () => {
  it('is offered once, in the header, when the server says this supervisor may hand over', async () => {
    stubApi([conv('c1')], { '/me/cover': { canHandOver: true, away: null, covering: [] } })
    renderChat()
    const away = await screen.findByRole('button', { name: "I'm away" })
    expect(screen.getAllByRole('button', { name: "I'm away" })).toHaveLength(1)
    expect(away.closest('.workspace__title-row')).not.toBeNull()
    expect(away).toHaveAttribute('title', "I'm away")
  })

  it('is absent when the server does not offer it', async () => {
    stubApi([conv('c1')], { '/me/cover': { canHandOver: false, away: null, covering: [] } })
    renderChat()
    await screen.findByText('Group c1')
    expect(screen.queryByRole('button', { name: "I'm away" })).not.toBeInTheDocument()
  })
})

describe('Western digits in what Jawwid wrote', () => {
  it('folds Arabic-Indic and Extended Arabic-Indic digits, and nothing else', () => {
    expect(westernDigits('٢٩ نوفمبر ٠٥:٠٠')).toBe('29 نوفمبر 05:00')
    expect(westernDigits('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890')
    expect(westernDigits('Room 12, الأحد')).toBe('Room 12, الأحد')
  })

  it('a scheduled call says when in the UI language, on the academy clock, with Western digits', () => {
    // 15:00 UTC is 17:00 in Cairo.
    // (The space before PM is a narrow one on some ICU versions.)
    expect(callWhen('2026-11-29T15:00:00.000Z', 'en')).toMatch(/^Sun 29 Nov, 5:00\sPM \(Cairo time\)$/)
    const ar = callWhen('2026-11-29T15:00:00.000Z', 'ar')
    expect(ar).toMatch(/29/)
    expect(ar).toMatch(/5:00/)
    expect(ar).not.toMatch(/[٠-٩۰-۹]/)
    expect(callWhen('not a date', 'en')).toBe('')
  })

  it('a booked trial is set from its instant in the UI language, not from the sentence the server wrote', async () => {
    const group = conv('c1', { type: 'trial_group', title: 'Teacher One' })
    const card = {
      ...MESSAGE,
      id: 'k1',
      authorKind: 'system',
      authorId: null,
      authorDisplayName: null,
      type: 'card',
      body: '\u{1F5D3} حصة تجريبية\nالموعد: ٢٨ نوفمبر',
      card: { kind: 'trial_booked', lessonId: null, payload: { startsAt: '2026-11-28T14:30:00.000Z', prospectName: 'Kid One, Kid Two', durationMinutes: 30, level: 'beginner', when: '٢٨ نوفمبر' } },
    }
    stubApi([group], { '/conversations/c1/messages': { messages: [card], nextBefore: null } })
    renderChat('/chat/c1')
    expect(await screen.findByText('Trial lesson: Kid One, Kid Two')).toHaveClass('cw-card__title')
    // 14:30 UTC is 16:30 in Cairo.
    expect(screen.getByText(/^When: Sat 28 Nov, 4:30\sPM \(Cairo time\)$/)).toBeInTheDocument()
    expect(screen.getByText('Length: 30 min')).toBeInTheDocument()
    expect(screen.getByText('Level: beginner')).toBeInTheDocument()
    expect(screen.queryByText(/[٠-٩]/)).not.toBeInTheDocument()
  })

  it("a card Jawwid posted is drawn with Western digits; a person's own words in a card are left as typed", async () => {
    const group = conv('c1', { type: 'trial_group', title: 'Teacher One' })
    const base = { ...MESSAGE, type: 'card', card: { kind: 'trial_booked', lessonId: null, payload: {} } }
    const fromSystem = { ...base, id: 'k1', seq: '1', authorKind: 'system', authorId: null, authorDisplayName: null, body: 'Trial lesson\nLength: ٣٠ minutes' }
    const fromPerson = { ...base, id: 'k2', seq: '2', authorKind: 'teacher', authorId: 't1', authorDisplayName: 'Teacher One', body: 'Lesson note\nMemorised ٣ verses' }
    stubApi([group], { '/conversations/c1/messages': { messages: [fromPerson, fromSystem], nextBefore: null } })
    renderChat('/chat/c1')
    expect(await screen.findByText('Length: 30 minutes')).toBeInTheDocument()
    expect(screen.getByText('Memorised ٣ verses')).toBeInTheDocument()
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
    expect(cardFallbackText('\u23F8\uFE0F Lessons are paused')).toBe('Lessons are paused')
    expect(cardFallbackText('Plain words, 24 lessons')).toBe('Plain words, 24 lessons')
    // Only the mark the card leads with: words further in are the sender's.
    expect(cardFallbackText('Booked \u{1F4C5} for Sunday')).toBe('Booked \u{1F4C5} for Sunday')
  })
})
