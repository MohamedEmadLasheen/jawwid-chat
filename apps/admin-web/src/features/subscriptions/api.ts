import { api } from '@/core/api/client'

/**
 * PD-30 wire contract, mirrored from apps/api/src/billing/subscription-ledger.service.ts
 * and docs/admin/pd030-subscriptions.md. Who reads and changes what is the
 * server's answer alone; `canRecord` / `canGrantException` only decide which
 * buttons are offered.
 */

export type AccessState = 'open' | 'grace' | 'locked'
export type LockReason = 'balance' | 'overdue'
export type ExceptionKind = 'balance' | 'overdue' | 'both'
type Person = { id: string; name: string } | null

export interface Standing {
  child: { id: string; name: string }
  current: { id: string; planMonths: number | null; lessonsIncluded: number; startsOn: string } | null
  lessonsIncluded: number | null
  lessonsUsed: number | null
  lessonsLeft: number | null
  graceLeft: number | null
  state: AccessState
  lockReasons: LockReason[]
  overdue: { instalmentId: string; label: string; dueDate: string } | null
  /** Staff only: the signed balance, the reasons an exception holds off, lessons on hold. */
  balance: number | null
  excepted: LockReason[]
  held: boolean
}

export interface LedgerRow {
  id: string
  planMonths: number | null
  lessonsIncluded: number
  startsOn: string
  source: 'payment_request' | 'instalment_plan' | 'staff' | 'backfill'
  requestId: string | null
  note: string | null
  createdAt: string
  createdBy: Person
  voided: { at: string; by: Person; reason: string | null } | null
}

export interface SubscriptionException {
  id: string
  kind: ExceptionKind
  reason: string
  validUntil: string
  active: boolean
  grantedAt: string
  grantedBy: Person
  revoked: { at: string; by: Person; reason: string | null } | null
}

export interface SubscriptionView {
  /** SUBSCRIPTION_LOCK_ENFORCED on this deployment. Off: nothing is refused, the state is still shown. */
  enforced: boolean
  canRecord: boolean
  canGrantException: boolean
  standing: Standing | undefined
  subscriptions: LedgerRow[]
  exceptions: SubscriptionException[]
  renewalRequests: Array<{ id: string; requestedAt: string }>
}

export interface RenewalRequest {
  id: string
  child: { id: string; name: string }
  familyId: string
  parentName: string
  requestedAt: string
  /** A subscription was added after it. */
  renewed: boolean
}

/** GET /conversations/:id -> paymentLock (null when the group is not locked, or enforcement is off). */
export interface PaymentLock {
  readOnly: boolean
  canPay: boolean
  children: Array<{ id: string; name: string; reasons?: LockReason[]; overdue?: { label: string | null; dueDate: string } | null }>
}

export type NewSubscription = { lessonsIncluded: number; planMonths?: number | null; startsOn?: string; note?: string | null }
export type NewException = { kind: ExceptionKind; reason: string; validUntil: string }

const learner = (id: string) => `/learners/${encodeURIComponent(id)}`

export const subscriptionsApi = {
  view: (learnerId: string) => api.get<SubscriptionView>(`${learner(learnerId)}/subscription`),
  add: (learnerId: string, body: NewSubscription) => api.post<SubscriptionView>(`${learner(learnerId)}/subscriptions`, body),
  void: (id: string, reason: string) => api.post<SubscriptionView>(`/subscriptions/${encodeURIComponent(id)}/void`, { reason }),
  grant: (learnerId: string, body: NewException) => api.post<SubscriptionView>(`${learner(learnerId)}/subscription-exceptions`, body),
  revoke: (id: string, reason: string) =>
    api.post<SubscriptionView>(`/subscription-exceptions/${encodeURIComponent(id)}/revoke`, { reason }),
  renewalRequests: () => api.get<{ requests: RenewalRequest[] }>('/subscriptions/renewal-requests'),
}

export const subscriptionKeys = {
  all: ['pd30-subscriptions'] as const,
  learner: (id: string) => ['pd30-subscriptions', 'learner', id] as const,
  renewals: () => ['pd30-subscriptions', 'renewals'] as const,
}
