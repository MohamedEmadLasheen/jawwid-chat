import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { CertificateAccess, FullCertificate } from './api'

/**
 * Certificates as a board by state: one column per list, fed by one read each,
 * cards that state the server's first allowed act, and the inspector that opens
 * only when a card is opened. What the server allows and what each act sends is
 * proven in Certificates.test.tsx (the narrow width).
 * Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
type Handler = (url: string, init: RequestInit) => Response
let routes: Array<[RegExp, string, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([pattern, method, handler])
const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)

function viewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: wide, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

const NO = { request: false, deliver: false, story: false, oversee: false }
const access: CertificateAccess = { canOpen: true, view: true, design: false, types: false, categories: { student: { request: true, deliver: true, story: true, oversee: false }, teacher: NO } }
const type = { id: 'type-1', key: 'juz_completed', labelEn: "Juz' completed", labelAr: 'إتمام جزء', isActive: true, needsJuz: true, needsPeriod: null }
const file = { id: 'f-2', revision: 2, fileName: 'c.png', mimeType: 'image/png', byteSize: 10, uploadedAt: '2026-10-29T09:00:00Z', uploadedBy: { id: 'd-1', name: 'Designer One' } }

function certificate(over: Partial<FullCertificate> = {}): FullCertificate {
  return {
    projection: 'full', id: 'c-1', category: 'student', type, state: 'uploaded', stateGroup: 'completed',
    learner: { id: 'l-1', name: 'Child Alpha' }, teacher: null, signatoryTeacher: { id: 't-1', name: 'Teacher One' },
    requestedBy: { id: 's-1', name: 'Supervisor One' }, suggestedBy: null,
    title: "Juz' completed", achievement: 'Juz 30', achievedOn: null, grade: null, printedName: 'Child Alpha', juz: 30, periodStart: null, periodEnd: null,
    designerNote: 'gold border', internalNote: null, publishStory: false, requestedAt: '2026-10-28T09:00:00Z', updatedAt: '2026-10-29T09:00:00Z',
    assignedDesigner: { id: 'd-1', name: 'Designer One' }, designStartedAt: '2026-10-28T10:00:00Z', returnMessage: null,
    currentFile: file, files: [file], approval: null, sent: null, suggestion: null, consent: null, story: null, cancelled: null,
    actions: ['approve', 'redesign', 'cancel'],
    history: [
      { seq: 1, kind: 'requested', fromState: null, toState: 'requested', actor: { id: 's-1', name: 'Supervisor One' }, note: null, at: '2026-10-28T09:00:00Z' },
      { seq: 2, kind: 'consent_recorded', fromState: 'uploaded', toState: 'uploaded', actor: { id: 's-1', name: 'Supervisor One' }, note: null, at: '2026-10-29T10:00:00Z' },
    ],
    ...over,
  }
}

const SENT = certificate({
  id: 'c-9', printedName: 'Child Omega', state: 'sent', stateGroup: 'sent', actions: [],
  approval: { fileId: 'f-2', by: { id: 's-1', name: 'Supervisor One' }, at: '2026-10-30T09:00:00Z' },
  sent: { at: '2026-10-31T09:00:00Z', by: { id: 's-1', name: 'Supervisor One' }, conversationId: 'conv 7' },
})

/** One list per state, as the server answers them. */
const LISTS: Record<string, { certificates: FullCertificate[]; nextCursor: string | null }> = {
  pending: { certificates: [certificate({ id: 'c-2', printedName: 'Child Beta', state: 'requested', stateGroup: 'pending', files: [], currentFile: null, actions: ['edit', 'cancel'] })], nextCursor: 'more' },
  completed: { certificates: [certificate()], nextCursor: null },
  sent: { certificates: [SENT], nextCursor: null },
}

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [pattern, m, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/certificates\/access$/, () => json(access))
  on('GET', /\/certificates\?/, (url) => json(LISTS[new URL(url, 'http://x').searchParams.get('status') ?? ''] ?? { certificates: [], nextCursor: null }))
  on('GET', /\/certificates\/c-1$/, () => json({ certificate: certificate() }))
  on('GET', /\/certificates\/c-9$/, () => json({ certificate: SENT }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const stated = (card: HTMLElement) => [...card.querySelectorAll('.row-actions2 > .btn')].map((b) => b.textContent)
const cardOf = (name: string) => screen.getByRole('heading', { name, level: 3 }).closest('article')!

describe('the board of states', () => {
  it('is one column per state in the order a certificate moves, each fed by the list read the page already uses, once', async () => {
    viewport(true)
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    const board = await screen.findByRole('group', { name: 'Certificates by state' })
    // Closed is kept behind its switch, and is not read until it is asked for.
    expect(within(board).getAllByRole('region').map((c) => c.getAttribute('aria-label'))).toEqual(['Suggested', 'Pending', 'In progress', 'Completed', 'Sent'])
    const count = (name: string) => within(board).getByRole('region', { name }).querySelector('.count')?.textContent
    // A list longer than its first page says so.
    expect(count('Pending')).toMatch(/^1\+/)
    expect(count('Completed')).toBe('1')
    expect(count('Sent')).toBe('1')
    expect(count('In progress')).toBe('0')
    expect(within(within(board).getByRole('region', { name: 'In progress' })).getByText('None here.')).toBeInTheDocument()
    expect(within(within(board).getByRole('region', { name: 'Completed' })).getByRole('heading', { name: 'Child Alpha' })).toBeInTheDocument()
    for (const status of ['suggested', 'pending', 'in_progress', 'completed', 'sent']) {
      expect(calls('GET', new RegExp(`/certificates\\?.*status=${status}(&|$)`))).toHaveLength(1)
    }
    expect(calls('GET', /\/certificates\?.*status=closed(&|$)/)).toHaveLength(0)
    // No strip of totals repeats what the columns already count.
    expect(document.querySelector('.figures')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Closed' }))
    expect(await within(board).findByRole('region', { name: 'Closed' })).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /\/certificates\?.*status=closed(&|$)/)).toHaveLength(1))
  })

  it('a card says whose, what kind and who asked, states the server\'s first allowed act and keeps the others behind "⋯"', async () => {
    viewport(true)
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    await screen.findByRole('heading', { name: 'Child Alpha' })
    const alpha = cardOf('Child Alpha')
    expect(within(alpha).getByText("Juz' completed")).toBeInTheDocument()
    expect(within(alpha).getByText('Supervisor One')).toBeInTheDocument()
    expect(stated(alpha)).toEqual(['Approve this design'])
    await userEvent.click(within(alpha).getByRole('button', { name: 'More actions: Child Alpha' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Ask for a redesign', 'Cancel request'])
    await userEvent.keyboard('{Escape}')
    expect(stated(cardOf('Child Beta'))).toEqual(['Edit request'])
    // A certificate with nothing left to do is a quiet card: it opens from its name, and offers nothing else.
    expect(stated(cardOf('Child Omega'))).toEqual([])
    expect(within(cardOf('Child Omega')).getByRole('button', { name: 'Child Omega' })).toBeInTheDocument()
    expect(within(cardOf('Child Omega')).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument()
  })

  it('an act chosen on a card is taken in the inspector: one that owes a reason asks for it; an approval waits for the design to be on screen', async () => {
    viewport(true)
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    await screen.findByRole('heading', { name: 'Child Alpha' })
    await userEvent.click(within(cardOf('Child Alpha')).getByRole('button', { name: 'Approve this design' }))
    const panel = screen.getByRole('complementary', { name: 'Certificate details' })
    expect(await within(panel).findByRole('list', { name: 'Steps' })).toBeInTheDocument()
    // Nothing was approved from the card: the foot's button does that, with the design in view.
    expect(calls('POST', /\/approve$/)).toHaveLength(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(within(cardOf('Child Alpha')).getByRole('button', { name: 'More actions: Child Alpha' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ask for a redesign' }))
    expect(await screen.findByRole('dialog', { name: 'Ask for a redesign' })).toBeInTheDocument()
  })

  it('without room the states are tabs with their counts and the cards a list, opening on Pending', async () => {
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    expect(await screen.findByRole('button', { name: 'Child Beta' })).toBeInTheDocument()
    const tabs = screen.getByRole('group', { name: 'Certificates by state' })
    expect(within(tabs).getByRole('button', { name: /^Pending/ })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(within(tabs).getByRole('button', { name: /^Completed/ })).toHaveTextContent('1'))
    expect(within(tabs).getByRole('button', { name: /^Pending/ })).toHaveTextContent('1+')
    expect(within(tabs).getByRole('button', { name: /^In progress/ })).toHaveTextContent('0')
    await userEvent.click(within(tabs).getByRole('button', { name: /^Completed/ }))
    expect(within(tabs).getByRole('button', { name: /^Completed/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Child Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Child Beta' })).not.toBeInTheDocument()
  })
})

describe('the inspector, from 1100px', () => {
  it('reads no certificate until a card is opened: until then there is no inspector, and the board has the width', async () => {
    viewport(true)
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    await screen.findByRole('button', { name: 'Child Beta' })
    expect(screen.queryByRole('complementary', { name: 'Certificate details' })).not.toBeInTheDocument()
    expect(calls('GET', /\/certificates\/c-[0-9]+$/)).toHaveLength(0)
  })

  it('an opened card shows its steps; the foot states the first of the server\'s actions and keeps the rest behind "⋯", the one that ends it last', async () => {
    viewport(true)
    on('POST', /\/certificates\/c-1\/approve$/, () => json({ certificate: certificate({ state: 'approved', actions: ['send'] }) }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    await userEvent.click(await screen.findByRole('button', { name: 'Child Alpha' }))
    const panel = screen.getByRole('complementary', { name: 'Certificate details' })
    expect(within(panel).getByRole('heading', { name: 'Child Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const steps = await within(panel).findByRole('list', { name: 'Steps' })
    expect(within(steps).getAllByRole('listitem').map((li) => li.querySelector('.rq-step__label')?.textContent)).toEqual([
      'Requested (done)', 'Design (done)', 'Review (now)', 'Sent to the group (next)',
    ])
    const foot = panel.querySelector<HTMLElement>('.rq-foot')!
    expect(within(foot).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Approve this design', 'More actions: Child Alpha'])
    expect(within(foot).getByRole('button', { name: 'Approve this design' })).toHaveClass('btn--primary')
    await userEvent.click(within(foot).getByRole('button', { name: 'More actions: Child Alpha' }))
    // Exactly the server's other actions, nothing added: no send before approval.
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Ask for a redesign', 'Cancel request'])
    await userEvent.keyboard('{Escape}')
    expect(within(panel).queryByRole('button', { name: 'Send to group' })).not.toBeInTheDocument()
    // The history reads as the state it moved to, or the event's own name when the state stayed.
    const history = within(panel).getByRole('region', { name: 'History' })
    expect(within(history).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)).toEqual(['Pending', 'consent recorded'])

    await userEvent.click(within(panel).getByRole('button', { name: 'Approve this design' }))
    await waitFor(() => expect(calls('POST', /\/approve$/)).toHaveLength(1))
    expect(JSON.parse(String((calls('POST', /\/approve$/)[0]![1] as RequestInit).body))).toEqual({ fileId: 'f-2' })

    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary', { name: 'Certificate details' })).not.toBeInTheDocument()
  })

  it('a sent certificate links to the chat it was posted in', async () => {
    viewport(true)
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    await userEvent.click(await screen.findByRole('button', { name: 'Child Omega' }))
    const panel = screen.getByRole('complementary', { name: 'Certificate details' })
    expect(await within(panel).findByRole('link', { name: 'Open the chat' })).toHaveAttribute('href', '/chat/conv%207')
    expect(within(within(panel).getByRole('list', { name: 'Steps' })).getAllByRole('listitem').at(-1)).toHaveTextContent('Sent to the group (done)')
  })
})
