import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { destinationsFor, entriesOf } from '@/app/navigation'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { NewStudentDto } from '@/features/trials/api'
import type { BillingSettings, PaymentRequest, Receipt, ReceiptStatus } from './api'
import { reminderLabel } from './copy'
import { chooseOption } from '@/test/select'

/**
 * PD-27: the Payments area (Receipts, Settings) and the New Students payment
 * request, through the real routes and the real API client, with `fetch`
 * answered at the network boundary. The contract is docs/admin/
 * pd027-payments.md: these prove each control sends its documented route and
 * body, and that approve / reject / edit are offered only on the server's word
 * (`canDecide` on the receipts list, `canEdit` on the settings).
 */

// Long multi-step dialogs: give a loaded machine room (this file only; vitest isolates files).
vi.setConfig({ testTimeout: 20_000 })
configure({ asyncUtilTimeout: 4_000 })

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

function receipt(over: Partial<Receipt> = {}): Receipt {
  return {
    id: 'rc-1',
    status: 'pending',
    requestId: 'r-1',
    label: '3-month subscription',
    amountMinor: 120000,
    currency: 'AED',
    transferredOn: '2026-10-21',
    note: 'Sent from my account',
    uploadedAt: '2026-10-21T12:00:00.000Z',
    fileUrl: 'https://api.example.test/api/v1/media/payment-receipts/rc-1?sig=x',
    mimeType: 'image/jpeg',
    rejectReason: null,
    paymentId: null,
    family: { id: 'f-1', name: 'Family Alpha' },
    uploadedBy: { id: 'p-1', name: 'Parent Alpha' },
    reviewedBy: null,
    reviewedAt: null,
    ...over,
  }
}

const COUNTS = { pending: 2, approved: 5, rejected: 1 }
const PENDING = [receipt(), receipt({ id: 'rc-2', label: 'Spring term', mimeType: 'application/pdf', fileUrl: 'https://api.example.test/api/v1/media/payment-receipts/rc-2?sig=z', note: null, family: { id: 'f-2', name: 'Family Beta' } })]

function settings(over: Partial<BillingSettings> = {}): BillingSettings {
  return {
    bankAccount: { bankName: 'Bank Example', accountName: 'Academy Example LLC', iban: 'AE07 0331 2345 6789 0123 456', accountNumber: null, swift: 'EXAMAEAD', note: null },
    issuer: { name: 'Academy Example LLC', address: 'Example Street 1', taxId: null },
    cardAvailable: false,
    reminders: [
      { key: 'payment_d7', offsetDays: -7, enabled: true },
      { key: 'payment_d0', offsetDays: 0, enabled: true },
      { key: 'payment_p3', offsetDays: 3, enabled: false },
    ],
    webhookConfigured: false,
    canEdit: true,
    ...over,
  }
}

const opsManager = makeStaff({ id: 'om-1', name: 'Operations Manager', role: 'manager' })
const superAdmin = makeStaff({ id: 'sa-1', name: 'Owner', role: 'super_admin' })

/** GET /payment-receipts' `canDecide`: the payment recorders approve and reject. */
let canDecide = true
function access(a: { canDecide?: boolean } = {}) {
  canDecide = a.canDecide ?? true
  on('GET', /\/instalments\/access$/, () => json({ billingReader: true, canAssignBillingSupervisor: false, canRecordPayments: canDecide, canVerifyPayments: false }))
}

beforeEach(() => {
  routes = []
  canDecide = true
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [pattern, m, handler] of routes) {
      if (m === method && pattern.test(url)) return handler(url, init)
    }
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: false, operations: false }))
  on('GET', /\/payment-receipts\?status=(\w+)$/, (url) => {
    const status = new URLSearchParams(url.split('?')[1]).get('status') as ReceiptStatus
    const items = status === 'pending' ? PENDING : status === 'approved' ? [receipt({ id: 'rc-9', status: 'approved', reviewedBy: { id: 'om-1', name: 'Operations Manager' }, reviewedAt: '2026-10-21T15:00:00Z', paymentId: 'pay-9' })] : []
    return json({ items, counts: COUNTS, canDecide })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Payments > Receipts', () => {
  it('lists pending receipts with counts, the file inline (image) or as a link (PDF), and switches status', async () => {
    access({ canDecide: true })
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Payments' })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Receipts' })
    const [alpha, beta] = within(list).getAllByRole('listitem')
    expect(within(alpha!).getByText('Family Alpha')).toBeInTheDocument()
    expect(within(alpha!).getByText('3-month subscription')).toBeInTheDocument()
    expect(within(alpha!).getByText(/1,200\.00/)).toBeInTheDocument()
    expect(within(alpha!).getByText('Sent from my account')).toBeInTheDocument()
    expect(within(alpha!).getByText('by Parent Alpha')).toBeInTheDocument()
    expect(within(alpha!).getByRole('img', { name: 'Receipt for 3-month subscription' })).toHaveAttribute('src', PENDING[0]!.fileUrl)
    expect(within(beta!).getByRole('link', { name: 'Open the PDF' })).toHaveAttribute('href', PENDING[1]!.fileUrl)
    expect(within(beta!).queryByRole('img')).not.toBeInTheDocument()
    expect(calls('GET', /\/payment-receipts\?status=pending$/)).toHaveLength(1)

    const filter = screen.getByRole('group', { name: 'Status' })
    expect(within(filter).getByRole('button', { name: /Pending/ })).toHaveTextContent('2')
    expect(within(filter).getByRole('button', { name: /Approved/ })).toHaveTextContent('5')
    await userEvent.click(within(filter).getByRole('button', { name: /Approved/ }))
    await waitFor(() => expect(calls('GET', /\/payment-receipts\?status=approved$/)).toHaveLength(1))
    const approved = await screen.findByText(/^Approved by Operations Manager/)
    expect(approved).toBeInTheDocument()
    // A decided receipt is not decided again.
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('approves with a corrected amount and date, sending only what was changed', async () => {
    access({ canDecide: true })
    on('POST', /\/payment-receipts\/rc-1\/approve$/, () => json({ receipt: receipt({ status: 'approved' }) }))
    on('POST', /\/payment-receipts\/rc-2\/approve$/, () => json({ receipt: receipt({ id: 'rc-2', status: 'approved' }) }))
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments' })
    const list = await screen.findByRole('list', { name: 'Receipts' })
    const [alpha, beta] = within(list).getAllByRole('listitem')

    await userEvent.click(within(alpha!).getByRole('button', { name: 'Approve' }))
    let dialog = screen.getByRole('dialog', { name: 'Approve the receipt: 3-month subscription' })
    expect(within(dialog).getByLabelText('Paid on')).toHaveValue('2026-10-21')
    await userEvent.type(within(dialog).getByLabelText('Amount received (optional)'), '1,150')
    const paidOn = within(dialog).getByLabelText('Paid on')
    await userEvent.clear(paidOn)
    await userEvent.type(paidOn, '2026-10-20')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls('POST', /\/payment-receipts\/rc-1\/approve$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/payment-receipts\/rc-1\/approve$/)[0])).toEqual({ amountMinor: 115000, paidOn: '2026-10-20' })
    // The lists are re-read after a decision.
    await waitFor(() => expect(calls('GET', /\/payment-receipts\?status=pending$/).length).toBeGreaterThan(1))

    await userEvent.click(within(beta!).getByRole('button', { name: 'Approve' }))
    dialog = screen.getByRole('dialog', { name: 'Approve the receipt: Spring term' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls('POST', /\/payment-receipts\/rc-2\/approve$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/payment-receipts\/rc-2\/approve$/)[0])).toEqual({})
  })

  it('rejects only with a reason', async () => {
    access({ canDecide: true })
    on('POST', /\/payment-receipts\/rc-1\/reject$/, () => json({ receipt: receipt({ status: 'rejected', rejectReason: 'amount not received' }) }))
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments' })
    const list = await screen.findByRole('list', { name: 'Receipts' })
    await userEvent.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Reject' }))
    const dialog = screen.getByRole('dialog', { name: 'Reject the receipt: 3-month subscription' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(within(dialog).getByText('Say why.')).toBeInTheDocument()
    expect(calls('POST', /\/reject$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'amount not received')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(calls('POST', /\/payment-receipts\/rc-1\/reject$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/payment-receipts\/rc-1\/reject$/)[0])).toEqual({ reason: 'amount not received' })
  })

  it('offers no Approve or Reject unless the server says canDecide', async () => {
    access({ canDecide: false })
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'admin' }), route: '/payments' })
    const list = await screen.findByRole('list', { name: 'Receipts' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    expect(screen.getByText(/approved or rejected by the payment recorders/)).toBeInTheDocument()
  })

  it('the super admin opens it as an Admin Portal section, in Arabic', async () => {
    access({ canDecide: true })
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/payments', locale: 'ar' })
    expect(await screen.findByRole('heading', { level: 1, name: 'المدفوعات' })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
    const list = await screen.findByRole('list', { name: 'الإيصالات' })
    expect(within(list).getAllByRole('button', { name: 'اعتماد' })).toHaveLength(2)
  })
})

describe('Payments > Settings', () => {
  it('shows the bank account, issuer, reminders and card state, and saves them', async () => {
    access()
    on('GET', /\/billing\/settings$/, () => json(settings()))
    on('POST', /\/billing\/settings$/, (_u, init) => json(settings(JSON.parse(String(init.body)))))
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=settings' })

    const card = await screen.findByRole('region', { name: 'Card payments' })
    expect(within(card).getByText('Not configured: no card option anywhere.')).toBeInTheDocument()
    const bank = screen.getByRole('region', { name: 'Bank account' })
    expect(within(bank).getByLabelText('IBAN')).toHaveValue('AE07 0331 2345 6789 0123 456')
    expect(within(bank).getByLabelText('IBAN')).toHaveAttribute('dir', 'ltr')
    const reminders = screen.getByRole('region', { name: 'Payment reminders' })
    expect(within(reminders).getByRole('checkbox', { name: '7 days before' })).toBeChecked()
    expect(within(reminders).getByRole('checkbox', { name: 'On the due date' })).toBeChecked()
    expect(within(reminders).getByRole('checkbox', { name: '3 days after' })).not.toBeChecked()

    await userEvent.type(within(bank).getByLabelText('Note for parents'), 'Write the child’s name.')
    const accountNumber = within(bank).getByLabelText('Account number')
    await userEvent.type(accountNumber, '0123456789')
    const issuer = screen.getByRole('region', { name: 'Invoice issuer' })
    await userEvent.clear(within(issuer).getByLabelText('Address'))
    await userEvent.type(within(issuer).getByLabelText('Tax registration number'), '100200300')
    await userEvent.click(within(reminders).getByRole('checkbox', { name: '3 days after' }))
    await userEvent.click(within(reminders).getByRole('checkbox', { name: '7 days before' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(calls('POST', /\/billing\/settings$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/billing\/settings$/)[0])).toEqual({
      bankAccount: {
        accountName: 'Academy Example LLC',
        bankName: 'Bank Example',
        iban: 'AE07 0331 2345 6789 0123 456',
        accountNumber: '0123456789',
        swift: 'EXAMAEAD',
        note: 'Write the child’s name.',
      },
      issuer: { name: 'Academy Example LLC', address: null, taxId: '100200300' },
      reminders: [
        { key: 'payment_d7', enabled: false },
        { key: 'payment_d0', enabled: true },
        { key: 'payment_p3', enabled: true },
      ],
    })
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  it('requires the account name when any bank detail is filled, and clears an emptied account', async () => {
    access()
    on('GET', /\/billing\/settings$/, () => json(settings()))
    on('POST', /\/billing\/settings$/, () => json(settings({ bankAccount: null })))
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=settings' })
    const bank = await screen.findByRole('region', { name: 'Bank account' })
    await userEvent.clear(within(bank).getByLabelText('Account name'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText(/The account name is required/)).toBeInTheDocument()
    expect(calls('POST', /\/billing\/settings$/)).toHaveLength(0)
    for (const label of ['Bank name', 'IBAN', 'SWIFT / BIC']) await userEvent.clear(within(bank).getByLabelText(label))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/billing\/settings$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/billing\/settings$/)[0]).bankAccount).toBeNull()
  })

  it('is read-only when the server says canEdit is false; Stripe shows as connected', async () => {
    access()
    on('GET', /\/billing\/settings$/, () => json(settings({ canEdit: false, cardAvailable: true, webhookConfigured: true })))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'admin' }), route: '/payments?tab=settings' })
    const bank = await screen.findByRole('region', { name: 'Bank account' })
    expect(within(bank).getByLabelText('IBAN')).toBeDisabled()
    expect(within(screen.getByRole('region', { name: 'Payment reminders' })).getByRole('checkbox', { name: '7 days before' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.getByText('Stripe connected')).toBeInTheDocument()
    expect(screen.getByText('Webhook configured')).toBeInTheDocument()
    expect(screen.getByText(/Only the super admin and the Operations Manager change these settings/)).toBeInTheDocument()
  })

  it('words each reminder offset in both languages', () => {
    expect(reminderLabel(-7, 'en')).toBe('7 days before')
    expect(reminderLabel(-1, 'en')).toBe('1 day before')
    expect(reminderLabel(0, 'en')).toBe('On the due date')
    expect(reminderLabel(3, 'en')).toBe('3 days after')
    expect(reminderLabel(-7, 'ar')).toBe('قبل الاستحقاق بـ7 أيام')
    expect(reminderLabel(0, 'ar')).toBe('في يوم الاستحقاق')
    expect(reminderLabel(2, 'ar')).toBe('بعد الاستحقاق بيومين')
    expect(reminderLabel(14, 'ar')).toBe('بعد الاستحقاق بـ14 يومًا')
  })
})

describe('the Payments entry in navigation', () => {
  it('is offered only when the server confirms the money rule; the super admin has it as a section', () => {
    const paths = (billingReader: boolean) => destinationsFor('admin', { billingReader }).flatMap((d) => entriesOf(d).map((e) => e.path))
    expect(paths(true)).toContain('/payments')
    expect(paths(false)).not.toContain('/payments')
    expect(destinationsFor('super_admin').flatMap((d) => entriesOf(d).map((e) => e.path))).toContain('/admin/payments')
    // A department role may not open it at all.
    expect(destinationsFor('finance', { billingReader: true }).flatMap((d) => entriesOf(d).map((e) => e.path))).not.toContain('/payments')
  })
})

describe('New Students > Payment request (before Assign)', () => {
  const STUDENT: NewStudentDto = {
    trialId: 'tr-1',
    prospectName: 'Prospect Gamma',
    trialTeacher: { id: 't-1', name: 'Teacher One' },
    trialAt: '2026-10-10T15:00:00Z',
    recordedAt: '2026-10-11T10:00:00Z',
    recordedBy: { id: 's-1', name: 'Sales One' },
    updatedAt: null,
    parent: { name: 'Parent Gamma', email: 'gamma@example.test', phone: '+99 000 222' },
    children: [{ name: 'Child G1', age: 8, course: 'Course A', teacher: { id: 't-1', name: 'Teacher One' }, packagePrice: 1200, lessonPrice: 150, schedule: [{ weekday: 1, time: '17:00' }] }],
    payment: { currency: 'USD', method: 'bank_transfer' },
    enrolment: null,
  }
  const ASSIGNED: NewStudentDto = {
    ...STUDENT,
    trialId: 'tr-2',
    parent: { ...STUDENT.parent, name: 'Parent Delta' },
    enrolment: { familyId: 'f-9', learnerIds: ['k-9'], supervisor: null, assignedAt: '2026-10-12T10:00:00Z', groupConversationId: null, canCreateGroup: false, parentSignup: { state: 'not_started' } },
  }
  const OPEN: PaymentRequest = {
    id: 'r-t1',
    purpose: 'subscription',
    label: 'Subscription',
    status: 'open',
    amountMinor: 120000,
    paidMinor: 0,
    remainingMinor: 120000,
    currency: 'USD',
    child: { id: null, name: 'Child G1' },
    instalmentId: null,
    planMonths: null,
    periodStart: null,
    periodEnd: null,
    expiresAt: '2026-11-05T08:00:00.000Z',
    createdAt: '2026-10-22T08:00:00.000Z',
    link: 'https://api.example.test/api/v1/pay/tok_t1',
    createdBy: { id: 's-1', name: 'Sales One' },
    cancelled: null,
    trialId: 'tr-1',
  }

  function serveStudents() {
    on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: true, operations: false }))
    on('GET', /\/trials\/new-students$/, () => json({ students: [STUDENT, ASSIGNED] }))
  }

  it('is offered on a card not yet assigned; prefills the suggested amount; sends the documented body and shows the link', async () => {
    serveStudents()
    on('GET', /\/trials\/new-students\/tr-1\/payment-requests$/, () => json({ enrolledFamilyId: null, items: [], payments: [], suggestedAmountMinor: 120000, currency: 'USD' }))
    const created = { ...OPEN, id: 'r-new', label: 'Subscription, 3 months', link: 'https://api.example.test/api/v1/pay/tok_new', planMonths: 3 as const }
    on('POST', /\/trials\/new-students\/tr-1\/payment-requests$/, () => json({ request: created }, 201))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/trials/new-students' })

    const card = (await screen.findByRole('heading', { name: 'Parent Gamma' })).closest('article')!
    const assigned = screen.getByRole('heading', { name: 'Parent Delta' }).closest('article')!
    expect(within(assigned).queryByRole('button', { name: 'Payment request' })).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Payment request' }))
    const dialog = screen.getByRole('dialog', { name: 'Payments: Parent Gamma' })
    const amount = await within(dialog).findByLabelText('Amount (USD)')
    expect(amount).toHaveValue('1200.00')
    expect(within(dialog).getByText(/From the subscription form: .*1,200\.00/)).toBeInTheDocument()
    const label = within(dialog).getByLabelText('Label')
    expect(label).toHaveValue('Subscription')
    await userEvent.clear(label)
    await userEvent.type(label, 'Subscription, 3 months')
    await chooseOption(userEvent, within(dialog).getByLabelText('Package'), '3')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }))

    await waitFor(() => expect(calls('POST', /\/trials\/new-students\/tr-1\/payment-requests$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/trials\/new-students\/tr-1\/payment-requests$/)[0])).toEqual({
      purpose: 'subscription',
      label: 'Subscription, 3 months',
      amountMinor: 120000,
      currency: 'USD',
      expiresInDays: 14,
      planMonths: 3,
    })
    const panel = await within(dialog).findByRole('group', { name: 'Payment link' })
    expect(within(panel).getByRole('textbox', { name: 'Payment link' })).toHaveValue('https://api.example.test/api/v1/pay/tok_new')
    expect(within(panel).getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href')).toContain(encodeURIComponent('https://api.example.test/api/v1/pay/tok_new'))
    // The trial's list is re-read.
    await waitFor(() => expect(calls('GET', /\/trials\/new-students\/tr-1\/payment-requests$/).length).toBeGreaterThan(1))
  })

  it('lists the trial’s requests and payments, and cancels an open request with a reason', async () => {
    serveStudents()
    on('GET', /\/trials\/new-students\/tr-1\/payment-requests$/, () =>
      json({
        enrolledFamilyId: null,
        items: [OPEN],
        payments: [
          {
            id: 'pay-t1', method: 'card', amountMinor: 60000, refundedMinor: 0, currency: 'USD', paidOn: '2026-10-21', recordedAt: '2026-10-21T10:00:00Z',
            requestId: 'r-0', instalmentId: null, child: null, reference: null, invoice: { id: 'inv-t1', number: 'JW-2026-000010' }, recordedBy: null, voided: null, refunds: [],
          },
        ],
        suggestedAmountMinor: null,
        currency: 'USD',
      }),
    )
    on('POST', /\/payment-requests\/r-t1\/cancel$/, () => json({ request: { ...OPEN, status: 'cancelled' } }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'admin' }), route: '/trials/new-students' })
    const card = (await screen.findByRole('heading', { name: 'Parent Gamma' })).closest('article')!
    await userEvent.click(within(card).getByRole('button', { name: 'Payment request' }))
    const dialog = screen.getByRole('dialog', { name: 'Payments: Parent Gamma' })
    // No suggestion: the amount starts empty.
    expect(await within(dialog).findByLabelText('Amount (USD)')).toHaveValue('')
    const requests = within(dialog).getByRole('list', { name: 'Payment requests' })
    expect(within(requests).getByText('Subscription', { selector: 'strong' })).toBeInTheDocument()
    expect(within(requests).getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    const received = within(dialog).getByRole('list', { name: 'Payments received' })
    expect(within(received).getByText('confirmed by Stripe')).toBeInTheDocument()
    expect(within(received).getByText('Invoice JW-2026-000010')).toBeInTheDocument()
    expect(within(received).queryByRole('button')).not.toBeInTheDocument()

    await userEvent.click(within(requests).getByRole('button', { name: 'Cancel the request: Subscription' }))
    const reason = screen.getByRole('dialog', { name: 'Cancel the request: Subscription' })
    await userEvent.type(within(reason).getByLabelText('Reason'), 'parent changed the package')
    await userEvent.click(within(reason).getByRole('button', { name: 'Cancel the request' }))
    await waitFor(() => expect(calls('POST', /\/payment-requests\/r-t1\/cancel$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/payment-requests\/r-t1\/cancel$/)[0])).toEqual({ reason: 'parent changed the package' })
    expect(await screen.findByRole('dialog', { name: 'Payments: Parent Gamma' })).toBeInTheDocument()
  })

  it('a trial assigned meanwhile sends staff to the family’s Parent Profile, and asks for nothing', async () => {
    serveStudents()
    on('GET', /\/trials\/new-students\/tr-1\/payment-requests$/, () =>
      json({ enrolledFamilyId: 'f-9', items: [OPEN], payments: [], suggestedAmountMinor: 120000, currency: 'USD' }),
    )
    on('GET', /\/parent-profiles(\?.*)?$/, () => json({ items: [], truncated: false }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/trials/new-students' })
    const card = (await screen.findByRole('heading', { name: 'Parent Gamma' })).closest('article')!
    await userEvent.click(within(card).getByRole('button', { name: 'Payment request' }))
    const dialog = screen.getByRole('dialog', { name: 'Payments: Parent Gamma' })
    expect(await within(dialog).findByText(/now live on the family’s Parent Profile/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('link', { name: 'Find Parent Gamma in Parents' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Parents' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('Parent Gamma')
    await waitFor(() => expect(calls('GET', /\/parent-profiles\?q=Parent(%20|\+)Gamma$/).length).toBeGreaterThan(0))
  })

  it('is not offered to Operations staff who neither sell nor assign', async () => {
    on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: false, operations: true }))
    on('GET', /\/trials\/new-students$/, () => json({ students: [STUDENT], canAssign: false }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'admin' }), route: '/trials/new-students' })
    const card = (await screen.findByRole('heading', { name: 'Parent Gamma' })).closest('article')!
    expect(within(card).queryByRole('button', { name: 'Payment request' })).not.toBeInTheDocument()
    expect(calls('GET', /\/payment-requests/)).toHaveLength(0)
  })
})
