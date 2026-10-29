import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { I18nProvider } from '@/core/i18n/I18nProvider'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { StudentProfile } from '@/features/profiles/api'
import type { SubscriptionView } from './api'
import { PaymentLockBanner } from './PaymentLockBanner'
import { packageLabel } from './copy'
import { chooseOption } from '@/test/select'

/**
 * PD-30 in Admin Web, through the real routes and the real API client with
 * `fetch` answered at the network boundary: the Student Profile's Subscription
 * section (state, ledger, add / void), exceptions offered only on the server's
 * word, the locked-group banner, and Instalment Payments' "before go-live"
 * filter. Who may do what is proven server-side
 * (apps/api/test/integration/pd030-subscription-lock-http.spec.ts).
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

const student: StudentProfile = {
  id: 'k-1',
  name: 'Child One',
  avatarUrl: null,
  age: 9,
  birthDate: '2017-03-04',
  course: null,
  teacher: { id: 't-1', name: 'Teacher Omega' },
  schedule: [],
  family: { id: 'f-1', name: 'Family Alpha', parents: [] },
  viewer: 'staff',
} as StudentProfile

function view(over: Partial<SubscriptionView> = {}): SubscriptionView {
  return {
    enforced: true,
    canRecord: true,
    canAddSubscription: true,
    canGrantException: false,
    standing: {
      child: { id: 'k-1', name: 'Child One' },
      current: { id: 's-1', planMonths: 3, lessonsIncluded: 24, startsOn: '2026-09-01' },
      lessonsIncluded: 24,
      lessonsUsed: 26,
      lessonsLeft: 0,
      graceLeft: 0,
      state: 'locked',
      lockReasons: ['balance'],
      overdue: null,
      balance: -2,
      excepted: [],
      held: true,
    },
    subscriptions: [
      {
        id: 's-1', planMonths: 3, lessonsIncluded: 24, startsOn: '2026-09-01', source: 'payment_request', requestId: 'r-1',
        note: null, createdAt: '2026-09-01T08:00:00Z', createdBy: null, voided: null,
      },
    ],
    exceptions: [],
    renewalRequests: [],
    ...over,
  }
}

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })

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
  on('GET', /\/learners\/k-1\/profile$/, () => json(student))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the Student Profile: Subscription', () => {
  it('shows the state, why, what was bought and used; a recorder adds a subscription', async () => {
    on('GET', /\/learners\/k-1\/subscription$/, () => json(view()))
    on('POST', /\/learners\/k-1\/subscriptions$/, () => json(view()))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/students/k-1' })
    const section = await screen.findByRole('region', { name: 'Subscription' })
    expect(within(section).getByText('Locked')).toBeInTheDocument()
    expect(within(section).getByText(/lessons used up/)).toBeInTheDocument()
    expect(within(section).getAllByText('3 months — 24 lessons').length).toBeGreaterThan(0)
    expect(within(section).getByText(/Suspended — payment/)).toBeInTheDocument()
    // No exception controls unless the server says so.
    expect(within(section).queryByRole('button', { name: 'Grant exception' })).not.toBeInTheDocument()

    await userEvent.click(within(section).getByRole('button', { name: 'Add subscription' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add subscription' })
    await userEvent.type(within(dialog).getByLabelText('Lessons'), '8')
    await chooseOption(userEvent, within(dialog).getByLabelText('Plan'), '1')
    // Free lessons need a reason.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Required.')).toBeInTheDocument()
    expect(calls('POST', /\/learners\/k-1\/subscriptions$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Paid in cash at the office')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/learners\/k-1\/subscriptions$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/learners\/k-1\/subscriptions$/)[0])).toEqual({ lessonsIncluded: 8, reason: 'Paid in cash at the office', planMonths: 1 })
  })

  it('offers exceptions only to the three roles (the server says), with a reason and a date', async () => {
    on('GET', /\/learners\/k-1\/subscription$/, () => json(view({ canGrantException: true })))
    on('POST', /\/learners\/k-1\/subscription-exceptions$/, () =>
      json(view({ canGrantException: true, exceptions: [{
        id: 'e-1', kind: 'balance', reason: 'Transfer on its way', validUntil: '2026-11-20', active: true,
        grantedAt: '2026-10-26T10:00:00Z', grantedBy: { id: 'sm', name: 'Sales Manager' }, revoked: null,
      }] })),
    )
    on('POST', /\/subscription-exceptions\/e-1\/revoke$/, () => json(view({ canGrantException: true })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/students/k-1' })
    const section = await screen.findByRole('region', { name: 'Subscription' })
    await userEvent.click(within(section).getByRole('button', { name: 'Grant exception' }))
    const dialog = await screen.findByRole('dialog', { name: 'Grant exception' })
    // A reason and a date are required before anything is sent.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Grant exception' }))
    expect(within(dialog).getAllByText('Required.')).toHaveLength(2)
    expect(calls('POST', /subscription-exceptions$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Transfer on its way')
    await userEvent.type(within(dialog).getByLabelText('Valid until'), '2026-11-20')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Grant exception' }))
    await waitFor(() => expect(calls('POST', /\/learners\/k-1\/subscription-exceptions$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /subscription-exceptions$/)[0])).toEqual({ kind: 'balance', reason: 'Transfer on its way', validUntil: '2026-11-20' })

    expect(await within(section).findByText('Transfer on its way')).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Revoke' }))
    const revoke = await screen.findByRole('dialog', { name: 'Revoke this exception' })
    await userEvent.type(within(revoke).getByRole('textbox'), 'Paid after all')
    await userEvent.click(within(revoke).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(calls('POST', /\/subscription-exceptions\/e-1\/revoke$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /revoke$/)[0])).toEqual({ reason: 'Paid after all' })
  })

  it('is not shown at all to someone the server refuses (a teacher-side reader)', async () => {
    on('GET', /\/learners\/k-1\/subscription$/, () => json({ error: { code: 'COMM.BILLING_DENIED', message: 'no' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/students/k-1' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Child One' })).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /\/learners\/k-1\/subscription$/)).toHaveLength(1))
    expect(screen.queryByRole('region', { name: 'Subscription' })).not.toBeInTheDocument()
  })

  it('offers Add subscription only to the three roles (the server says)', async () => {
    on('GET', /\/learners\/k-1\/subscription$/, () => json(view({ canAddSubscription: false })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/students/k-1' })
    const section = await screen.findByRole('region', { name: 'Subscription' })
    expect(within(section).queryByRole('button', { name: 'Add subscription' })).not.toBeInTheDocument()
    // A recorder still voids.
    expect(within(section).getByRole('button', { name: 'Void' })).toBeInTheDocument()
  })

  it('says when enforcement is switched off on this server', async () => {
    on('GET', /\/learners\/k-1\/subscription$/, () => json(view({ enforced: false })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/students/k-1' })
    expect(await screen.findByText(/payment lock is switched off/)).toBeInTheDocument()
  })
})

describe('the locked group banner', () => {
  it('names each child and why; nothing when the group is not locked', () => {
    const { rerender } = render(
      <I18nProvider initialLocale="en">
        <PaymentLockBanner
          lock={{
            readOnly: false,
            canPay: false,
            children: [
              { id: 'k-1', name: 'Adam', reasons: ['balance'], overdue: null },
              { id: 'k-2', name: 'Sara', reasons: ['overdue'], overdue: { label: 'Term · 2/3', dueDate: '2026-10-25' } },
            ],
          }}
        />
      </I18nProvider>,
    )
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Read-only for the parent and the teacher. You can still write.')
    expect(banner).toHaveTextContent('Adam: lessons used up')
    expect(banner).toHaveTextContent('Sara: instalment overdue — Term · 2/3')
    rerender(
      <I18nProvider initialLocale="en">
        <PaymentLockBanner lock={null} />
      </I18nProvider>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('the package label', () => {
  it('is "3 months — 24 lessons", in Arabic too', () => {
    expect(packageLabel(3, 24, 'en')).toBe('3 months — 24 lessons')
    expect(packageLabel(3, 24, 'ar')).toBe('3 أشهر — 24 حصة')
    expect(packageLabel(1, 8, 'ar')).toBe('شهر واحد — 8 حصص')
    expect(packageLabel(null, 2, 'ar')).toBe('حصتان')
    expect(packageLabel(null, null, 'en')).toBeNull()
  })
})

describe('Instalment Payments: overdue before go-live', () => {
  it('asks the server for them and marks each row', async () => {
    const row = {
      id: 'i-1', family: { id: 'f-1', name: 'Family Alpha' }, account: { id: 'p-1', name: 'Parent Alpha' }, child: null,
      amountMinor: 10000, currency: 'AED', dueDate: '2026-10-01', status: 'overdue', days: 25, paidAt: null, label: 'Old balance',
      responsibleSupervisor: null, responsibleBasis: 'family', conversationId: null, beforeGoLive: true,
    }
    on('GET', /\/instalments\?/, (url) =>
      json({
        today: '2026-10-26', lockFrom: '2026-10-26', canAssignBillingSupervisor: false,
        items: url.includes('beforeGoLive=true') ? [row] : [],
        counts: { overdue: 1, due: 0, upcoming: 0, paid: 0, unassigned: 1, beforeGoLive: 1 },
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'om', name: 'Ops Manager', role: 'manager' }), route: '/instalments' })
    const filter = await screen.findByRole('checkbox', { name: /Overdue before go-live/ })
    await userEvent.click(filter)
    expect(await screen.findByText('Before go-live')).toBeInTheDocument()
    expect(calls('GET', /beforeGoLive=true/).length).toBeGreaterThan(0)
  })
})
