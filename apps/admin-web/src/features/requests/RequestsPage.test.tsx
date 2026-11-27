import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { RequestsPage } from './RequestsPage'

/**
 * The unified Requests page: one queue over Trial lessons, New students,
 * Certificates, Renewal requests and Receipts. It only reads, each list only
 * when the account has that list's page, and a list the server refuses is left
 * out. Each row leads to its own page. Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const refused = () => json({ error: { code: 'COMMON.FORBIDDEN', message: 'not for this account' } }, 403)
type Handler = (url: string, init: RequestInit) => Response
let routes: Array<[string, RegExp, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([method, pattern, handler])
const calls = (pattern: RegExp) => fetchMock.mock.calls.filter(([u]) => pattern.test(String(u)))

const staff = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })

const trial = (id: string, name: string, outcome: string) => ({
  id,
  prospect: { id: `p-${id}`, displayName: name, level: null },
  students: [{ name, level: null, note: null }],
  teacher: { id: 't-1', name: 'Teacher One' },
  startsAt: '2026-10-17T15:00:00Z',
  endsAt: '2026-10-17T15:30:00Z',
  durationMinutes: 30,
  attendance: 'attended',
  report: null,
  outcome,
})

const family = (trialId: string, parent: string, signedUp: boolean) => ({
  trialId,
  prospectName: 'Prospect',
  trialTeacher: null,
  trialAt: null,
  recordedAt: '2026-10-11T10:00:00Z',
  recordedBy: { id: 's-9', name: 'Sales One' },
  updatedAt: null,
  parent: { name: parent, email: null, phone: '+99 000 111' },
  children: [{ name: `Child of ${parent}`, age: 9, course: 'Course A', teacher: { id: 't-1', name: 'Teacher One' }, packagePrice: 1000, lessonPrice: 125, schedule: [] }],
  payment: { currency: 'EGP', method: 'invoice' },
  enrolment: signedUp
    ? { familyId: 'f-1', learnerIds: ['k-1'], supervisor: { id: 'sup-1', name: 'Supervisor Two' }, assignedAt: '2026-10-12T08:00:00Z', groupConversationId: 'c-1', canCreateGroup: false, parentSignup: { state: 'signed_up' } }
    : null,
})

const certificate = (id: string, name: string, state: string) => ({
  projection: 'full', id, category: 'student', type: { id: 'ty', key: 'juz', labelEn: "Juz' completed", labelAr: 'إتمام جزء', isActive: true, needsJuz: true, needsPeriod: null },
  state, stateGroup: 'pending', learner: null, teacher: null, signatoryTeacher: null, requestedBy: { id: 's-1', name: 'Supervisor One' }, suggestedBy: null,
  title: "Juz' completed", achievement: '', achievedOn: null, grade: null, printedName: name, juz: 30, periodStart: null, periodEnd: null, designerNote: null, internalNote: null,
  publishStory: false, requestedAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T09:00:00Z', assignedDesigner: null, designStartedAt: null, returnMessage: null,
  currentFile: null, files: [], approval: null, sent: null, suggestion: null, consent: null, story: null, cancelled: null, actions: [],
})

/** An account that has every requests page, each with something waiting and something that is not. */
function everything() {
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: true, operations: true }))
  on('GET', /\/instalments\/access$/, () => json({ billingReader: true, canAssignBillingSupervisor: false }))
  on('GET', /\/certificates\/access$/, () =>
    json({ canOpen: true, view: true, design: false, types: false, categories: { student: { request: true, deliver: true, story: true, oversee: false }, teacher: { request: false, deliver: false, story: false, oversee: false } } }),
  )
  on('GET', /\/trials$/, () => json({ trials: [trial('tr-1', 'Prospect Alpha', 'awaiting'), trial('tr-2', 'Prospect Soon', 'upcoming'), trial('tr-3', 'Prospect Done', 'subscribed')] }))
  on('GET', /\/trials\/new-students$/, () => json({ students: [family('ns-1', 'Parent Delta', false), family('ns-2', 'Parent Settled', true)] }))
  on('GET', /\/certificates\?/, (url) => {
    const status = new URL(url, 'http://x').searchParams.get('status')
    return json({ certificates: status === 'pending' ? [certificate('c-1', 'Child Gamma', 'requested')] : status === 'completed' ? [certificate('c 2', 'Child Omega', 'uploaded')] : [], nextCursor: null })
  })
  on('GET', /\/subscriptions\/renewal-requests$/, () =>
    json({ requests: [
      { id: 'rn-1', child: { id: 'k-5', name: 'Child Renewing' }, familyId: 'f-5', parentName: 'Parent Echo', requestedAt: '2026-10-22T09:00:00Z', renewed: false },
      { id: 'rn-2', child: { id: 'k-6', name: 'Child Renewed' }, familyId: 'f-6', parentName: 'Parent Foxtrot', requestedAt: '2026-10-21T09:00:00Z', renewed: true },
    ] }),
  )
  on('GET', /\/payment-receipts\?/, () =>
    json({ items: [{ id: 'rc-1', status: 'pending', requestId: 'pr-1', label: 'Instalment 2', amountMinor: 125000, currency: 'EGP', transferredOn: '2026-10-23', note: null, uploadedAt: '2026-10-23T09:00:00Z', fileUrl: '', mimeType: 'image/png', rejectReason: null, paymentId: null, family: { id: 'f-7', name: 'Family Golf' }, uploadedBy: { id: 'p-7', name: 'Parent Golf' } }], counts: { pending: 1, approved: 0, rejected: 0 }, canDecide: true }),
  )
}

const queue = () => screen.getAllByRole('row').slice(1)
const whoOf = (row: HTMLElement) => within(row).getByRole('link')

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [m, pattern, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the Requests page', () => {
  it('lists only what still waits, the late ones first and then the longest wait, each row leading to its own page', async () => {
    everything()
    renderWithProviders(<RequestsPage />, { staff, route: '/requests' })
    await screen.findByRole('link', { name: 'Family Golf' })
    await waitFor(() => expect(queue()).toHaveLength(6))
    // Left since before today, oldest first: the family, the trial, the renewal, the receipt.
    // Then the certificates, which take days by nature and are never marked late.
    expect(queue().map((r) => whoOf(r).textContent)).toEqual(['Parent Delta', 'Prospect Alpha', 'Child Renewing', 'Family Golf', 'Child Gamma', 'Child Omega'])
    expect(queue().map((r) => whoOf(r).getAttribute('href'))).toEqual([
      '/trials/new-students?filter=unassigned',
      '/trials?filter=decision',
      '/payments?tab=renewals',
      '/payments',
      '/certificates?category=student&id=c-1',
      '/certificates?category=student&id=c%202',
    ])
    expect(queue().map((r) => r.querySelector('.rq-age--late') !== null)).toEqual([true, true, true, true, false, false])
    // Type with its word, owner, status as a word.
    const [familyRow, trialRow, renewalRow, receiptRow] = queue()
    expect(within(trialRow!).getByText('Trial lesson')).toBeInTheDocument()
    expect(within(trialRow!).getByText('Teacher One')).toBeInTheDocument()
    expect(within(trialRow!).getByText('Needs an outcome')).toBeInTheDocument()
    expect(within(familyRow!).getByText('Not assigned')).toBeInTheDocument()
    expect(within(renewalRow!).getByText('Parent Echo')).toBeInTheDocument()
    expect(within(receiptRow!).getByText('To confirm')).toBeInTheDocument()
    // What is settled is not a request any more.
    for (const gone of ['Prospect Soon', 'Prospect Done', 'Parent Settled', 'Child Renewed']) expect(screen.queryByText(gone)).not.toBeInTheDocument()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('counts each type on the strip, and a click filters by type', async () => {
    everything()
    renderWithProviders(<RequestsPage />, { staff, route: '/requests' })
    await waitFor(() => expect(queue()).toHaveLength(6))
    const strip = screen.getByRole('group', { name: 'Requests by type' })
    const count = (name: RegExp) => within(strip).getByRole('button', { name }).querySelector('.ledger__value')?.textContent
    expect(count(/^All/)).toBe('6')
    expect(count(/^Trial lessons/)).toBe('1')
    expect(count(/^New students/)).toBe('1')
    expect(count(/^Certificates/)).toBe('2')
    expect(count(/^Renewal requests/)).toBe('1')
    expect(count(/^Receipts/)).toBe('1')
    await userEvent.click(within(strip).getByRole('button', { name: /^Certificates/ }))
    expect(within(strip).getByRole('button', { name: /^Certificates/ })).toHaveAttribute('aria-pressed', 'true')
    expect(queue().map((r) => whoOf(r).textContent)).toEqual(['Child Gamma', 'Child Omega'])
  })

  it('asks certificates only for the lists that still wait, in the categories the account reaches', async () => {
    everything()
    renderWithProviders(<RequestsPage />, { staff, route: '/requests' })
    await waitFor(() => expect(queue()).toHaveLength(6))
    for (const status of ['suggested', 'pending', 'in_progress', 'completed']) expect(calls(new RegExp(`/certificates\\?.*status=${status}`))).toHaveLength(1)
    expect(calls(/\/certificates\?.*status=(sent|closed)/)).toHaveLength(0)
    expect(calls(/\/certificates\?.*category=teacher/)).toHaveLength(0)
    // It only reads.
    expect(fetchMock.mock.calls.every(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET')).toBe(true)
  })

  it('asks for a list only when the account has its page', async () => {
    // A Teachers-department account: Trial lessons, and nothing else of these.
    on('GET', /\/lessons\/access$/, () => json({ lessonManager: true, sales: false, operations: false }))
    on('GET', /\/instalments\/access$/, () => json({ billingReader: false, canAssignBillingSupervisor: false }))
    on('GET', /\/certificates\/access$/, refused)
    on('GET', /\/trials$/, () => json({ trials: [trial('tr-1', 'Prospect Alpha', 'awaiting')] }))
    renderWithProviders(<RequestsPage />, { staff, route: '/requests' })
    await screen.findByRole('link', { name: 'Prospect Alpha' })
    const strip = screen.getByRole('group', { name: 'Requests by type' })
    expect(within(strip).getAllByRole('button').map((b) => b.querySelector('.ledger__label')?.textContent)).toEqual(['All', 'Trial lessons'])
    expect(calls(/\/trials\/new-students$/)).toHaveLength(0)
    expect(calls(/\/payment-receipts/)).toHaveLength(0)
    expect(calls(/\/subscriptions\/renewal-requests/)).toHaveLength(0)
    expect(calls(/\/certificates\?/)).toHaveLength(0)
  })

  it('leaves out a list the server refuses, without an error', async () => {
    everything()
    on('GET', /\/subscriptions\/renewal-requests$/, refused)
    on('GET', /\/trials\/new-students$/, refused)
    renderWithProviders(<RequestsPage />, { staff, route: '/requests' })
    await waitFor(() => expect(queue()).toHaveLength(4))
    const strip = screen.getByRole('group', { name: 'Requests by type' })
    expect(within(strip).getAllByRole('button').map((b) => b.querySelector('.ledger__label')?.textContent)).toEqual(['All', 'Trial lessons', 'Certificates', 'Receipts'])
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(document.querySelector('.state--forbidden, .banner--danger')).toBeNull()
  })

  it('says so in one line when nothing is waiting, and opens on the type the URL names', async () => {
    on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: true, operations: true }))
    on('GET', /\/instalments\/access$/, () => json({ billingReader: false, canAssignBillingSupervisor: false }))
    on('GET', /\/certificates\/access$/, refused)
    on('GET', /\/trials$/, () => json({ trials: [trial('tr-2', 'Prospect Soon', 'upcoming')] }))
    on('GET', /\/trials\/new-students$/, () => json({ students: [family('ns-2', 'Parent Settled', true)] }))
    renderWithProviders(<RequestsPage />, { staff, route: '/requests?type=family' })
    expect(await screen.findByText('Nothing of this type is waiting.')).toBeInTheDocument()
    const strip = screen.getByRole('group', { name: 'Requests by type' })
    expect(within(strip).getByRole('button', { name: /^New students/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(strip).getByRole('button', { name: /^All/ }))
    expect(screen.getByText('Nothing is waiting.')).toBeInTheDocument()
  })
})
