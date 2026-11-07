import { api } from '@/core/api/client'

/**
 * PD-27 wire contract, mirrored from docs/admin/pd027-payments.md: payment
 * requests (each with its own public payment link), the payments that arrived
 * (card through Stripe, bank transfer, cash, PD-17's invoice), their refunds,
 * numbered invoices, the receipts parents upload, and the organization's
 * billing settings.
 *
 * Money is `amountMinor` (integer, minor units) + `currency` (ISO 4217).
 * Dates are YYYY-MM-DD in the academy's time zone; instants are ISO-8601.
 *
 * What a viewer may do is the server's answer alone (`canRecord`,
 * `canVerify`, `canDecide`, `canEdit`); these pages only offer the
 * controls it would accept. Nothing here sends a message: "Send on WhatsApp"
 * opens the staff member's own WhatsApp with the link typed in.
 */

export type PaymentMethod = 'card' | 'bank_transfer' | 'cash' | 'invoice'
export type RequestPurpose = 'subscription' | 'renewal' | 'instalment' | 'balance' | 'other'
export type RequestStatus = 'open' | 'paid' | 'cancelled' | 'expired'
export type ReceiptStatus = 'pending' | 'approved' | 'rejected'
export type InvoiceStatus = 'paid' | 'partially_refunded' | 'refunded' | 'void'
export type PlanMonths = 1 | 3 | 6 | 12

export interface Person {
  id: string
  name: string
}

/** `id` null: a trial's child before Assign. */
export interface Child {
  id: string | null
  name: string
}

export interface PaymentRequest {
  id: string
  purpose: RequestPurpose
  label: string
  status: RequestStatus
  amountMinor: number
  paidMinor: number
  remainingMinor: number
  currency: string
  child: Child | null
  instalmentId: string | null
  planMonths: PlanMonths | null
  /** PD-30: the lessons a subscription / renewal buys. */
  lessonsIncluded?: number | null
  periodStart: string | null
  periodEnd: string | null
  expiresAt: string
  createdAt: string
  /** Staff only: the full payment link. */
  link?: string
  createdBy?: Person
  cancelled?: { at: string; by: Person; reason: string } | null
  /** Set while the request belongs to a trial not yet assigned. */
  trialId?: string | null
  /** Store payments policy: verified as a lesson package, so the parent may pay it in the app. */
  payableInApp?: boolean
  /** A balance's lesson package. */
  lessonSubscriptionId?: string | null
}

export interface PaymentRefund {
  id: string
  amountMinor: number
  reason: string
  at: string
  source: 'stripe' | 'staff'
}

export interface Payment {
  id: string
  method: PaymentMethod
  amountMinor: number
  refundedMinor: number
  currency: string
  paidOn: string
  recordedAt: string
  requestId: string | null
  instalmentId: string | null
  child: Child | null
  reference: string | null
  invoice: { id: string; number: string } | null
  /** Staff only. null = Stripe. */
  recordedBy?: Person | null
  voided?: { at: string; by: Person; reason: string } | null
  refunds?: PaymentRefund[]
}

export interface Invoice {
  id: string
  number: string
  issuedAt: string
  status: InvoiceStatus
  amountMinor: number
  refundedMinor: number
  currency: string
  method: PaymentMethod
  paidOn: string
  label: string
  child: Child | null
  planMonths: PlanMonths | null
  periodStart: string | null
  periodEnd: string | null
}

export interface Receipt {
  id: string
  status: ReceiptStatus
  requestId: string
  label: string
  /** What the parent says they sent. */
  amountMinor: number
  currency: string
  transferredOn: string
  note: string | null
  uploadedAt: string
  /** Signed, bound to the viewer, short-lived: re-read the list for a fresh one. */
  fileUrl: string
  mimeType: string
  rejectReason: string | null
  paymentId: string | null
  family?: { id: string; name: string } | null
  uploadedBy?: Person
  reviewedBy?: Person | null
  reviewedAt?: string | null
}

/** Every field optional except accountName. */
export interface BankAccount {
  bankName: string | null
  accountName: string
  iban: string | null
  accountNumber: string | null
  swift: string | null
  note: string | null
}

export interface InvoiceIssuer {
  name: string
  address: string | null
  taxId: string | null
}

export interface ReminderRule {
  key: string
  /** Negative: before the due date; 0: on it; positive: after it. */
  offsetDays: number
  enabled: boolean
}

export interface BillingSettings {
  bankAccount: BankAccount | null
  issuer: InvoiceIssuer | null
  cardAvailable: boolean
  /** STRIPE_WEBHOOK_SECRET is set: without it no card payment is ever recorded. */
  webhookConfigured: boolean
  reminders: ReminderRule[]
  canEdit: boolean
}

export type BillingSettingsUpdate = Partial<{
  bankAccount: BankAccount | null
  issuer: InvoiceIssuer | null
  reminders: Array<{ key: string; enabled: boolean }>
}>

export interface ReceiptList {
  items: Receipt[]
  counts: Record<ReceiptStatus, number>
  /** This viewer approves and rejects receipts: the payment recorders (canRecord). */
  canDecide: boolean
}

/** A request before Assign: no family yet, the trial's id instead. */
export interface TrialPayments {
  /** Non-null once Assign made the family: its requests and payments now live on its Parent Profile. */
  enrolledFamilyId: string | null
  items: PaymentRequest[]
  payments: Payment[]
  /** The subscription form's package prices, when it has them. */
  suggestedAmountMinor: number | null
  currency: string
}

export interface NewTrialRequest {
  purpose?: 'subscription'
  label: string
  amountMinor: number
  currency?: string
  planMonths?: PlanMonths
  periodStart?: string
  periodEnd?: string
  expiresInDays?: number
}

// ---- The transaction ledger (docs/admin/pd027-stripe-lifecycle.md §3.5) ----
// Mirrored from apps/api/src/billing/transactions.service.ts and
// stripe-reconciler.service.ts. Read only, except Reconcile (canVerify).

/** Derived by the server: voided, else refunded in full, else partly, else standing. */
export type TransactionStatus = 'standing' | 'partially_refunded' | 'refunded' | 'voided'
/** A card attempt (one Stripe Checkout Session). */
export type AttemptStatus = 'open' | 'complete' | 'expired' | 'failed'
/** `failed` (the default): declined, failed, or expired unpaid. */
export type AttemptFilter = 'failed' | 'open' | 'expired' | 'complete' | 'all'

export interface StripeRefs {
  checkoutSessionId: string | null
  paymentIntentId: string | null
  chargeId: string | null
  customerId: string | null
  /** false: Stripe test mode; null: unknown (no session). */
  livemode: boolean | null
}

export interface Transaction {
  id: string
  status: TransactionStatus
  method: PaymentMethod
  amountMinor: number
  refundedMinor: number
  currency: string
  paidOn: string
  recordedAt: string
  /** null: a trial's payment before Assign. */
  family: { id: string; name: string } | null
  trialId: string | null
  child: Child | null
  request: { id: string; label: string; purpose: RequestPurpose; planMonths: number | null } | null
  instalmentId: string | null
  invoice: { id: string; number: string } | null
  reference: string | null
  /** null: Stripe. */
  recordedBy: Person | null
  card: { brand: string | null; last4: string | null; wallet: string | null } | null
  /** Card payments only. */
  stripe: StripeRefs | null
}

export interface TransactionTotal {
  currency: string
  count: number
  amountMinor: number
  refundedMinor: number
  netMinor: number
}

export interface TransactionList {
  items: Transaction[]
  nextCursor: string | null
  totals: TransactionTotal[]
  /** This viewer reconciles with Stripe and reads the webhook log (canVerify). */
  canReconcile: boolean
}

export interface TransactionFilters {
  status?: TransactionStatus | ''
  method?: PaymentMethod | ''
  purpose?: RequestPurpose | ''
  planMonths?: PlanMonths | ''
  /** Paid on, YYYY-MM-DD, inclusive. */
  from?: string
  to?: string
  familyId?: string
  /** Family, child, invoice number, or an exact Stripe id. At most 100 characters. */
  q?: string
}

export interface CardAttempt {
  sessionId: string
  status: AttemptStatus
  amountMinor: number
  currency: string
  createdAt: string
  expiresAt: string
  /** Declines on Stripe's page; the attempt may still be paid after them. */
  failureCount: number
  /** Stripe's decline or error code, never its message. */
  failureCode: string | null
  lastFailedAt: string | null
  paymentIntentId: string | null
  customerId: string | null
}

export interface CardAttemptRow extends CardAttempt {
  /** Set when this attempt was paid. */
  paymentId: string | null
  request: { id: string; label: string; purpose: RequestPurpose }
  family: { id: string; name: string } | null
  trialId: string | null
}

export interface StripeEvent {
  id: string
  type: string
  livemode: boolean
  receivedAt: string
  stripeCreatedAt: string | null
  outcome: string
  objectId: string | null
  paymentIntentId: string | null
}

export interface TransactionRefund {
  id: string
  amountMinor: number
  reason: string
  at: string
  source: 'stripe' | 'staff'
  recordedBy: Person | null
  stripeRefundId: string | null
}

export interface TransactionDetail {
  payment: Transaction & {
    voided: { at: string; by: Person | null; reason: string | null } | null
    paymentMethodType: string | null
  }
  refunds: TransactionRefund[]
  request: {
    id: string
    label: string
    purpose: RequestPurpose
    amountMinor: number
    currency: string
    planMonths: number | null
    periodStart: string | null
    periodEnd: string | null
    status: RequestStatus
  } | null
  attempts: CardAttempt[]
  events: StripeEvent[]
  /** A card payment with a payment intent, and a viewer who may reconcile. */
  canReconcile: boolean
}

export interface PaymentReconciliation {
  paymentId: string
  inSync: boolean
  /** Refunds Stripe made that Chat lacked, recorded now. */
  recordedRefunds: number
  chat: { amountMinor: number; refundedMinor: number; currency: string }
  stripe: { status: string; amountReceivedMinor: number; amountRefundedMinor: number; currency: string }
}

export interface ReconcileSweepResult {
  checked: number
  recorded: number
  expired: number
  refundsRecorded: number
  errors: number
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface StripeEventFilters {
  outcome?: string
  /** A prefix: `refund.` matches every refund event. */
  type?: string
}

const id = (v: string) => encodeURIComponent(v)

/** The trial's requests, on the trials controller beside PD-16's other New Students routes. */
const trialRequests = (trialId: string) => `/trials/new-students/${id(trialId)}/payment-requests`

export const paymentsApi = {
  receipts: (status: ReceiptStatus) => api.get<ReceiptList>('/payment-receipts', { status }),
  approveReceipt: (receiptId: string, body: { amountMinor?: number; paidOn?: string }) =>
    api.post<{ receipt: Receipt }>(`/payment-receipts/${id(receiptId)}/approve`, body),
  rejectReceipt: (receiptId: string, reason: string) =>
    api.post<{ receipt: Receipt }>(`/payment-receipts/${id(receiptId)}/reject`, { reason }),
  invoiceLink: (invoiceId: string) => api.get<{ url: string }>(`/invoices/${id(invoiceId)}/link`),
  settings: () => api.get<BillingSettings>('/billing/settings'),
  saveSettings: (body: BillingSettingsUpdate) => api.post<BillingSettings>('/billing/settings', body),
  trialRequests: (trialId: string) => api.get<TrialPayments>(trialRequests(trialId)),
  createTrialRequest: (trialId: string, body: NewTrialRequest) => api.post<{ request: PaymentRequest }>(trialRequests(trialId), body),
  /** A trial's request answers `{request}`; a family's answers its billing (see profiles/api). */
  cancelTrialRequest: (requestId: string, reason: string) =>
    api.post<{ request: PaymentRequest }>(`/payment-requests/${id(requestId)}/cancel`, { reason }),
  /** Keys in a fixed order; the client drops the empty ones. */
  transactions: (f: TransactionFilters, cursor: string | null, limit?: number) =>
    api.get<TransactionList>('/payments', {
      status: f.status,
      method: f.method,
      purpose: f.purpose,
      planMonths: f.planMonths,
      from: f.from,
      to: f.to,
      familyId: f.familyId,
      q: f.q,
      cursor,
      limit,
    }),
  transaction: (paymentId: string) => api.get<TransactionDetail>(`/payments/${id(paymentId)}`),
  reconcilePayment: (paymentId: string) => api.post<PaymentReconciliation>(`/payments/${id(paymentId)}/reconcile`),
  attempts: (status: AttemptFilter, cursor: string | null) => api.get<Page<CardAttemptRow>>('/payment-attempts', { status, cursor }),
  stripeEvents: (f: StripeEventFilters, cursor: string | null) =>
    api.get<Page<StripeEvent>>('/stripe/events', { outcome: f.outcome, type: f.type, cursor }),
  reconcileNow: () => api.post<ReconcileSweepResult>('/stripe/reconcile'),
}

export const paymentKeys = {
  all: ['pd27-payments'] as const,
  receipts: (status: ReceiptStatus) => ['pd27-payments', 'receipts', status] as const,
  settings: ['pd27-payments', 'settings'] as const,
  trial: (trialId: string) => ['pd27-payments', 'trial', trialId] as const,
  transactions: (f: TransactionFilters) => ['pd27-payments', 'transactions', f] as const,
  /** Whether this viewer reconciles (the Stripe events tab): one row of the list. */
  ledgerAccess: ['pd27-payments', 'ledger-access'] as const,
  transaction: (paymentId: string) => ['pd27-payments', 'transaction', paymentId] as const,
  attempts: (status: AttemptFilter) => ['pd27-payments', 'attempts', status] as const,
  stripeEvents: (f: StripeEventFilters) => ['pd27-payments', 'stripe-events', f] as const,
}
