import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { Invoice, Payment, PaymentRequest, Receipt } from '@/features/payments/api'
import type { FamilyBilling, ParentProfile, TimelineInstalment } from './api'
import { chooseOption } from '@/test/select'

/**
 * PD-27 on the Parent Profile, through the real routes and the real API
 * client, with `fetch` answered at the network boundary (docs/admin/
 * pd027-payments.md is the contract). These prove the page's side: every
 * money control sends exactly the documented route and body, the link is
 * shown with Copy and a wa.me link (the server sends nothing), and every
 * action the server would refuse -- `canRecord`, `canVerify`, a card payment's
 * Void -- is not offered. Who may do what is proven server-side.
 */

// Long multi-step dialogs: give a loaded machine room (this file only; vitest isolates files).
vi.setConfig({ testTimeout: 20_000 })
configure({ asyncUtilTimeout: 4_000 })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

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

const PERSON = { id: 's-1', name: 'Supervisor One' }

const profile: ParentProfile = {
  id: 'p-1',
  name: 'Parent Alpha',
  relationship: 'parent',
  isActive: true,
  avatarUrl: null,
  family: { id: 'f-1', name: 'Family Alpha' },
  contact: { phone: null, email: null, countryCode: null, region: null },
  adminNote: null,
  childrenCount: 2,
  children: [
    { id: 'k-1', name: 'Child One', avatarUrl: null },
    { id: 'k-2', name: 'Child Two', avatarUrl: null },
  ],
  updatedAt: null,
  access: { canEdit: true },
}

function instalment(over: Partial<TimelineInstalment> = {}): TimelineInstalment {
  return {
    id: 'i-1',
    planId: null,
    label: 'Autumn term',
    child: null,
    amountMinor: 100000,
    currency: 'AED',
    dueDate: '2026-10-01',
    status: 'overdue',
    days: 20,
    createdAt: '2026-09-01T08:00:00.000Z',
    createdBy: PERSON,
    payment: null,
    void: null,
    paidMinor: 0,
    remainingMinor: 100000,
    partial: false,
    requestId: null,
    ...over,
  }
}

function request(over: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    id: 'r-1',
    purpose: 'subscription',
    label: '3-month subscription',
    status: 'open',
    amountMinor: 120000,
    paidMinor: 0,
    remainingMinor: 120000,
    currency: 'AED',
    child: { id: 'k-1', name: 'Child One' },
    instalmentId: null,
    planMonths: 3,
    periodStart: '2026-11-01',
    periodEnd: '2027-01-31',
    expiresAt: '2026-11-05T08:00:00.000Z',
    createdAt: '2026-10-22T08:00:00.000Z',
    link: 'https://api.example.test/api/v1/pay/tok_r1',
    createdBy: PERSON,
    cancelled: null,
    trialId: null,
    ...over,
  }
}

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    method: 'cash',
    amountMinor: 50000,
    refundedMinor: 0,
    currency: 'AED',
    paidOn: '2026-10-20',
    recordedAt: '2026-10-20T09:00:00.000Z',
    requestId: null,
    instalmentId: null,
    child: null,
    reference: 'RB-12',
    invoice: { id: 'inv-1', number: 'JW-2026-000001' },
    recordedBy: PERSON,
    voided: null,
    refunds: [],
    ...over,
  }
}

const invoice: Invoice = {
  id: 'inv-1',
  number: 'JW-2026-000001',
  issuedAt: '2026-10-20T09:00:00.000Z',
  status: 'paid',
  amountMinor: 50000,
  refundedMinor: 0,
  currency: 'AED',
  method: 'cash',
  paidOn: '2026-10-20',
  label: 'Cash at the office',
  child: null,
  planMonths: null,
  periodStart: null,
  periodEnd: null,
}

const receipt: Receipt = {
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
  mimeType: 'image/png',
  rejectReason: null,
  paymentId: null,
  family: { id: 'f-1', name: 'Family Alpha' },
  uploadedBy: { id: 'p-1', name: 'Parent Alpha' },
  reviewedBy: null,
  reviewedAt: null,
}

function billing(over: Partial<FamilyBilling> = {}): FamilyBilling {
  return {
    familyId: 'f-1',
    today: '2026-10-22',
    paymentMethod: 'bank_transfer',
    currency: 'AED',
    planMonths: 3,
    instalments: [instalment()],
    totals: [{ currency: 'AED', paidMinor: 50000, outstandingMinor: 100000, overdueMinor: 100000 }],
    canRecord: true,
    requests: [request()],
    payments: [payment()],
    invoices: [invoice],
    receipts: [receipt],
    canVerify: false,
    cardAvailable: true,
    ...over,
  }
}

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })

function serve(b: FamilyBilling) {
  on('GET', /\/parent-profiles\/p-1$/, () => json(profile))
  on('GET', /\/families\/f-1\/billing$/, () => json(b))
}

let writeText: ReturnType<typeof vi.fn>

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
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/instalments\/access$/, () => json({ billingReader: true, canAssignBillingSupervisor: false, canVerifyPayments: false }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  tokenStore.clear()
})

describe('PD-27 on the Parent Profile', () => {
  it('shows the requests, payments, invoices and receipts the server sends', async () => {
    serve(
      billing({
        instalments: [instalment({ partial: true, paidMinor: 40000, remainingMinor: 60000 })],
        payments: [payment(), payment({ id: 'pay-2', method: 'card', recordedBy: null, reference: null, invoice: { id: 'inv-2', number: 'JW-2026-000002' } })],
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })

    const requests = await screen.findByRole('region', { name: 'Payment requests' })
    const r = within(requests).getAllByRole('listitem')[0]!
    expect(within(r).getByText('Open')).toBeInTheDocument()
    expect(within(r).getByText('3-month subscription')).toBeInTheDocument()
    expect(within(r).getByText(/^Amount .*1,200\.00 · paid .*0\.00 · remaining .*1,200\.00$/)).toBeInTheDocument()
    // PD-30 (3): the package reads "3 months" (and "— N lessons" when the request buys lessons).
    expect(within(r).getByText('3 months')).toBeInTheDocument()
    expect(within(r).getByRole('link', { name: 'Send on WhatsApp' })).toHaveAttribute('target', '_blank')
    expect(within(r).getByRole('button', { name: 'Cancel the request: 3-month subscription' })).toBeInTheDocument()

    const received = screen.getByRole('region', { name: 'Payments received' })
    const [cash, card] = within(received).getAllByRole('listitem')
    expect(within(cash!).getByText('Cash')).toBeInTheDocument()
    expect(within(cash!).getByText('recorded by Supervisor One')).toBeInTheDocument()
    expect(within(cash!).getByText('Invoice JW-2026-000001')).toBeInTheDocument()
    expect(within(card!).getByText('confirmed by Stripe')).toBeInTheDocument()
    // A recorder voids (never a card payment); only a verifier refunds.
    expect(within(cash!).getByRole('button', { name: 'Void' })).toBeInTheDocument()
    expect(within(card!).queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
    expect(within(received).queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument()

    const invoices = screen.getByRole('region', { name: 'Invoices' })
    expect(within(invoices).getByText('JW-2026-000001')).toHaveAttribute('dir', 'ltr')
    expect(within(invoices).getByRole('button', { name: 'Download invoice JW-2026-000001' })).toBeInTheDocument()

    const receipts = screen.getByRole('region', { name: 'Bank-transfer receipts' })
    expect(within(receipts).getByText('Pending verification')).toBeInTheDocument()
    expect(within(receipts).getByRole('img', { name: 'Receipt for 3-month subscription' })).toHaveAttribute('src', receipt.fileUrl)
    // A recorder decides receipts: pointed at the Payments area.
    expect(within(receipts).getByRole('link', { name: 'Review in Payments' })).toHaveAttribute('href', '/payments')

    const timeline = screen.getByRole('region', { name: 'Payment timeline' })
    expect(within(timeline).getByText('Partially paid')).toBeInTheDocument()
    expect(within(timeline).getByText(/^paid .*400\.00 · remaining .*600\.00$/)).toBeInTheDocument()
  })

  it('reads in Arabic, right to left', async () => {
    serve(billing())
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1', locale: 'ar' })
    expect(await screen.findByRole('region', { name: 'طلبات الدفع' })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
    expect(screen.getByRole('region', { name: 'الدفعات المستلمة' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'الفواتير' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'طلب دفعة' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'تسجيل دفعة مستلمة' })).toBeInTheDocument()
  })

  it('Request payment sends the documented body, then shows the link with Copy and a wa.me link', async () => {
    serve(billing({ requests: [] }))
    const created = request({ id: 'r-9', label: 'Winter package', link: 'https://api.example.test/api/v1/pay/tok_new', amountMinor: 150000, remainingMinor: 150000 })
    on('POST', /\/families\/f-1\/payment-requests$/, () => json({ request: created, billing: billing({ requests: [created] }) }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })

    await userEvent.click(await screen.findByRole('button', { name: 'Request payment' }))
    const dialog = screen.getByRole('dialog', { name: 'Request a payment' })
    // Nothing is sent without a label and an amount.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }))
    expect(within(dialog).getByText('Required.')).toBeInTheDocument()
    expect(calls('POST', /\/payment-requests$/)).toHaveLength(0)

    await userEvent.type(within(dialog).getByLabelText('Label'), 'Winter package')
    await userEvent.type(within(dialog).getByLabelText('Amount'), '1,500')
    await chooseOption(userEvent, within(dialog).getByLabelText('Child'), 'k-2')
    await chooseOption(userEvent, within(dialog).getByLabelText('Package'), '6')
    await userEvent.type(within(dialog).getByLabelText('Period from'), '2026-11-01')
    await userEvent.type(within(dialog).getByLabelText('Period to'), '2027-04-30')
    const days = within(dialog).getByLabelText('Link valid for (days)')
    await userEvent.clear(days)
    await userEvent.type(days, '30')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }))

    await waitFor(() => expect(calls('POST', /\/families\/f-1\/payment-requests$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/families\/f-1\/payment-requests$/)[0])).toEqual({
      purpose: 'subscription',
      label: 'Winter package',
      amountMinor: 150000,
      currency: 'AED',
      expiresInDays: 30,
      learnerId: 'k-2',
      planMonths: 6,
      periodStart: '2026-11-01',
      periodEnd: '2027-04-30',
    })

    const panel = await within(dialog).findByRole('group', { name: 'Payment link' })
    expect(within(panel).getByLabelText('Payment link')).toHaveValue('https://api.example.test/api/v1/pay/tok_new')
    await userEvent.click(within(panel).getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith('https://api.example.test/api/v1/pay/tok_new')
    expect(await within(panel).findByText('Copied.')).toBeInTheDocument()

    const wa = within(panel).getByRole('link', { name: 'Send on WhatsApp' })
    const href = wa.getAttribute('href')!
    expect(href.startsWith('https://wa.me/?text=')).toBe(true)
    const text = decodeURIComponent(href.slice('https://wa.me/?text='.length))
    expect(text).toContain('Winter package')
    expect(text).toContain('السلام عليكم')
    expect(text.endsWith('\nhttps://api.example.test/api/v1/pay/tok_new')).toBe(true)
    expect(wa).toHaveAttribute('target', '_blank')
    expect(wa).toHaveAttribute('rel', 'noopener noreferrer')
    // And the new request is in the list, from the billing the server answered.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(within(screen.getByRole('region', { name: 'Payment requests' })).getByText('Winter package')).toBeInTheDocument()
  })

  it('an open instalment gets its own link: created with instalmentId, or the existing one shown without a second request', async () => {
    const existing = request({ id: 'r-2', purpose: 'instalment', label: 'Spring term', instalmentId: 'i-2', link: 'https://api.example.test/api/v1/pay/tok_i2' })
    serve(
      billing({
        instalments: [instalment(), instalment({ id: 'i-2', label: 'Spring term', requestId: 'r-2' })],
        requests: [existing],
      }),
    )
    const created = request({ id: 'r-3', purpose: 'instalment', label: 'Autumn term', instalmentId: 'i-1', link: 'https://api.example.test/api/v1/pay/tok_i1' })
    on('POST', /\/families\/f-1\/payment-requests$/, () => json({ request: created, billing: billing() }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })

    const timeline = await screen.findByRole('region', { name: 'Payment timeline' })
    const [first, second] = within(timeline).getAllByRole('listitem')
    await userEvent.click(within(second!).getByRole('button', { name: 'Payment link' }))
    let dialog = screen.getByRole('dialog', { name: 'Payment link: Spring term' })
    expect(within(dialog).getByRole('textbox', { name: 'Payment link' })).toHaveValue('https://api.example.test/api/v1/pay/tok_i2')
    expect(calls('POST', /\/payment-requests$/)).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))

    await userEvent.click(within(first!).getByRole('button', { name: 'Payment link' }))
    dialog = screen.getByRole('dialog', { name: 'Payment link: Autumn term' })
    expect(within(dialog).getByText(/still owes: .*1,000\.00/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }))
    await waitFor(() => expect(calls('POST', /\/families\/f-1\/payment-requests$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/families\/f-1\/payment-requests$/)[0])).toEqual({
      purpose: 'instalment',
      label: 'Autumn term',
      instalmentId: 'i-1',
      expiresInDays: 14,
    })
    expect(await within(dialog).findByRole('textbox', { name: 'Payment link' })).toHaveValue('https://api.example.test/api/v1/pay/tok_i1')
  })

  it('cancels an open request only with a reason', async () => {
    serve(billing())
    on('POST', /\/payment-requests\/r-1\/cancel$/, () => json(billing({ requests: [request({ status: 'cancelled', cancelled: { at: '2026-10-22T10:00:00Z', by: PERSON, reason: 'wrong amount' } })] })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel the request: 3-month subscription' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancel the request: 3-month subscription' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel the request' }))
    expect(within(dialog).getByText('Say why.')).toBeInTheDocument()
    expect(calls('POST', /\/cancel$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'wrong amount')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel the request' }))
    await waitFor(() => expect(calls('POST', /\/payment-requests\/r-1\/cancel$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/payment-requests\/r-1\/cancel$/)[0])).toEqual({ reason: 'wrong amount' })
    const requests = screen.getByRole('region', { name: 'Payment requests' })
    expect(await within(requests).findByText('Cancelled by Supervisor One: wrong amount')).toBeInTheDocument()
    expect(within(requests).queryByRole('link', { name: 'Send on WhatsApp' })).not.toBeInTheDocument()
  })

  it('Record a payment: cash by default; towards a request prefills its remaining amount', async () => {
    serve(billing())
    on('POST', /\/families\/f-1\/payments$/, () => json(billing()))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Record a payment' }))
    const dialog = screen.getByRole('dialog', { name: 'Record a payment' })
    expect(within(dialog).getByLabelText('Method')).toHaveAttribute('data-value', 'cash')
    await chooseOption(userEvent, within(dialog).getByLabelText('Towards'), 'r:r-1')
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('1200.00')
    await userEvent.type(within(dialog).getByLabelText('Reference'), 'RB-77')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(calls('POST', /\/families\/f-1\/payments$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/families\/f-1\/payments$/)[0])).toEqual({
      method: 'cash',
      amountMinor: 120000,
      paidOn: '2026-10-22',
      requestId: 'r-1',
      learnerId: 'k-1',
      reference: 'RB-77',
      paymentId: expect.stringMatching(UUID),
    })
  })

  it('any recorder (not only a verifier) may record a bank transfer towards an instalment', async () => {
    serve(billing({ canVerify: false }))
    on('POST', /\/families\/f-1\/payments$/, () => json(billing({ canVerify: false })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Record a payment' }))
    const dialog = screen.getByRole('dialog', { name: 'Record a payment' })
    await chooseOption(userEvent, within(dialog).getByLabelText('Method'), 'bank_transfer')
    await chooseOption(userEvent, within(dialog).getByLabelText('Towards'), 'i:i-1')
    const amount = within(dialog).getByLabelText('Amount')
    await userEvent.clear(amount)
    await userEvent.type(amount, '250')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(calls('POST', /\/families\/f-1\/payments$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/families\/f-1\/payments$/)[0])).toEqual({
      method: 'bank_transfer',
      amountMinor: 25000,
      paidOn: '2026-10-22',
      instalmentId: 'i-1',
      paymentId: expect.stringMatching(UUID),
    })
  })

  it('a verifier voids (with a reason) and refunds (at most what is left); a card payment is refunded, never voided', async () => {
    const card = payment({ id: 'pay-2', method: 'card', amountMinor: 80000, refundedMinor: 30000, recordedBy: null, reference: null })
    serve(billing({ canVerify: true, payments: [payment(), card] }))
    const voided = payment({ voided: { at: '2026-10-22T10:00:00Z', by: PERSON, reason: 'entered twice' } })
    on('POST', /\/payments\/pay-1\/void$/, () => json(billing({ canVerify: true, payments: [voided, card] })))
    on('POST', /\/payments\/pay-2\/refunds$/, () => json(billing({ canVerify: true, payments: [voided, card] })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })

    const received = await screen.findByRole('region', { name: 'Payments received' })
    const [cash] = within(received).getAllByRole('listitem')
    const cardRow = () => within(received).getAllByRole('listitem')[1]!
    expect(within(cardRow()).queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
    expect(within(cardRow()).getByRole('button', { name: 'Refund' })).toBeInTheDocument()

    await userEvent.click(within(cash!).getByRole('button', { name: 'Void' }))
    let dialog = screen.getByRole('dialog', { name: /^Void the payment of/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Void' }))
    expect(within(dialog).getByText('Say why.')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'entered twice')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Void' }))
    await waitFor(() => expect(calls('POST', /\/payments\/pay-1\/void$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/payments\/pay-1\/void$/)[0])).toEqual({ reason: 'entered twice' })
    // Voided: it says so, and offers neither action again.
    const voidedRow = within(received).getAllByRole('listitem')[0]!
    expect(await within(voidedRow).findByText('Voided by Supervisor One: entered twice')).toBeInTheDocument()
    expect(within(voidedRow).queryByRole('button')).not.toBeInTheDocument()

    await userEvent.click(within(cardRow()).getByRole('button', { name: 'Refund' }))
    dialog = screen.getByRole('dialog', { name: /^Refund the payment of/ })
    const amount = within(dialog).getByLabelText('Amount to refund')
    expect(amount).toHaveValue('500.00')
    await userEvent.clear(amount)
    await userEvent.type(amount, '600')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'lesson cancelled')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Refund' }))
    expect(within(dialog).getByText('More than can be refunded on this payment.')).toBeInTheDocument()
    expect(calls('POST', /\/refunds$/)).toHaveLength(0)
    await userEvent.clear(amount)
    await userEvent.type(amount, '200')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Refund' }))
    await waitFor(() => expect(calls('POST', /\/payments\/pay-2\/refunds$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/payments\/pay-2\/refunds$/)[0])).toEqual({ amountMinor: 20000, reason: 'lesson cancelled', refundId: expect.stringMatching(UUID) })
  })

  it('ADMIN-001: a retry of the same Record form resends the same key; a form opened again gets a new one', async () => {
    serve(billing())
    let first = true
    on('POST', /\/families\/f-1\/payments$/, () => {
      if (first) {
        first = false
        return json({ error: { code: 'INTERNAL', message: 'the connection dropped' } }, 503)
      }
      return json(billing())
    })
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Record a payment' }))
    let dialog = screen.getByRole('dialog', { name: 'Record a payment' })
    await userEvent.type(within(dialog).getByLabelText('Amount'), '75')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(calls('POST', /\/families\/f-1\/payments$/)).toHaveLength(1))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' })) // the retry
    await waitFor(() => expect(calls('POST', /\/families\/f-1\/payments$/)).toHaveLength(2))
    const [a, b] = calls('POST', /\/families\/f-1\/payments$/).map((c) => bodyOf(c).paymentId)
    expect(a).toMatch(UUID)
    expect(b).toBe(a)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record a payment' })).not.toBeInTheDocument())
    await userEvent.click(await screen.findByRole('button', { name: 'Record a payment' }))
    dialog = screen.getByRole('dialog', { name: 'Record a payment' })
    await userEvent.type(within(dialog).getByLabelText('Amount'), '75')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(calls('POST', /\/families\/f-1\/payments$/)).toHaveLength(3))
    expect(bodyOf(calls('POST', /\/families\/f-1\/payments$/)[2]).paymentId).not.toBe(a)
  })

  it('withholds Void on a payment whose instalment is fully paid (the instalment is voided instead)', async () => {
    serve(
      billing({
        canVerify: true,
        instalments: [instalment({ status: 'paid', paidMinor: 100000, remainingMinor: 0 })],
        payments: [payment({ instalmentId: 'i-1', amountMinor: 100000 })],
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    const received = await screen.findByRole('region', { name: 'Payments received' })
    expect(within(received).queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
    expect(within(received).getByRole('button', { name: 'Refund' })).toBeInTheDocument()
  })

  it('Download asks for this viewer’s signed link, then opens it', async () => {
    serve(billing())
    on('GET', /\/invoices\/inv-1\/link$/, () => json({ url: 'https://storage.example.test/inv-1.pdf?sig=y' }))
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Download invoice JW-2026-000001' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://storage.example.test/inv-1.pdf?sig=y', '_blank', 'noopener,noreferrer'))
    expect(calls('GET', /\/invoices\/inv-1\/link$/)).toHaveLength(1)
  })

  it('a custom schedule sends items, one row per instalment', async () => {
    serve(billing())
    on('POST', /\/families\/f-1\/instalments$/, () => json(billing()))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Add instalments' }))
    const dialog = screen.getByRole('dialog', { name: 'Add instalments' })
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Custom schedule' }))
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Year plan')
    await userEvent.type(within(dialog).getByLabelText('Amount 1'), '500')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a row' }))
    await userEvent.type(within(dialog).getByLabelText('Amount 2'), '750.25')
    const due2 = within(dialog).getByLabelText('Due date 2')
    await userEvent.clear(due2)
    await userEvent.type(due2, '2026-12-01')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a row' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove row 3' }))
    expect(within(dialog).getByText(/^Total: .*1,250\.25$/)).toBeInTheDocument()
    await chooseOption(userEvent, within(dialog).getByLabelText('For'), 'k-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(calls('POST', /\/families\/f-1\/instalments$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/families\/f-1\/instalments$/)[0])).toEqual({
      label: 'Year plan',
      currency: 'AED',
      learnerId: 'k-1',
      items: [
        { amountMinor: 50000, dueDate: '2026-10-22' },
        { amountMinor: 75025, dueDate: '2026-12-01' },
      ],
    })
  })

  it('a viewer the server does not let record sees the money and none of the controls', async () => {
    serve(billing({ canRecord: false }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    const requests = await screen.findByRole('region', { name: 'Payment requests' })
    expect(screen.queryByRole('button', { name: 'Request payment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record a payment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Payment link' })).not.toBeInTheDocument()
    expect(within(requests).queryByRole('button', { name: /Cancel the request/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Review in Payments' })).not.toBeInTheDocument()
    // Copying a link someone else created is still offered.
    expect(within(requests).getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
  })

  it('a verifier who may not record refunds but does not void', async () => {
    serve(billing({ canRecord: false, canVerify: true }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    const received = await screen.findByRole('region', { name: 'Payments received' })
    expect(within(received).getByRole('button', { name: 'Refund' })).toBeInTheDocument()
    expect(within(received).queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
  })

  it('a recorder with pending receipts is pointed at the Payments area', async () => {
    serve(billing())
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    const receipts = await screen.findByRole('region', { name: 'Bank-transfer receipts' })
    expect(within(receipts).getByRole('link', { name: 'Review in Payments' })).toHaveAttribute('href', '/payments')
  })
})
