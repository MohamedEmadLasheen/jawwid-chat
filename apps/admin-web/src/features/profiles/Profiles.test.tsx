import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { destinationsFor, entriesOf } from '@/app/navigation'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { FamilyBilling, ParentProfile, StudentProfile, TimelineInstalment } from './api'
import { chooseOption } from '@/test/select'

/**
 * PD-17 Parent and Student Profiles, through the real routes and the real API
 * client, with `fetch` answered at the network boundary. These prove the
 * pages' side: what the server sends is shown (contact details, the internal
 * note, the payment timeline, the student's schedule), edits send only what
 * changed, money is recorded once and voided with a reason, a refusal is said
 * plainly, and the Parents entry is offered only on the server's word. Who may
 * open what is proven server-side (apps/api pd017-profiles.spec.ts and
 * pd017-http.spec.ts, where a teacher's own token is refused on every route).
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: Array<[RegExp, string, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
function on(method: string, pattern: RegExp, handler: Handler) {
  routes.unshift([pattern, method, handler])
}
const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
const bodyOf = (call: unknown[] | undefined) => {
  if (!call) throw new Error('the request was not sent')
  return JSON.parse(String((call[1] as RequestInit).body))
}

function parent(over: Partial<ParentProfile> = {}): ParentProfile {
  return {
    id: 'p-1',
    name: 'Parent Alpha',
    relationship: 'parent',
    isActive: true,
    avatarUrl: null,
    family: { id: 'f-1', name: 'Family Alpha' },
    contact: {
      phone: '+971 50 123 4567',
      email: 'alpha@example.test',
      countryCode: 'AE',
      subdivisionCode: 'AE-DU',
      location: {
        country: { code: 'AE', en: 'United Arab Emirates', ar: 'الإمارات العربية المتحدة' },
        subdivision: { code: 'AE-DU', en: 'Dubai', ar: 'دبي' },
        label: { en: 'Emirate', ar: 'الإمارة' },
      },
      locationSource: 'staff',
      locationUpdatedAt: '2026-10-20T10:00:00.000Z',
      region: null,
    },
    suggestedCountryCode: null,
    suggestedCallingCode: null,
    timeZone: { app: null, estimate: null, mismatch: false },
    adminNote: 'Prefers calls after 6 pm.',
    childrenCount: 2,
    children: [
      { id: 'k-1', name: 'Child One', avatarUrl: null },
      { id: 'k-2', name: 'Child Two', avatarUrl: null },
    ],
    updatedAt: null,
    access: { canEdit: true },
    ...over,
  }
}

function instalment(over: Partial<TimelineInstalment> = {}): TimelineInstalment {
  return {
    id: 'i-1',
    planId: null,
    label: 'Autumn term',
    child: null,
    amountMinor: 125050,
    currency: 'AED',
    dueDate: '2026-10-01',
    status: 'overdue',
    days: 20,
    createdAt: '2026-09-01T08:00:00.000Z',
    createdBy: { id: 's-1', name: 'Supervisor One' },
    payment: null,
    void: null,
    paidMinor: 0,
    remainingMinor: 125050,
    partial: false,
    requestId: null,
    ...over,
  }
}

function billing(over: Partial<FamilyBilling> = {}): FamilyBilling {
  return {
    familyId: 'f-1',
    today: '2026-10-21',
    paymentMethod: 'bank_transfer',
    currency: 'AED',
    planMonths: 3,
    settingsVersion: 'sv-1',
    instalments: [
      instalment(),
      instalment({
        id: 'i-2',
        label: 'Summer term',
        dueDate: '2026-07-01',
        status: 'paid',
        payment: { paidOn: '2026-07-02', method: 'invoice', reference: 'INV-7', recordedAt: '2026-07-02T09:00:00Z', recordedBy: { id: 's-1', name: 'Supervisor One' } },
      }),
      instalment({ id: 'i-3', label: 'Entered twice', status: 'voided', void: { at: '2026-09-02T09:00:00Z', by: { id: 's-1', name: 'Supervisor One' }, reason: 'duplicate' } }),
    ],
    totals: [{ currency: 'AED', paidMinor: 125050, outstandingMinor: 125050, overdueMinor: 125050 }],
    canRecord: true,
    requests: [],
    payments: [],
    invoices: [],
    receipts: [],
    canVerify: false,
    cardAvailable: false,
    ...over,
  }
}

function student(over: Partial<StudentProfile> = {}): StudentProfile {
  return {
    id: 'k-1',
    name: 'Child One',
    avatarUrl: null,
    age: 9,
    birthDate: '2017-03-04',
    course: { id: 'c-1', name: 'Tajweed' },
    teacher: { id: 't-1', name: 'Teacher Omega' },
    schedule: [
      { weekday: 1, start: '16:30', durationMinutes: 30, timezone: 'Africa/Cairo' },
      { weekday: 4, start: '17:00', durationMinutes: 45, timezone: 'Africa/Cairo' },
    ],
    family: { id: 'f-1', name: 'Family Alpha', parents: [{ id: 'p-1', name: 'Parent Alpha' }] },
    viewer: 'staff',
    ...over,
  }
}

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })
const superAdmin = makeStaff({ id: 'sa-1', name: 'Owner', role: 'super_admin' })

/** One of the masthead's key numbers, by its label. */
const figure = (label: string) => screen.getByText(label, { selector: '.figure__label' }).closest('.figure') as HTMLElement

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [pattern, m, handler] of routes) {
      if (m === method && pattern.test(url)) return handler(url, init)
    }
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/instalments\/access$/, () => json({ billingReader: true, canAssignBillingSupervisor: false }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the Parent Profile', () => {
  it('shows contact information, the internal note, the children and the payment information', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing()))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })

    expect(await screen.findByRole('heading', { level: 1, name: /^Parent Alpha/ })).toBeInTheDocument()
    expect(screen.getByText('Administration only')).toBeInTheDocument()
    // The file opens on Overview: who the family is, beside what waits.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    const contact = screen.getByRole('region', { name: 'Contact information' })
    expect(within(contact).getByText('+971 50 123 4567')).toHaveAttribute('dir', 'ltr')
    expect(within(contact).getByText('alpha@example.test')).toHaveAttribute('dir', 'ltr')
    expect(within(contact).getByText('United Arab Emirates')).toBeInTheDocument()
    expect(within(contact).getByText('Dubai')).toBeInTheDocument()
    // The number of children is one of the masthead's figures.
    expect(within(figure('Children')).getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Prefers calls after 6 pm.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Children' }))
    expect(screen.getByRole('tab', { name: 'Children' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('link', { name: 'View profile: Child One' })).toHaveAttribute('href', '/students/k-1')

    await userEvent.click(screen.getByRole('tab', { name: 'Money' }))
    const payments = await screen.findByRole('region', { name: 'Payment information' })
    expect(within(payments).getByText('3-month plan')).toBeInTheDocument()
    expect(within(payments).getByText('Bank transfer')).toBeInTheDocument()
    const timeline = screen.getByRole('region', { name: 'Payment timeline' })
    const entries = within(timeline).getAllByRole('listitem')
    expect(entries.map((e) => within(e).getByText(/term|twice/).textContent)).toEqual(['Autumn term', 'Summer term', 'Entered twice'])
    expect(within(entries[1]!).getByText(/Paid .* by Invoice · recorded by Supervisor One/)).toBeInTheDocument()
    expect(within(entries[2]!).getByText('Voided by Supervisor One: duplicate')).toBeInTheDocument()
    // A paid or voided instalment cannot be paid again; a voided one cannot be voided again.
    expect(within(entries[0]!).getByRole('button', { name: 'Record payment' })).toBeInTheDocument()
    expect(within(entries[1]!).queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument()
    // Void is in each row's menu now; a voided instalment has no menu, and nothing else to press.
    await userEvent.click(within(entries[1]!).getByRole('button', { name: /More actions/ }))
    expect(within(entries[1]!).getByRole('menuitem', { name: 'Void' })).toBeInTheDocument()
    expect(within(entries[2]!).queryByRole('button')).not.toBeInTheDocument()
  })

  it('reads the same in Arabic, right to left', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing()))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1', locale: 'ar' })
    expect(await screen.findByRole('region', { name: 'بيانات التواصل' })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
    expect(await screen.findByRole('region', { name: 'سجل المدفوعات' })).toBeInTheDocument()
    expect(screen.getByText('للإدارة فقط')).toBeInTheDocument()
    // Arabic counts months by number: 3 is أشهر, not شهر.
    expect(screen.getByText('باقة 3 أشهر')).toBeInTheDocument()
  })

  it('an edit sends only what changed; an emptied field is cleared', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing()))
    on('POST', /\/parent-profiles\/p-1$/, () => json(parent({ name: 'Parent Renamed', contact: { ...parent().contact, phone: null } })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit contact information' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit contact information' })
    const name = within(dialog).getByLabelText('Full name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Parent Renamed')
    await userEvent.clear(within(dialog).getByLabelText('Phone number'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/parent-profiles\/p-1$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/parent-profiles\/p-1$/)[0])).toEqual({ name: 'Parent Renamed', phone: null })
    expect(await screen.findByRole('heading', { level: 1, name: /^Parent Renamed/ })).toBeInTheDocument()
  })

  it('ADMIN-007: an edit of the payment settings names the version it was made from; a 409 shows the current settings', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing()))
    on('POST', /\/families\/f-1\/billing$/, () =>
      json({ error: { code: 'COMM.BILLING_STATE', message: 'these billing settings were changed since you opened them', detail: { current: { planMonths: 12 } } } }, 409))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1#money' })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit subscription and payment method' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit subscription and payment method' })
    await chooseOption(userEvent, within(dialog).getByLabelText('Plan'), '6')
    const readsBefore = calls('GET', /\/families\/f-1\/billing$/).length
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/families\/f-1\/billing$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/families\/f-1\/billing$/)[0])).toEqual({ planMonths: 6, version: 'sv-1' })
    // Refused: the dialog says so, and the family's settings are read again (what someone else saved).
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /\/families\/f-1\/billing$/).length).toBeGreaterThan(readsBefore))
  })

  it('adds a plan of instalments in minor units, records a payment once, and voids only with a reason', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing()))
    on('POST', /\/families\/f-1\/instalments$/, () => json(billing()))
    on('POST', /\/instalments\/i-1\/payment$/, () => json(billing()))
    on('POST', /\/instalments\/i-1\/void$/, () => json(billing()))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1#money' })

    await userEvent.click(await screen.findByRole('button', { name: 'Add instalments' }))
    let dialog = screen.getByRole('dialog', { name: 'Add instalments' })
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Winter term')
    await userEvent.type(within(dialog).getByLabelText('Amount of each instalment'), '1,250.50')
    await chooseOption(userEvent, within(dialog).getByLabelText('Number of instalments'), '3')
    await chooseOption(userEvent, within(dialog).getByLabelText('For'), 'k-2')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(calls('POST', /\/families\/f-1\/instalments$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/families\/f-1\/instalments$/)[0])).toEqual({
      label: 'Winter term',
      amountMinor: 125050,
      currency: 'AED',
      firstDueDate: '2026-10-21',
      count: 3,
      everyMonths: 1,
      learnerId: 'k-2',
    })

    const first = within(screen.getByRole('region', { name: 'Payment timeline' })).getAllByRole('listitem')[0]!
    await userEvent.click(within(first).getByRole('button', { name: 'Record payment' }))
    dialog = screen.getByRole('dialog', { name: 'Record a payment: Autumn term' })
    expect(within(dialog).getByText(/cannot be changed/)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Reference'), 'TRX-99')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(calls('POST', /\/instalments\/i-1\/payment$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/instalments\/i-1\/payment$/)[0])).toEqual({
      paidOn: '2026-10-21',
      method: 'bank_transfer',
      reference: 'TRX-99',
      // ADMIN-001: the form's idempotency key.
      paymentId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    })

    // Void is behind the row's menu.
    await userEvent.click(within(first).getByRole('button', { name: /More actions/ }))
    await userEvent.click(within(first).getByRole('menuitem', { name: 'Void' }))
    dialog = screen.getByRole('dialog', { name: 'Void: Autumn term' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Void' }))
    expect(within(dialog).getByText('Say why.')).toBeInTheDocument()
    expect(calls('POST', /\/instalments\/i-1\/void$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'wrong amount')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Void' }))
    await waitFor(() => expect(calls('POST', /\/instalments\/i-1\/void$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/instalments\/i-1\/void$/)[0])).toEqual({ reason: 'wrong amount' })
  })

  it('Sales (PD-17): no contact edits, but records payments', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent({ access: { canEdit: false } })))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing()))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'sm-1', name: 'Sales Manager', role: 'manager' }), route: '/parents/p-1' })
    expect(await screen.findByRole('heading', { level: 1, name: /^Parent Alpha/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit contact information' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit the note' })).not.toBeInTheDocument()
    expect(screen.queryByText('Choose a photo')).not.toBeInTheDocument()
    // The photo and the edits also live in the file's menu: with none of them offered, there is no menu.
    expect(screen.queryByRole('button', { name: 'More actions: Parent Alpha' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Money' }))
    expect(await screen.findByRole('button', { name: 'Add instalments' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Record payment' }).length).toBeGreaterThan(0)
  })

  it('a viewer the server does not let record sees the money, and no recording controls', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing({ canRecord: false })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1#money' })
    const timeline = await screen.findByRole('region', { name: 'Payment timeline' })
    expect(screen.queryByRole('button', { name: 'Add instalments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record a payment' })).not.toBeInTheDocument()
    // No row has a menu either: the instalments are read, not acted on.
    expect(within(timeline).queryByRole('button')).not.toBeInTheDocument()
  })

  it('a refusal is said plainly, and nothing of the family\'s money is asked for', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json({ error: { code: 'COMM.PARENT_PROFILE_DENIED', message: 'no' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    expect(await screen.findByText(/Parent profiles are for the Operations and Sales departments/)).toBeInTheDocument()
    expect(calls('GET', /\/billing$/)).toHaveLength(0)
  })

  it('the parents list opens each profile', async () => {
    on('GET', /\/parent-profiles(\?.*)?$/, () =>
      json({ items: [{ id: 'p-1', name: 'Parent Alpha', avatarUrl: null, family: { id: 'f-1', name: 'Family Alpha' }, childrenCount: 2 }], truncated: false }),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents' })
    expect(await screen.findByRole('link', { name: /Parent Alpha/ })).toHaveAttribute('href', '/parents/p-1')
  })
})

describe('the Parent Profile is a record: a masthead and tabs', () => {
  const panel = (key: string) => document.getElementById(`pf-panel-${key}`) as HTMLElement
  const serve = (b: FamilyBilling = billing(), p: ParentProfile = parent()) => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(p))
    on('GET', /\/families\/f-1\/billing$/, () => json(b))
  }

  it('the masthead says where the money stands; Outstanding is the urgent figure while anything is overdue', async () => {
    serve()
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    const outstanding = await waitFor(() => figure('Outstanding'))
    expect(outstanding).toHaveClass('figure--urgent')
    expect(within(outstanding).getByText('1,250.50')).toHaveAttribute('dir', 'ltr')
    expect(within(outstanding).getByText(/^Overdue .*1,250\.50$/)).toBeInTheDocument()
    // What was paid is set out with the family's money, on the Money tab.
    expect(within(screen.getByRole('table', { name: 'Totals' })).getByRole('row', { name: /^Paid/ })).toHaveTextContent('1,250.50')
    expect(within(figure('Open requests')).getByText('0')).toBeInTheDocument()
    // Overview: the late instalment with how late it is, and what to do about it.
    const waiting = within(screen.getByRole('region', { name: 'Needs attention now' })).getAllByRole('listitem')
    expect(waiting).toHaveLength(1)
    expect(within(waiting[0]!).getByText('Autumn term')).toBeInTheDocument()
    expect(within(waiting[0]!).getByText('20 days late')).toBeInTheDocument()
    await userEvent.click(within(waiting[0]!).getByRole('button', { name: 'Record payment' }))
    expect(screen.getByRole('dialog', { name: 'Record a payment: Autumn term' })).toBeInTheDocument()
  })

  it('nothing late and nothing waiting: Outstanding is plain, and Overview says so in one line', async () => {
    serve(
      billing({
        instalments: [instalment({ id: 'i-9', label: 'Winter term', status: 'upcoming', days: 40, dueDate: '2026-11-30' })],
        totals: [{ currency: 'AED', paidMinor: 0, outstandingMinor: 125050, overdueMinor: 0 }],
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    const outstanding = await waitFor(() => figure('Outstanding'))
    expect(outstanding).not.toHaveClass('figure--urgent')
    expect(within(outstanding).queryByText(/Overdue/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Needs attention now' })).getByText('Nothing is waiting on this family.')).toBeInTheDocument()
    // What falls due next is said under it.
    expect(within(screen.getByRole('region', { name: 'Coming up' })).getByText('Winter term')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Money' })).toHaveAttribute('aria-selected', 'false')
  })

  it('the open tab is in the URL: a link to a section opens its tab, and choosing a tab shows its page alone', async () => {
    serve()
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1#instalments' })
    expect(await screen.findByRole('heading', { level: 1, name: /^Parent Alpha/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Money' })).toHaveAttribute('aria-selected', 'true')
    expect(panel('money')).toHaveAttribute('data-active', 'true')
    expect(panel('overview')).toHaveAttribute('data-active', 'false')
    expect(panel('money')).toHaveAttribute('aria-labelledby', screen.getByRole('tab', { name: 'Money' }).id)

    await userEvent.click(screen.getByRole('tab', { name: 'Children' }))
    expect(screen.getByRole('tab', { name: 'Children' })).toHaveAttribute('aria-selected', 'true')
    expect(panel('children')).toHaveAttribute('data-active', 'true')
    expect(panel('money')).toHaveAttribute('data-active', 'false')

    // The arrow keys move along the tabs.
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Money' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Money' })).toHaveFocus()

    // A masthead figure is a way in: Children opens the Children tab.
    await userEvent.click(figure('Children'))
    expect(screen.getByRole('tab', { name: 'Children' })).toHaveAttribute('aria-selected', 'true')
  })

  it('History is a tab only when the server answers it for this viewer', async () => {
    serve()
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1#history' })
    expect(await screen.findByRole('heading', { level: 1, name: /^Parent Alpha/ })).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /parent-feedback$/).length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'History' })).not.toBeInTheDocument())
    // The link named a tab this viewer does not have: the file opens on Overview.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  })

  it('the file menu holds the rest: the contact edit, the note, the photo', async () => {
    serve(billing(), parent({ avatarUrl: 'https://media.example.test/p-1.jpg' }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1#money' })
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Parent Alpha' }))
    const menu = screen.getByRole('menu', { name: 'More actions: Parent Alpha' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit contact information', 'Edit the note', 'Replace photo', 'Remove photo'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Edit the note' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit the note' })
    // The rule stays with the note wherever it is edited.
    expect(within(dialog).getByText('Internal. The parent never sees it, nor do teachers.')).toBeInTheDocument()
  })
})

// ADMIN-009 (QA AR-PAR-05): a Sales member was offered "Add child" on a family they did not
// enter; the server refused it (404). The button now follows the family's own answer.
describe('Add child on the Parent Profile', () => {
  const options = { standing: 'sales_member', manager: false, ready: true, onBehalfOf: [], waitingForStaff: false }
  const ownership = (addChild: boolean) => ({
    familyId: 'f-1', contactId: 'p-1', signIn: true, supervisor: null, needsOperationsSupervisor: false, salesOwner: null, suggestion: null,
    can: { setSignInEmail: false, addChild, suggestSupervisor: false, assignOperationsSupervisor: false, changeSalesOwner: false },
    supervisorChoices: [], salesOwnerChoices: [],
  })
  const salesMember = makeStaff({ id: 'sm-2', name: 'Sales Member', role: 'admin' })

  it('is offered on a family the viewer entered', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/family-intake\/options$/, () => json(options))
    on('GET', /\/family-intake\/families\/f-1$/, () => json(ownership(true)))
    renderWithProviders(<AppRoutes />, { staff: salesMember, route: '/parents/p-1#children' })
    const children = await screen.findByRole('region', { name: /Children/ })
    expect(screen.getByRole('tab', { name: 'Children' })).toHaveAttribute('aria-selected', 'true')
    expect(await within(children).findByRole('button', { name: 'Add child' })).toBeInTheDocument()
    // ... and from the file's menu, whichever tab is open.
    await userEvent.click(screen.getByRole('button', { name: 'More actions: Parent Alpha' }))
    expect(screen.getByRole('menuitem', { name: 'Add child' })).toBeInTheDocument()
  })

  it('is NOT offered on a family the viewer did not enter (the server refuses that family)', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/family-intake\/options$/, () => json(options))
    on('GET', /\/family-intake\/families\/f-1$/, () => json({ error: { code: 'COMM.INTAKE_NOT_FOUND', message: 'not found' } }, 404))
    renderWithProviders(<AppRoutes />, { staff: salesMember, route: '/parents/p-1#children' })
    const children = await screen.findByRole('region', { name: /Children/ })
    await waitFor(() => expect(calls('GET', /\/family-intake\/families\/f-1$/).length).toBeGreaterThan(0))
    expect(within(children).queryByRole('button', { name: 'Add child' })).toBeNull()
    // Nor from the file's menu.
    await userEvent.click(screen.getByRole('button', { name: 'More actions: Parent Alpha' }))
    expect(screen.queryByRole('menuitem', { name: 'Add child' })).toBeNull()
  })
})

describe('the Student Profile', () => {
  it('shows photo, name, age, schedule, teacher and course, and the parents to staff', async () => {
    on('GET', /\/learners\/k-1\/profile$/, () => json(student()))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/students/k-1' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Child One' })).toBeInTheDocument()
    const info = screen.getByRole('region', { name: 'Student' })
    expect(within(info).getByText('9 years')).toBeInTheDocument()
    expect(within(info).getByText('Tajweed')).toBeInTheDocument()
    expect(within(info).getByText('Teacher Omega')).toBeInTheDocument()
    // The weekly times are the Schedule tab: one row each, the day, the hour, the length.
    await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }))
    expect(screen.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true')
    const [monday, thursday] = within(screen.getByRole('region', { name: 'Class schedule' })).getAllByRole('listitem')
    expect(monday).toHaveTextContent(/^Monday\s*16:30\s*30 min$/)
    expect(thursday).toHaveTextContent(/^Thursday\s*17:00\s*45 min$/)
    // The parents are the Family tab.
    await userEvent.click(screen.getByRole('tab', { name: 'Family' }))
    expect(screen.getByRole('link', { name: 'Parent Alpha' })).toHaveAttribute('href', '/parents/p-1')
  })

  it('the masthead carries the lessons and the next lesson only when the server sends them; the tabs follow', async () => {
    on('GET', /\/learners\/k-1\/profile$/, () =>
      json(student({ schedule: [{ weekday: 1, start: '16:30', durationMinutes: 30, timezone: 'Africa/Cairo', nextStartsAt: '2027-01-18T14:30:00.000Z' }] })),
    )
    on('GET', /\/learners\/k-1\/subscription$/, () =>
      json({
        enforced: true, canRecord: false, canAddSubscription: false, canGrantException: false,
        standing: {
          child: { id: 'k-1', name: 'Child One' }, current: null, lessonsIncluded: 24, lessonsUsed: 24, lessonsLeft: 0, graceLeft: null,
          state: 'locked', lockReasons: ['balance'], overdue: null, balance: 0, excepted: [], held: false,
        },
        subscriptions: [], exceptions: [], renewalRequests: [],
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/students/k-1' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Child One' })).toBeInTheDocument()
    const left = await waitFor(() => figure('Lessons left'))
    expect(within(left).getByText('0')).toBeInTheDocument()
    expect(left).toHaveClass('figure--urgent')
    expect(within(figure('Lessons bought')).getByText('24')).toBeInTheDocument()
    expect(within(figure('Next lesson')).getByText('16:30')).toHaveAttribute('dir', 'ltr')
    // Overview says what waits: the lock, why, and the way to it.
    const waiting = within(screen.getByRole('region', { name: 'Needs attention now' })).getAllByRole('listitem')
    expect(waiting).toHaveLength(1)
    expect(within(waiting[0]!).getByText('Locked')).toBeInTheDocument()
    expect(within(waiting[0]!).getByText('lessons used up')).toBeInTheDocument()
    await userEvent.click(within(waiting[0]!).getByRole('link', { name: 'Open subscription' }))
    expect(screen.getByRole('tab', { name: 'Subscription' })).toHaveAttribute('aria-selected', 'true')
  })

  it('with no subscription answered, there are no lesson figures and no Subscription tab', async () => {
    on('GET', /\/learners\/k-1\/profile$/, () => json(student()))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/students/k-1#subscription' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Child One' })).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /\/learners\/k-1\/subscription$/).length).toBeGreaterThan(0))
    expect(screen.queryByRole('tab', { name: 'Subscription' })).not.toBeInTheDocument()
    expect(screen.queryByText('Lessons left')).not.toBeInTheDocument()
    expect(screen.queryByText('Next lesson')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Nothing is waiting on this student.')).toBeInTheDocument()
  })

  it('says "Not set" rather than blank, and no parents section when the server sends none', async () => {
    on('GET', /\/learners\/k-1\/profile$/, () =>
      json(student({ age: null, course: null, teacher: null, schedule: [], family: undefined, birthDate: undefined, viewer: 'teacher' })),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/students/k-1' })
    const info = await screen.findByRole('region', { name: 'Student' })
    expect(within(info).getAllByText('Not set')).toHaveLength(3)
    // The empty schedule is said on the Schedule tab (and Overview lists it as something that waits).
    expect(within(screen.getByRole('region', { name: 'Class schedule' })).getByText('No regular lesson times yet')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Needs attention now' })).getByText('No teacher assigned yet')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Parents' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Family' })).not.toBeInTheDocument()
  })

  it('a student this viewer may not open is said plainly', async () => {
    on('GET', /\/learners\/k-9\/profile$/, () => json({ error: { code: 'COMM.LESSON_NOT_FOUND', message: 'no' } }, 404))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/students/k-9' })
    expect(await screen.findByText('This student was not found, or is not one you may open.')).toBeInTheDocument()
  })
})

describe('the Parents entry in navigation', () => {
  it('is offered only when the server confirms the money rule', () => {
    const paths = (billingReader: boolean) =>
      destinationsFor('admin', { billingReader }).flatMap((d) => entriesOf(d).map((e) => e.path))
    expect(paths(true)).toContain('/parents')
    expect(paths(false)).not.toContain('/parents')
    // The super admin has it as an Admin Portal section.
    expect(destinationsFor('super_admin').flatMap((d) => entriesOf(d).map((e) => e.path))).toContain('/admin/parents')
  })
})

describe('PD-32: feedback about teachers on the Parent Profile', () => {
  const row = {
    id: 'pf-1', familyId: 'f-1', parent: { id: 'p-1', name: 'Parent Alpha' }, child: { id: 'k-1', name: 'Child One' },
    teacher: { id: 't-1', name: 'Teacher Omega' }, category: 'complaint', body: 'Lessons start late.', status: 'in_review',
    response: 'We are looking into it.', respondedBy: { id: 's-9', name: 'Teachers Dept' }, respondedAt: '2026-10-25T09:00:00Z',
    createdAt: '2026-10-24T09:00:00Z', complaint: { entryId: 'e-1', handledBy: { id: 's-9', name: 'Teachers Dept' } },
  }

  it('lists what the family sent, read only', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing()))
    on('GET', /\/families\/f-1\/parent-feedback$/, () => json({ feedback: [row] }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1#history' })
    const section = await screen.findByRole('region', { name: 'Feedback about teachers' })
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true')
    expect(await within(section).findByText('Lessons start late.')).toBeInTheDocument()
    expect(within(section).getByText('We are looking into it.')).toBeInTheDocument()
    // Taking and replying belong to the Supervision page.
    expect(within(section).queryByRole('button', { name: /Take|Reply/ })).not.toBeInTheDocument()
  })

  it('is simply not there for staff outside the family (404, as for no such family)', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing()))
    on('GET', /\/families\/f-1\/parent-feedback$/, () => json({ code: 'COMM.FEEDBACK_NOT_FOUND', message: 'family not found' }, 404))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    expect(await screen.findByRole('region', { name: 'Payment information' })).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /parent-feedback$/).length).toBeGreaterThan(0))
    expect(screen.queryByRole('region', { name: 'Feedback about teachers' })).not.toBeInTheDocument()
  })

  it('is simply not there for a viewer the server refuses', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing()))
    on('GET', /\/families\/f-1\/parent-feedback$/, () => json({ code: 'COMM.FEEDBACK_DENIED', message: 'no' }, 403))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    expect(await screen.findByRole('region', { name: 'Payment information' })).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /parent-feedback$/).length).toBeGreaterThan(0))
    expect(screen.queryByRole('region', { name: 'Feedback about teachers' })).not.toBeInTheDocument()
  })
})

describe('the Parents list, filtered by subscription (PD-44)', () => {
  const item = { id: 'p-1', name: 'Parent One', avatarUrl: null, family: { id: 'f-1', name: 'Family One' }, childrenCount: 2 }

  it('opens on the filter the URL names and asks the server for it', async () => {
    on('GET', /\/parent-profiles\?access=locked&with=location$/, () => json({ items: [item], truncated: false }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents?access=locked' })
    expect(await screen.findByText('Parent One')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Locked subscription' })).toHaveAttribute('aria-pressed', 'true')
    expect(calls('GET', /\/parent-profiles\?access=locked&with=location$/).length).toBeGreaterThan(0)
  })

  it('asks for the grace period when that chip is chosen, and for everyone again with All', async () => {
    on('GET', /\/parent-profiles\?(access=grace&)?with=location$/, () => json({ items: [item], truncated: false }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents' })
    expect(await screen.findByText('Parent One')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Grace period' }))
    await waitFor(() => expect(calls('GET', /\/parent-profiles\?access=grace&with=location$/).length).toBeGreaterThan(0))
  })
})
