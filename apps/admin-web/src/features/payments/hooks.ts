import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { instalmentKeys, instalmentsApi } from '@/features/instalments/api'
import { profileKeys } from '@/features/profiles/api'
import {
  paymentKeys,
  paymentsApi,
  type AttemptFilter,
  type BillingSettingsUpdate,
  type NewTrialRequest,
  type ReceiptStatus,
  type StripeEventFilters,
  type TransactionFilters,
} from './api'

/** Re-read every few minutes: each receipt's file link is signed and short-lived. */
export function useReceipts(status: ReceiptStatus) {
  return useQuery({ queryKey: paymentKeys.receipts(status), queryFn: () => paymentsApi.receipts(status), refetchInterval: 4 * 60_000 })
}

/** A decision moves the receipt between lists and (approved) adds a payment to its family. */
function useReceiptDecision<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentKeys.all })
      void qc.invalidateQueries({ queryKey: profileKeys.all })
      void qc.invalidateQueries({ queryKey: instalmentKeys.all })
    },
  })
}

export function useApproveReceipt() {
  return useReceiptDecision((v: { id: string; amountMinor?: number; paidOn?: string }) =>
    paymentsApi.approveReceipt(v.id, {
      ...(v.amountMinor !== undefined ? { amountMinor: v.amountMinor } : {}),
      ...(v.paidOn ? { paidOn: v.paidOn } : {}),
    }),
  )
}

export function useRejectReceipt() {
  return useReceiptDecision((v: { id: string; reason: string }) => paymentsApi.rejectReceipt(v.id, v.reason))
}

export function useBillingSettings() {
  return useQuery({ queryKey: paymentKeys.settings, queryFn: paymentsApi.settings })
}

export function useSaveBillingSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BillingSettingsUpdate) => paymentsApi.saveSettings(body),
    onSuccess: (settings) => qc.setQueryData(paymentKeys.settings, settings),
  })
}

/** The signed PDF link is per viewer and lasts minutes: asked for at the click, then opened. */
export function useDownloadInvoice() {
  return useMutation({
    mutationFn: (invoiceId: string) => paymentsApi.invoiceLink(invoiceId),
    onSuccess: ({ url }) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
  })
}

export function useTrialPayments(trialId: string) {
  return useQuery({ queryKey: paymentKeys.trial(trialId), queryFn: () => paymentsApi.trialRequests(trialId) })
}

export function useCreateTrialRequest(trialId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: NewTrialRequest) => paymentsApi.createTrialRequest(trialId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: paymentKeys.trial(trialId) }),
  })
}

// ---- The transaction ledger ----

/** The academy's transactions, newest first, a page at a time; the totals come with the first page. */
export function useTransactions(filters: TransactionFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: paymentKeys.transactions(filters),
    queryFn: ({ pageParam }) => paymentsApi.transactions(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}

/**
 * Whether this viewer reconciles with Stripe (and so has the Stripe events
 * tab): GET /instalments/access's `canVerifyPayments` -- the same canVerify the
 * server's `canReconcile` answers, from the access query the app already
 * caches, so the page computes no transaction totals just to draw a tab.
 */
export function useLedgerAccess() {
  return useQuery({
    queryKey: instalmentKeys.access,
    queryFn: instalmentsApi.access,
    select: (d) => d.canVerifyPayments === true,
    staleTime: 5 * 60_000,
  })
}

export function useTransaction(paymentId: string) {
  return useQuery({ queryKey: paymentKeys.transaction(paymentId), queryFn: () => paymentsApi.transaction(paymentId) })
}

/** Refunds Stripe made that Chat lacked are recorded: the payment and the lists re-read. */
export function useReconcilePayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (paymentId: string) => paymentsApi.reconcilePayment(paymentId),
    onSuccess: (r) => {
      if (r.recordedRefunds > 0) {
        void qc.invalidateQueries({ queryKey: paymentKeys.all })
        void qc.invalidateQueries({ queryKey: profileKeys.all })
      } else {
        void qc.invalidateQueries({ queryKey: paymentKeys.transaction(r.paymentId) })
      }
    },
  })
}

export function useCardAttempts(status: AttemptFilter) {
  return useInfiniteQuery({
    queryKey: paymentKeys.attempts(status),
    queryFn: ({ pageParam }) => paymentsApi.attempts(status, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
}

export function useStripeEvents(filters: StripeEventFilters) {
  return useInfiniteQuery({
    queryKey: paymentKeys.stripeEvents(filters),
    queryFn: ({ pageParam }) => paymentsApi.stripeEvents(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
}

/** May record payments and refunds a webhook missed: everything money re-reads. */
export function useReconcileNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => paymentsApi.reconcileNow(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentKeys.all })
      void qc.invalidateQueries({ queryKey: profileKeys.all })
      void qc.invalidateQueries({ queryKey: instalmentKeys.all })
    },
  })
}

export function useCancelTrialRequest(trialId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => paymentsApi.cancelTrialRequest(v.id, v.reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: paymentKeys.trial(trialId) }),
  })
}
