import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { instalmentKeys } from '@/features/instalments/api'
import { profileKeys } from '@/features/profiles/api'
import { paymentKeys, paymentsApi, type BillingSettingsUpdate, type NewTrialRequest, type ReceiptStatus } from './api'

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

export function useCancelTrialRequest(trialId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => paymentsApi.cancelTrialRequest(v.id, v.reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: paymentKeys.trial(trialId) }),
  })
}
