import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { CertificateAccess, FullCertificate } from './api'

/**
 * Certificates as a request queue: the strip that counts every state, and the
 * detail panel that opens only when a row is opened. What the server allows and
 * what each act sends is proven in Certificates.test.tsx (the narrow width).
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

describe('the strip of states', () => {
  it('counts every state with the list read the page already uses, once each, and says when a list is longer', async () => {
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    const strip = await screen.findByRole('group', { name: 'Certificates by state' })
    await waitFor(() => expect(within(strip).getByRole('button', { name: /^Sent/ })).toHaveTextContent('1'))
    expect(within(strip).getByRole('button', { name: /^Pending/ })).toHaveTextContent('1+')
    expect(within(strip).getByRole('button', { name: /^Completed/ })).toHaveTextContent('1')
    expect(within(strip).getByRole('button', { name: /^In progress/ })).toHaveTextContent('0')
    // One read per state and no more: the open state's count is the list on screen.
    for (const status of ['suggested', 'pending', 'in_progress', 'completed', 'sent', 'closed']) {
      expect(calls('GET', new RegExp(`/certificates\\?.*status=${status}(&|$)`))).toHaveLength(1)
    }
  })

  it('a click opens that state, already loaded', async () => {
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    expect(await screen.findByRole('button', { name: 'Child Beta' })).toBeInTheDocument()
    const strip = screen.getByRole('group', { name: 'Certificates by state' })
    await waitFor(() => expect(within(strip).getByRole('button', { name: /^Completed/ })).toHaveTextContent('1'))
    await userEvent.click(within(strip).getByRole('button', { name: /^Completed/ }))
    expect(within(strip).getByRole('button', { name: /^Completed/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Child Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Child Beta' })).not.toBeInTheDocument()
  })
})

describe('the detail panel, from 1100px', () => {
  it('reads no certificate until a row is opened: until then there is no panel, and the queue has the width', async () => {
    viewport(true)
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    await screen.findByRole('button', { name: 'Child Beta' })
    expect(screen.queryByRole('complementary', { name: 'Certificate details' })).not.toBeInTheDocument()
    expect(calls('GET', /\/certificates\/c-[0-9]+$/)).toHaveLength(0)
  })

  it('an opened row shows its steps, offers exactly the server\'s actions, and keeps the one that ends it apart', async () => {
    viewport(true)
    on('POST', /\/certificates\/c-1\/approve$/, () => json({ certificate: certificate({ state: 'approved', actions: ['send'] }) }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    const strip = await screen.findByRole('group', { name: 'Certificates by state' })
    await userEvent.click(within(strip).getByRole('button', { name: /^Completed/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Child Alpha' }))
    const panel = screen.getByRole('complementary', { name: 'Certificate details' })
    expect(within(panel).getByRole('heading', { name: 'Child Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const steps = await within(panel).findByRole('list', { name: 'Steps' })
    expect(within(steps).getAllByRole('listitem').map((li) => li.querySelector('.rq-step__label')?.textContent)).toEqual([
      'Requested (done)', 'Design (done)', 'Review (now)', 'Sent to the group (next)',
    ])
    expect(within(panel).getAllByRole('button').map((b) => b.textContent).filter((t) => t && t !== 'Open')).toEqual([
      'Cancel request', 'Approve this design', 'Ask for a redesign',
    ])
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
    const strip = await screen.findByRole('group', { name: 'Certificates by state' })
    await userEvent.click(within(strip).getByRole('button', { name: /^Sent/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Child Omega' }))
    const panel = screen.getByRole('complementary', { name: 'Certificate details' })
    expect(await within(panel).findByRole('link', { name: 'Open the chat' })).toHaveAttribute('href', '/chat/conv%207')
    expect(within(within(panel).getByRole('list', { name: 'Steps' })).getAllByRole('listitem').at(-1)).toHaveTextContent('Sent to the group (done)')
  })
})
