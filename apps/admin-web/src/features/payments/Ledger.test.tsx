import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { chooseOption } from '@/test/select'
import type { CardAttemptRow, StripeEvent, Transaction, TransactionDetail, TransactionList } from './api'
import { attemptFailure, cardFailureKind, cardLabel } from './copy'

/**
 * PD-27 completion: the Payments area's transaction ledger -- Transactions,
 * Card attempts and Stripe events -- through the real routes and the real API
 * client, with `fetch` answered at the network boundary. The contract is
 * docs/admin/pd027-stripe-lifecycle.md §3.5–3.6 and
 * apps/api/src/billing/transactions.service.ts. Synthetic data only.
 */

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
/** The query string of a call, as sent. */
const qs = (call: unknown[]) => String(call[0]).split('?')[1] ?? ''
const listCalls = () => calls('GET', /\/payments(\?.*)?$/).filter((c) => !/[?&]limit=1(&|$)/.test(String(c[0])))

function transaction(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 'p-1',
    status: 'standing',
    method: 'card',
    amountMinor: 120000,
    refundedMinor: 0,
    currency: 'AED',
    paidOn: '2026-10-21',
    recordedAt: '2026-10-21T10:00:00.000Z',
    family: { id: 'f-1', name: 'Family Alpha' },
    trialId: null,
    child: { id: 'k-1', name: 'Child A1' },
    request: { id: 'r-1', label: '3-month subscription', purpose: 'subscription', planMonths: 3 },
    instalmentId: null,
    invoice: { id: 'inv-1', number: 'JW-2026-000101' },
    reference: null,
    recordedBy: null,
    card: { brand: 'visa', last4: '4242', wallet: null },
    stripe: { checkoutSessionId: 'cs_test_a1', paymentIntentId: 'pi_test_1', chargeId: 'ch_test_1', customerId: 'cus_test_1', livemode: false },
    overpaid: null,
    ...over,
  }
}

const CASH = transaction({
  id: 'p-2',
  method: 'cash',
  amountMinor: 50000,
  refundedMinor: 10000,
  status: 'partially_refunded',
  family: { id: 'f-2', name: 'Family Beta' },
  child: null,
  request: null,
  invoice: { id: 'inv-2', number: 'JW-2026-000102' },
  recordedBy: { id: 'om-1', name: 'Operations Manager' },
  card: null,
  stripe: null,
})

function list(over: Partial<TransactionList> = {}): TransactionList {
  return {
    items: [transaction(), CASH],
    nextCursor: null,
    totals: [
      { currency: 'AED', count: 2, amountMinor: 170000, refundedMinor: 10000, netMinor: 160000 },
      { currency: 'USD', count: 1, amountMinor: 30000, refundedMinor: 0, netMinor: 30000 },
    ],
    canReconcile: false,
    ...over,
  }
}

function detail(over: Partial<TransactionDetail> = {}): TransactionDetail {
  return {
    payment: { ...transaction({ refundedMinor: 20000, status: 'partially_refunded' }), voided: null, paymentMethodType: 'card' },
    refunds: [
      { id: 'rf-1', amountMinor: 20000, reason: 'one lesson not given', at: '2026-10-25T09:00:00.000Z', source: 'stripe', recordedBy: null, stripeRefundId: 're_test_1' },
    ],
    request: {
      id: 'r-1', label: '3-month subscription', purpose: 'subscription', amountMinor: 120000, currency: 'AED',
      planMonths: 3, periodStart: '2026-11-01', periodEnd: '2027-01-31', status: 'paid',
    },
    attempts: [
      {
        sessionId: 'cs_test_a1', status: 'complete', amountMinor: 120000, currency: 'AED', createdAt: '2026-10-21T09:50:00.000Z',
        expiresAt: '2026-10-22T09:50:00.000Z', failureCount: 2, failureCode: 'insufficient_funds', lastFailedAt: '2026-10-21T09:55:00.000Z',
        paymentIntentId: 'pi_test_1', customerId: 'cus_test_1',
      },
    ],
    events: [
      { id: 'evt_test_1', type: 'payment_intent.payment_failed', livemode: false, receivedAt: '2026-10-21T09:55:01.000Z', stripeCreatedAt: null, outcome: 'payment_failed', objectId: 'pi_test_1', paymentIntentId: 'pi_test_1' },
      { id: 'evt_test_2', type: 'checkout.session.completed', livemode: false, receivedAt: '2026-10-21T10:00:01.000Z', stripeCreatedAt: null, outcome: 'recorded', objectId: 'cs_test_a1', paymentIntentId: 'pi_test_1' },
    ],
    canReconcile: true,
    ...over,
  }
}

function attempt(over: Partial<CardAttemptRow> = {}): CardAttemptRow {
  return {
    sessionId: 'cs_test_b1', status: 'open', amountMinor: 60000, currency: 'AED', createdAt: '2026-10-20T08:00:00.000Z',
    expiresAt: '2026-10-21T08:00:00.000Z', failureCount: 2, failureCode: 'insufficient_funds', lastFailedAt: '2026-10-20T08:05:00.000Z',
    paymentIntentId: 'pi_test_b1', customerId: null, paymentId: null,
    request: { id: 'r-2', label: 'Renewal, 1 month', purpose: 'renewal' }, family: { id: 'f-1', name: 'Family Alpha' }, trialId: null,
    ...over,
  }
}

function event(over: Partial<StripeEvent> = {}): StripeEvent {
  return {
    id: 'evt_test_9', type: 'refund.created', livemode: true, receivedAt: '2026-10-22T12:00:00.000Z', stripeCreatedAt: '2026-10-22T11:59:59.000Z',
    outcome: 'refund_deferred', objectId: 're_test_9', paymentIntentId: 'pi_test_9', ...over,
  }
}

const opsManager = makeStaff({ id: 'om-1', name: 'Operations Manager', role: 'manager' })

/** The transactions list's `canReconcile` (canVerify): the Stripe events tab and Reconcile. */
let canReconcile = false
function serve(a: { canReconcile?: boolean; list?: TransactionList } = {}) {
  canReconcile = a.canReconcile ?? false
  const body = a.list ?? list()
  on('GET', /\/instalments\/access$/, () => json({ billingReader: true, canAssignBillingSupervisor: false, canRecordPayments: true, canVerifyPayments: canReconcile }))
  on('GET', /\/payments(\?.*)?$/, () => json({ ...body, canReconcile }))
}

beforeEach(() => {
  routes = []
  canReconcile = false
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
  on('GET', /\/payment-receipts\?status=(\w+)$/, () => json({ items: [], counts: { pending: 0, approved: 0, rejected: 0 }, canDecide: true }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const tabs = () => screen.getByRole('group', { name: 'Payments' })

describe('Payments > Transactions', () => {
  it('adds Transactions and Card attempts beside the existing tabs; no Stripe events without canReconcile', async () => {
    serve({ canReconcile: false })
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Payments' })).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /\/instalments\/access$/).length).toBeGreaterThan(0))
    const names = within(tabs()).getAllByRole('button').map((b) => b.textContent)
    expect(names).toEqual(['Receipts', 'Transactions', 'Card attempts', 'Renewal requests', 'Settings'])
    expect(within(tabs()).queryByRole('button', { name: 'Stripe events' })).not.toBeInTheDocument()
    // Receipts is still the first tab.
    expect(within(tabs()).getByRole('button', { name: 'Receipts' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('lists the transactions with totals per currency; card brand and last 4; no filter sends no query', async () => {
    serve()
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=transactions' })
    const table = await screen.findByRole('table', { name: 'Transactions' })
    expect(qs(listCalls()[0]!)).toBe('')
    const [, alpha, beta] = within(table).getAllByRole('row')
    expect(within(alpha!).getByText('Family Alpha')).toBeInTheDocument()
    expect(within(alpha!).getByText('Child A1')).toBeInTheDocument()
    expect(within(alpha!).getByText('3-month subscription')).toBeInTheDocument()
    expect(within(alpha!).getByText('Subscription · 3 months')).toBeInTheDocument()
    expect(within(alpha!).getByText('Visa •••• 4242')).toBeInTheDocument()
    expect(within(alpha!).getByText(/1,200\.00/)).toBeInTheDocument()
    expect(within(alpha!).getByText('Paid')).toBeInTheDocument()
    expect(within(alpha!).getByText('JW-2026-000101')).toBeInTheDocument()
    expect(within(beta!).getByText('Cash')).toBeInTheDocument()
    expect(within(beta!).getByText('Partially refunded')).toBeInTheDocument()
    expect(within(beta!).getByText(/100\.00/)).toBeInTheDocument()

    const totals = screen.getByRole('region', { name: 'Totals' })
    const aed = within(totals).getByRole('listitem', { name: 'AED' })
    expect(within(aed).getByText('2')).toBeInTheDocument()
    expect(within(aed).getByText(/1,700\.00/)).toBeInTheDocument()
    expect(within(aed).getByText(/^AED\s100\.00$/)).toBeInTheDocument()
    expect(within(aed).getByText(/1,600\.00/)).toBeInTheDocument()
    const usd = within(totals).getByRole('listitem', { name: 'USD' })
    expect(within(usd).getAllByText(/300\.00/)).toHaveLength(2)
  })

  it('builds the documented query string from every filter, the pickers being SearchableSelects', async () => {
    serve()
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=transactions' })
    await screen.findByRole('table', { name: 'Transactions' })
    const filters = screen.getByRole('region', { name: 'Filters' })
    expect(filters.querySelector('select')).toBeNull()
    const status = within(filters).getByLabelText('Status')
    expect(status).toHaveAttribute('role', 'combobox')
    await chooseOption(userEvent, status, 'refunded')
    await chooseOption(userEvent, within(filters).getByLabelText('Method'), 'card')
    await chooseOption(userEvent, within(filters).getByLabelText('For'), 'renewal')
    await chooseOption(userEvent, within(filters).getByLabelText('Package'), '3')
    await userEvent.type(within(filters).getByLabelText('Paid from'), '2026-10-01')
    await userEvent.type(within(filters).getByLabelText('Paid to'), '2026-10-31')
    await userEvent.type(within(filters).getByRole('searchbox'), ' Alpha ')
    await waitFor(() =>
      expect(listCalls().map(qs)).toContain('status=refunded&method=card&purpose=renewal&planMonths=3&from=2026-10-01&to=2026-10-31&q=Alpha'),
    )

    await userEvent.click(within(filters).getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(qs(listCalls().at(-1)!)).toBe(''))
  })

  it('refuses a range that ends before it starts, without asking the server', async () => {
    serve()
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=transactions' })
    await screen.findByRole('table', { name: 'Transactions' })
    const filters = screen.getByRole('region', { name: 'Filters' })
    await userEvent.type(within(filters).getByLabelText('Paid from'), '2026-10-31')
    await userEvent.type(within(filters).getByLabelText('Paid to'), '2026-10-01')
    expect(await screen.findByText('The period ends before it starts.')).toBeInTheDocument()
    expect(listCalls().map(qs)).not.toContain('from=2026-10-31&to=2026-10-01')
  })

  it('“Load more” asks for the next cursor and appends the page', async () => {
    serve()
    on('GET', /\/payments(\?.*)?$/, (url) =>
      url.includes('cursor=cur-2')
        ? json(list({ items: [transaction({ id: 'p-3', family: { id: 'f-3', name: 'Family Gamma' } })], nextCursor: null }))
        : json(list({ nextCursor: 'cur-2' })),
    )
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=transactions' })
    const table = await screen.findByRole('table', { name: 'Transactions' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await within(table).findByText('Family Gamma')).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('Family Alpha')).toBeInTheDocument()
    expect(listCalls().map(qs)).toContain('cursor=cur-2')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('opens the detail: Stripe references (test mode, copyable), refunds, the request, attempts with decline wording, webhook events', async () => {
    serve()
    on('GET', /\/payments\/p-1$/, () => json(detail({ canReconcile: false })))
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=transactions' })
    const table = await screen.findByRole('table', { name: 'Transactions' })
    await userEvent.click(within(table).getByText('Family Alpha'))
    const dialog = await screen.findByRole('dialog', { name: /^Payment of AED\s1,200\.00$/ })
    expect(calls('GET', /\/payments\/p-1$/)).toHaveLength(1)

    const refs = within(dialog).getByRole('region', { name: 'Stripe references' })
    expect(within(refs).getByText('Test mode')).toBeInTheDocument()
    for (const id of ['cs_test_a1', 'pi_test_1', 'ch_test_1', 'cus_test_1']) expect(within(refs).getByText(id)).toBeInTheDocument()
    await userEvent.click(within(refs).getByRole('button', { name: 'Copy Payment intent' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('pi_test_1')
    expect(await within(refs).findByText('Copied.')).toBeInTheDocument()

    const refunds = within(dialog).getByRole('list', { name: 'Refunds' })
    expect(within(refunds).getByText(/200\.00/)).toBeInTheDocument()
    expect(within(refunds).getByText('through Stripe')).toBeInTheDocument()
    expect(within(refunds).getByText('one lesson not given')).toBeInTheDocument()
    expect(within(refunds).getByText('re_test_1')).toBeInTheDocument()

    const request = within(dialog).getByRole('region', { name: 'Payment request' })
    expect(within(request).getByText('3-month subscription')).toBeInTheDocument()
    expect(within(request).getByText('Paid')).toBeInTheDocument()

    const attempts = within(dialog).getByRole('list', { name: 'Card attempts' })
    expect(within(attempts).getByText('The bank declined it for insufficient funds.')).toBeInTheDocument()
    expect(within(attempts).getByText('insufficient_funds')).toBeInTheDocument()
    expect(within(attempts).getByText('Declines: 2')).toBeInTheDocument()

    const events = within(dialog).getByRole('list', { name: 'Webhook events' })
    const [failed, recorded] = within(events).getAllByRole('listitem')
    expect(within(failed!).getByText('payment_intent.payment_failed')).toBeInTheDocument()
    expect(within(failed!).getByText('Card declined')).toBeInTheDocument()
    expect(within(recorded!).getByText('Payment recorded')).toBeInTheDocument()

    // Reconcile is the server's word only.
    expect(within(dialog).queryByRole('button', { name: 'Reconcile with Stripe' })).not.toBeInTheDocument()
  })

  it('marks a payment recorded beyond what was owed: “Overpaid: refund or credit” on the row and in the detail, with the amount and why; none on an owed one', async () => {
    const overpaid = { amountMinor: 120000, why: 'request_paid', settled: false }
    serve({ list: list({ items: [transaction({ overpaid }), CASH] }) })
    on('GET', /\/payments\/p-1$/, () =>
      json(detail({ payment: { ...transaction({ overpaid }), voided: null, paymentMethodType: 'card' }, canReconcile: false })),
    )
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=transactions' })
    const table = await screen.findByRole('table', { name: 'Transactions' })
    const [, alpha, beta] = within(table).getAllByRole('row')
    expect(within(alpha!).getByText('Overpaid: refund or credit')).toBeInTheDocument()
    expect(within(beta!).queryByText(/^Overpaid/)).not.toBeInTheDocument()

    await userEvent.click(within(table).getByText('Family Alpha'))
    const dialog = await screen.findByRole('dialog', { name: /^Payment of/ })
    expect(within(dialog).getByText('Overpaid: refund or credit')).toBeInTheDocument()
    expect(within(dialog).getByText(/^Overpaid by AED\s1,200\.00$/)).toBeInTheDocument()
    expect(within(dialog).getByText('The request was already paid when this money arrived.')).toBeInTheDocument()
  })

  it('an overpayment refunded since reads as settled, in Arabic too', async () => {
    serve({ list: list({ items: [transaction({ overpaid: { amountMinor: 50000, why: 'instalment_closed', settled: true } })] }) })
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=transactions', locale: 'ar' })
    const table = await screen.findByRole('table', { name: 'المعاملات' })
    expect(within(table).getByText('مبلغ زائد (تمت تسويته)')).toBeInTheDocument()
    expect(within(table).queryByText('مبلغ زائد: يُردّ أو يُضاف رصيدًا')).not.toBeInTheDocument()
  })

  it('Reconcile with Stripe shows Chat’s and Stripe’s numbers when they differ, and the refunds recorded', async () => {
    serve({ canReconcile: true })
    on('GET', /\/payments\/p-1$/, () => json(detail()))
    on('POST', /\/payments\/p-1\/reconcile$/, () =>
      json({
        paymentId: 'p-1', inSync: false, recordedRefunds: 1,
        chat: { amountMinor: 120000, refundedMinor: 0, currency: 'AED' },
        stripe: { status: 'succeeded', amountReceivedMinor: 120000, amountRefundedMinor: 20000, currency: 'AED' },
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=transactions' })
    const table = await screen.findByRole('table', { name: 'Transactions' })
    await userEvent.click(within(table).getAllByRole('button', { name: /^Details of the payment of/ })[0]!)
    const dialog = await screen.findByRole('dialog', { name: /^Payment of/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reconcile with Stripe' }))
    await waitFor(() => expect(calls('POST', /\/payments\/p-1\/reconcile$/)).toHaveLength(1))
    const result = await within(dialog).findByText('Chat and Stripe differ.')
    const panel = result.closest('[role="status"]') as HTMLElement
    const compare = within(panel).getByRole('table')
    const refunded = within(compare).getByRole('row', { name: /Refunded/ })
    expect(within(refunded).getAllByRole('cell').map((c) => c.textContent)).toEqual([expect.stringMatching(/0\.00/), expect.stringMatching(/200\.00/)])
    expect(within(panel).getByText('succeeded')).toBeInTheDocument()
    expect(within(panel).getByText('Refunds recorded now: 1')).toBeInTheDocument()
    // A refund was recorded: the payment is read again.
    await waitFor(() => expect(calls('GET', /\/payments\/p-1$/).length).toBeGreaterThan(1))
  })

  it('Reconcile says “in sync” when Chat and Stripe agree', async () => {
    serve({ canReconcile: true })
    on('GET', /\/payments\/p-1$/, () => json(detail()))
    on('POST', /\/payments\/p-1\/reconcile$/, () =>
      json({
        paymentId: 'p-1', inSync: true, recordedRefunds: 0,
        chat: { amountMinor: 120000, refundedMinor: 20000, currency: 'AED' },
        stripe: { status: 'succeeded', amountReceivedMinor: 120000, amountRefundedMinor: 20000, currency: 'AED' },
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=transactions' })
    const table = await screen.findByRole('table', { name: 'Transactions' })
    await userEvent.click(within(table).getByText('Family Alpha'))
    const dialog = await screen.findByRole('dialog', { name: /^Payment of/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reconcile with Stripe' }))
    expect(await within(dialog).findByText('In sync with Stripe.')).toBeInTheDocument()
    expect(within(dialog).getByText('Refunds recorded now: 0')).toBeInTheDocument()
    expect(within(dialog).queryByText('Chat and Stripe differ.')).not.toBeInTheDocument()
  })

  it('shows the server’s refusal the way the page shows errors', async () => {
    serve({ canReconcile: true })
    on('GET', /\/payments\/p-1$/, () => json(detail()))
    on('POST', /\/payments\/p-1\/reconcile$/, () => json({ error: { code: 'COMM.PAYMENTS_UNAVAILABLE', message: 'stripe not configured' } }, 503))
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=transactions' })
    const table = await screen.findByRole('table', { name: 'Transactions' })
    await userEvent.click(within(table).getByText('Family Alpha'))
    const dialog = await screen.findByRole('dialog', { name: /^Payment of/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reconcile with Stripe' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Card payments are not configured on this deployment.')
  })

  it('reads in Arabic', async () => {
    serve()
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=transactions', locale: 'ar' })
    expect(await screen.findByRole('table', { name: 'المعاملات' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'الإجماليات' })).toBeInTheDocument()
    expect(screen.getAllByText('مستردة جزئيًا').length).toBeGreaterThan(0)
  })
})

describe('Payments > Card attempts', () => {
  it('lists failed attempts by default with the decline in words and Stripe’s code; switches status', async () => {
    serve()
    on('GET', /\/payment-attempts(\?.*)?$/, (url) =>
      json({
        items: url.includes('status=all')
          ? [attempt({ sessionId: 'cs_test_paid', status: 'complete', failureCount: 0, failureCode: null, lastFailedAt: null, paymentId: 'p-9' })]
          : [
              attempt(),
              attempt({ sessionId: 'cs_test_b2', status: 'expired', failureCount: 0, failureCode: null, lastFailedAt: null, family: { id: 'f-2', name: 'Family Beta' } }),
              attempt({ sessionId: 'cs_test_b3', failureCount: 1, failureCode: 'stolen_card', family: { id: 'f-3', name: 'Family Gamma' } }),
            ],
        nextCursor: null,
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=attempts' })
    const table = await screen.findByRole('table', { name: 'Card attempts' })
    expect(qs(calls('GET', /\/payment-attempts/)[0]!)).toBe('status=failed')
    const filter = screen.getByRole('group', { name: 'Status' })
    expect(within(filter).getByRole('button', { name: 'Failed' })).toHaveAttribute('aria-pressed', 'true')

    const [, alpha, beta, gamma] = within(table).getAllByRole('row')
    expect(within(alpha!).getByText('Family Alpha')).toBeInTheDocument()
    expect(within(alpha!).getByText('Renewal, 1 month')).toBeInTheDocument()
    expect(within(alpha!).getByText(/600\.00/)).toBeInTheDocument()
    expect(within(alpha!).getByText('2')).toBeInTheDocument()
    expect(within(alpha!).getByText('The bank declined it for insufficient funds.')).toBeInTheDocument()
    expect(within(alpha!).getByText('insufficient_funds')).toBeInTheDocument()
    expect(within(alpha!).getByText('No')).toBeInTheDocument()
    expect(within(beta!).getByText('Left unpaid until it expired.')).toBeInTheDocument()
    // An alarming code reads as the generic decline; staff still see the code.
    expect(within(gamma!).getByText('The bank declined the card.')).toBeInTheDocument()
    expect(within(gamma!).getByText('stolen_card')).toBeInTheDocument()

    await userEvent.click(within(filter).getByRole('button', { name: 'All' }))
    await waitFor(() => expect(calls('GET', /\/payment-attempts\?status=all$/)).toHaveLength(1))
    const paid = await within(await screen.findByRole('table', { name: 'Card attempts' })).findByText('Yes')
    expect(paid).toBeInTheDocument()
  })

  it('words every decline kind the way the API’s card-failure table does', () => {
    expect(cardFailureKind('invalid_cvc')).toBe('incorrect_cvc')
    expect(cardFailureKind('invalid_number')).toBe('incorrect_number')
    expect(cardFailureKind('payment_intent_authentication_failure')).toBe('authentication')
    expect(cardFailureKind('fraudulent')).toBe('declined')
    expect(cardFailureKind(null)).toBe('declined')
    expect(attemptFailure({ failureCode: 'expired_card', failureCount: 1, status: 'open' })?.en).toBe('The card has expired.')
    expect(attemptFailure({ failureCode: null, failureCount: 0, status: 'failed' })?.ar).toBe('فشل الدفع.')
    expect(attemptFailure({ failureCode: null, failureCount: 0, status: 'complete' })).toBeNull()
    expect(cardLabel({ brand: 'mastercard', last4: '4444', wallet: 'apple_pay' })).toBe('Mastercard •••• 4444 (Apple Pay)')
    expect(cardLabel({ brand: null, last4: null, wallet: null })).toBeNull()
  })
})

describe('Payments > Stripe events', () => {
  it('is not offered without canReconcile, even by link', async () => {
    serve({ canReconcile: false })
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'admin' }), route: '/payments?tab=events' })
    await waitFor(() => expect(calls('GET', /\/instalments\/access$/).length).toBeGreaterThan(0))
    expect(await screen.findByText('No receipts here.')).toBeInTheDocument()
    expect(within(tabs()).queryByRole('button', { name: 'Stripe events' })).not.toBeInTheDocument()
    expect(within(tabs()).getByRole('button', { name: 'Receipts' })).toHaveAttribute('aria-pressed', 'true')
    expect(calls('GET', /\/stripe\/events/)).toHaveLength(0)
  })

  it('lists the webhook log, filters by outcome and type, loads more, and reconciles now', async () => {
    serve({ canReconcile: true })
    on('GET', /\/stripe\/events(\?.*)?$/, (url) =>
      json(
        url.includes('cursor=ev-2')
          ? { items: [event({ id: 'evt_test_10', type: 'charge.refunded', outcome: 'refund_recorded', objectId: 'ch_test_10' })], nextCursor: null }
          : { items: [event(), event({ id: 'evt_test_8', type: 'checkout.session.completed', outcome: 'recorded', livemode: false, objectId: 'cs_test_8' })], nextCursor: 'ev-2' },
      ),
    )
    on('POST', /\/stripe\/reconcile$/, () => json({ checked: 4, recorded: 1, expired: 2, refundsRecorded: 3, errors: 0 }))
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments' })
    await userEvent.click(await within(tabs()).findByRole('button', { name: 'Stripe events' }))
    const table = await screen.findByRole('table', { name: 'Stripe events' })
    expect(qs(calls('GET', /\/stripe\/events/)[0]!)).toBe('')
    const [, refund, completed] = within(table).getAllByRole('row')
    expect(within(refund!).getByText('refund.created')).toBeInTheDocument()
    expect(within(refund!).getByText('Refund waiting for its payment')).toBeInTheDocument()
    expect(within(refund!).getByText('Live')).toBeInTheDocument()
    expect(within(completed!).getByText('Test mode')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await within(table).findByText('charge.refunded')).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(4)

    const filters = screen.getByRole('region', { name: 'Filters' })
    await chooseOption(userEvent, within(filters).getByLabelText('Outcome'), 'refund_deferred')
    await chooseOption(userEvent, within(filters).getByLabelText('Event type'), 'refund.created')
    await waitFor(() => expect(calls('GET', /\/stripe\/events/).map(qs)).toContain('outcome=refund_deferred&type=refund.created'))

    await userEvent.click(screen.getByRole('button', { name: 'Reconcile now' }))
    await waitFor(() => expect(calls('POST', /\/stripe\/reconcile$/)).toHaveLength(1))
    const done = (await screen.findByText('Reconciled with Stripe.')).closest('[role="status"]') as HTMLElement
    const counts = Object.fromEntries(
      within(done).getAllByRole('term').map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
    )
    expect(counts).toEqual({ Checked: '4', 'Payments recorded': '1', 'Marked expired': '2', 'Refunds recorded': '3', Errors: '0' })
  })

  it('names dispute outcomes and not_chat in words (English and Arabic); urgent ones stand out; dispute events are a type filter', async () => {
    serve({ canReconcile: true })
    on('GET', /\/stripe\/events(\?.*)?$/, () =>
      json({
        items: [
          event({ id: 'evt_d1', type: 'charge.dispute.created', outcome: 'dispute_opened', objectId: 'du_test_1' }),
          event({ id: 'evt_d2', type: 'charge.dispute.funds_withdrawn', outcome: 'dispute_funds_withdrawn', objectId: 'du_test_1' }),
          event({ id: 'evt_d3', type: 'charge.dispute.closed', outcome: 'dispute_closed_won', objectId: 'du_test_1' }),
          event({ id: 'evt_d4', type: 'refund.created', outcome: 'not_chat', objectId: 're_test_x', paymentIntentId: 'pi_test_x' }),
        ],
        nextCursor: null,
      }),
    )
    const view = renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments' })
    await userEvent.click(await within(tabs()).findByRole('button', { name: 'Stripe events' }))
    const table = await screen.findByRole('table', { name: 'Stripe events' })
    const opened = await within(table).findByText('Dispute opened')
    expect(opened.closest('.badge')).toHaveClass('badge--danger')
    expect(within(table).getByText('Dispute: funds withdrawn').closest('.badge')).toHaveClass('badge--danger')
    expect(within(table).getByText('Dispute closed: won').closest('.badge')).toHaveClass('badge--ok')
    expect(within(table).getByText('Not a Chat payment')).toBeInTheDocument()

    const filters = screen.getByRole('region', { name: 'Filters' })
    await chooseOption(userEvent, within(filters).getByLabelText('Outcome'), 'dispute_opened')
    await chooseOption(userEvent, within(filters).getByLabelText('Event type'), 'charge.dispute.')
    await waitFor(() => expect(calls('GET', /\/stripe\/events/).map(qs)).toContain('outcome=dispute_opened&type=charge.dispute.'))
    view.unmount()

    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/payments?tab=events', locale: 'ar' })
    expect((await screen.findAllByText('فُتح اعتراض على الدفعة')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('ليست دفعة من Chat').length).toBeGreaterThan(0)
  })
})
