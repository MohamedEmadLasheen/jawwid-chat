import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { destinationsFor, entriesOf } from '@/app/navigation'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { FamilyBilling, ParentProfile, StudentProfile, TimelineInstalment } from './api'

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
    contact: { phone: '+971 50 123 4567', email: 'alpha@example.test', countryCode: 'AE', region: 'Dubai' },
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
    const contact = screen.getByRole('region', { name: 'Contact information' })
    expect(within(contact).getByText('+971 50 123 4567')).toHaveAttribute('dir', 'ltr')
    expect(within(contact).getByText('alpha@example.test')).toHaveAttribute('dir', 'ltr')
    expect(within(contact).getByText('United Arab Emirates')).toBeInTheDocument()
    expect(within(contact).getByText('Dubai')).toBeInTheDocument()
    expect(within(contact).getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Prefers calls after 6 pm.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View profile: Child One' })).toHaveAttribute('href', '/students/k-1')

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
    expect(within(entries[2]!).queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
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

  it('adds a plan of instalments in minor units, records a payment once, and voids only with a reason', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing()))
    on('POST', /\/families\/f-1\/instalments$/, () => json(billing()))
    on('POST', /\/instalments\/i-1\/payment$/, () => json(billing()))
    on('POST', /\/instalments\/i-1\/void$/, () => json(billing()))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })

    await userEvent.click(await screen.findByRole('button', { name: 'Add instalments' }))
    let dialog = screen.getByRole('dialog', { name: 'Add instalments' })
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Winter term')
    await userEvent.type(within(dialog).getByLabelText('Amount of each instalment'), '1,250.50')
    await userEvent.selectOptions(within(dialog).getByLabelText('Number of instalments'), '3')
    await userEvent.selectOptions(within(dialog).getByLabelText('For'), 'k-2')
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
    expect(bodyOf(calls('POST', /\/instalments\/i-1\/payment$/)[0])).toEqual({ paidOn: '2026-10-21', method: 'bank_transfer', reference: 'TRX-99' })

    await userEvent.click(within(first).getByRole('button', { name: 'Void' }))
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
    expect(screen.queryByText('Upload photo')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Add instalments' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Record payment' }).length).toBeGreaterThan(0)
  })

  it('a viewer the server does not let record sees the money, and no recording controls', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent()))
    on('GET', /\/families\/f-1\/billing$/, () => json(billing({ canRecord: false })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    expect(await screen.findByRole('region', { name: 'Payment timeline' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add instalments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument()
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

describe('the Student Profile', () => {
  it('shows photo, name, age, schedule, teacher and course, and the parents to staff', async () => {
    on('GET', /\/learners\/k-1\/profile$/, () => json(student()))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/students/k-1' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Child One' })).toBeInTheDocument()
    const info = screen.getByRole('region', { name: 'Student' })
    expect(within(info).getByText('9 years')).toBeInTheDocument()
    expect(within(info).getByText('Tajweed')).toBeInTheDocument()
    expect(within(info).getByText('Teacher Omega')).toBeInTheDocument()
    expect(within(info).getByText(/Monday/)).toHaveTextContent('Monday · 16:30 · 30 min')
    expect(within(info).getByText(/Thursday/)).toHaveTextContent('Thursday · 17:00 · 45 min')
    expect(screen.getByRole('link', { name: 'Parent Alpha' })).toHaveAttribute('href', '/parents/p-1')
  })

  it('says "Not set" rather than blank, and no parents section when the server sends none', async () => {
    on('GET', /\/learners\/k-1\/profile$/, () =>
      json(student({ age: null, course: null, teacher: null, schedule: [], family: undefined, birthDate: undefined, viewer: 'teacher' })),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/students/k-1' })
    const info = await screen.findByRole('region', { name: 'Student' })
    expect(within(info).getAllByText('Not set')).toHaveLength(3)
    expect(within(info).getByText('No regular lesson times yet')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Parents' })).not.toBeInTheDocument()
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
