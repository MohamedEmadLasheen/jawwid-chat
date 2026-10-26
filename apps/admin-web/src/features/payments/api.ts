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
}

export const paymentKeys = {
  all: ['pd27-payments'] as const,
  receipts: (status: ReceiptStatus) => ['pd27-payments', 'receipts', status] as const,
  settings: ['pd27-payments', 'settings'] as const,
  trial: (trialId: string) => ['pd27-payments', 'trial', trialId] as const,
}
