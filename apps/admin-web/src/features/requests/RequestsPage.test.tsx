import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { RequestsPage } from './RequestsPage'

/**
 * Requests, the hub over Trial lessons, New students, Certificates, Renewal
 * requests, Receipts and the Sales pipeline's due follow-ups: the type tabs
 * count each type and filter by it, the body is grouped by wait, each row says
 * why it is there in a sentence. It only reads, each list only when the account
 * has that list's page, and a list the server refuses is left out. Each row
 * opens on its own page with that request selected. Synthetic people only.
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

const queue = () => [...document.querySelectorAll<HTMLElement>('.rq-row')]
const whoOf = (row: HTMLElement) => row.querySelector('.rq-row__title')?.textContent
const openOf = (row: HTMLElement) => within(row).getByRole('link')
/** The type tabs: "All", then one per type the account reaches, each with its count. */
const tabs = () => [...(screen.queryByRole('group', { name: 'Request types' })?.querySelectorAll<HTMLElement>('.seg__item') ?? [])]
const tab = (name: RegExp) => within(screen.getByRole('group', { name: 'Request types' })).getByRole('button', { name })

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

describe('the Requests hub', () => {
  it('lists only what still waits, the longest wait first, each row saying what is asked and opening its own page on that request', async () => {
    everything()
    renderWithProviders(<RequestsPage />, { staff, route: '/requests' })
    await screen.findByText('Family Golf')
    await waitFor(() => expect(queue()).toHaveLength(6))
    expect(queue().map(whoOf)).toEqual(['Parent Delta', 'Prospect Alpha', 'Child Gamma', 'Child Omega', 'Child Renewing', 'Family Golf'])
    // One stated action per row: "Open", on the request's own page with that request selected where the page can.
    expect(queue().map((r) => openOf(r).getAttribute('href'))).toEqual([
      '/trials/new-students?filter=unassigned&open=ns-1',
      '/trials?filter=decision&open=tr-1',
      '/certificates?category=student&id=c-1',
      '/certificates?category=student&id=c%202',
      '/payments?tab=renewals',
      '/payments',
    ])
    expect(openOf(queue()[0]!)).toHaveAccessibleName('Open Parent Delta')
    expect(queue().every((r) => within(r).getAllByRole('link').length === 1 && within(r).queryByRole('button') === null)).toBe(true)
    // Type with its word, and why the row is here in one sentence that names who owns it.
    const [familyRow, trialRow, certificateRow, , renewalRow, receiptRow] = queue()
    expect(within(trialRow!).getByText('Trial lesson')).toBeInTheDocument()
    expect(within(trialRow!).getByText('Teacher One')).toBeInTheDocument()
    expect(trialRow!.querySelector('.rq-why')).toHaveTextContent('The lesson with Teacher One is over; no outcome recorded yet')
    expect(familyRow!.querySelector('.rq-why')).toHaveTextContent('no supervisor assigned yet')
    expect(certificateRow!.querySelector('.rq-why')).toHaveTextContent('Supervisor One asked for it; waiting for the designer')
    expect(within(renewalRow!).getByText('Parent Echo')).toBeInTheDocument()
    expect(renewalRow!.querySelector('.rq-why')).toHaveTextContent('Parent Echo asked to renew')
    expect(receiptRow!.querySelector('.rq-why')).toHaveTextContent('not confirmed yet')
    // What is settled is not a request any more.
    for (const gone of ['Prospect Soon', 'Prospect Done', 'Parent Settled', 'Child Renewed']) expect(screen.queryByText(gone)).not.toBeInTheDocument()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('is grouped by wait: what has waited since before today first, counted in solid terracotta, then today', async () => {
    everything()
    // One receipt came in a moment ago; everything else has waited for days.
    const fresh = { id: 'rc-2', status: 'pending', requestId: 'pr-2', label: 'Instalment 3', amountMinor: 90000, currency: 'EGP', transferredOn: '2026-10-23', note: null, uploadedAt: new Date().toISOString(), fileUrl: '', mimeType: 'image/png', rejectReason: null, paymentId: null, family: { id: 'f-8', name: 'Family Hotel' }, uploadedBy: { id: 'p-8', name: 'Parent Hotel' } }
    on('GET', /\/payment-receipts\?/, () => json({ items: [fresh], counts: { pending: 1, approved: 0, rejected: 0 }, canDecide: true }))
    renderWithProviders(<RequestsPage />, { staff, route: '/requests' })
    await screen.findByText('Family Hotel')
    await waitFor(() => expect(queue()).toHaveLength(6))
    const groups = screen.getAllByRole('region')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Waiting since before today', 'Today'])
    expect(groups[0]!.querySelector('.count')).toHaveClass('count--urgent')
    expect(groups[0]!.querySelector('.count')).toHaveTextContent(/^5$/)
    expect(groups[1]!.querySelector('.count')).not.toHaveClass('count--urgent')
    expect([...groups[1]!.querySelectorAll<HTMLElement>('.rq-row')].map(whoOf)).toEqual(['Family Hotel'])
    // Only what is late is drawn late.
    expect(groups[0]!.querySelectorAll('.rq-age--late')).toHaveLength(5)
    expect(groups[1]!.querySelector('.rq-age--late')).toBeNull()
    // Each type's tab counts what of it waits; its group says how much has waited since before today.
    expect(tab(/^Receipts/)).toHaveTextContent(/^Receipts1$/)
    expect(tab(/^Certificates/)).toHaveTextContent(/^Certificates2$/)
    await userEvent.click(tab(/^Certificates/))
    expect(screen.getByRole('region', { name: 'Waiting since before today' }).querySelector('.count')).toHaveTextContent(/^2$/)
  })

  it('the type tabs count each type and are the type filter: a tab filters, and again shows every type', async () => {
    everything()
    renderWithProviders(<RequestsPage />, { staff, route: '/requests' })
    await waitFor(() => expect(queue()).toHaveLength(6))
    expect(tabs().map((t) => t.textContent)).toEqual(['All6', 'Trial lessons1', 'New students1', 'Certificates2', 'Renewal requests1', 'Receipts1'])
    // No strip of the same numbers above the tabs.
    expect(document.querySelector('.figures')).toBeNull()
    await userEvent.click(tab(/^Certificates/))
    expect(tab(/^Certificates/)).toHaveAttribute('aria-pressed', 'true')
    expect(queue().map(whoOf)).toEqual(['Child Gamma', 'Child Omega'])
    await userEvent.click(tab(/^Certificates/))
    expect(tab(/^Certificates/)).toHaveAttribute('aria-pressed', 'false')
    expect(tab(/^All/)).toHaveAttribute('aria-pressed', 'true')
    expect(queue()).toHaveLength(6)
  })

  it('names its order by need: the longest wait first, or the newest first', async () => {
    everything()
    renderWithProviders(<RequestsPage />, { staff, route: '/requests' })
    await waitFor(() => expect(queue()).toHaveLength(6))
    const order = screen.getByRole('group', { name: 'Order' })
    expect(within(order).getByRole('button', { name: 'Longest wait first' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(order).getByRole('button', { name: 'Newest first' }))
    expect(queue().map(whoOf)).toEqual(['Family Golf', 'Child Renewing', 'Child Gamma', 'Child Omega', 'Prospect Alpha', 'Parent Delta'])
  })

  it('lists the Sales pipeline\'s due follow-ups from its own list read, opening the lead on the pipeline', async () => {
    everything()
    on('GET', /\/sales-pipeline\/leads\?/, () =>
      json({
        leads: [
          { id: 'lead-1', owner: { id: 'r-1', name: 'Rep One' }, displayName: 'Lead Alpha', level: null, stage: 'contacted', lostReason: null, manualStage: true, lastContactedAt: '2026-10-20T09:00:00Z', nextFollowUpOn: '2026-10-22', followUpDue: true, followUpNote: null, createdAt: '2026-10-19T09:00:00Z', handedOver: false, contact: { phone: true, whatsapp: false, email: false } },
        ],
        total: 1, counts: { new_lead: 0, contacted: 1, trial_booked: 0, trial_completed: 0, converted: 0, lost: 0 }, dueCount: 1, limit: 100, offset: 0, truncated: false,
      }),
    )
    renderWithProviders(<RequestsPage />, { staff, route: '/requests?type=lead' })
    await waitFor(() => expect(queue()).toHaveLength(1))
    const [lead] = queue()
    expect(whoOf(lead!)).toBe('Lead Alpha')
    expect(lead!.querySelector('.rq-why')).toHaveTextContent('Rep One planned a follow-up for')
    expect(openOf(lead!)).toHaveAttribute('href', '/sales/pipeline?open=lead-1')
    // Only the due follow-ups are asked for, and the lead itself (its contact) is never read here.
    expect(calls(/\/sales-pipeline\/leads\?.*followUp=due/)).toHaveLength(1)
    expect(calls(/\/sales-pipeline\/leads\/lead-1/)).toHaveLength(0)
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
    await screen.findByText('Prospect Alpha')
    // One type needs no tabs.
    expect(tabs()).toHaveLength(0)
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
    expect(tabs().map((t) => t.firstChild?.textContent)).toEqual(['All', 'Trial lessons', 'Certificates', 'Receipts'])
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
    expect(tab(/^New students/)).toHaveAttribute('aria-pressed', 'true')
    // A count that arrived as nothing is a zero; it is quiet, not an alarm.
    expect(tab(/^New students/)).toHaveTextContent(/^New students0$/)
    await userEvent.click(tab(/^New students/))
    expect(screen.getByText('Nothing is waiting.')).toBeInTheDocument()
    expect(screen.queryAllByRole('region')).toHaveLength(0)
  })
})
