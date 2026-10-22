import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { useInstalmentAccess } from '@/features/instalments/hooks'
import { signedPutHeaders } from '@/features/chat/chatApi'
import { instalmentKeys } from '@/features/instalments/api'
import {
  profileKeys,
  profilesApi,
  type BillingUpdate,
  type CustomInstalments,
  type FamilyBilling,
  type InstalmentPaymentMethod,
  type NewFamilyPayment,
  type NewInstalments,
  type NewPaymentRequest,
  type ParentProfile,
  type ParentUpdate,
} from './api'

/**
 * Whether to OFFER a link to a Parent Profile: the super admin, or whoever
 * GET /instalments/access says reads a family's money (the same rule). A UX
 * affordance only -- the profile itself is decided by the server.
 */
export function useMayOpenParentProfiles(): boolean {
  const { staff } = useSession()
  const superAdmin = staff !== null && isSuperAdmin(staff.role)
  const access = useInstalmentAccess(staff !== null && !superAdmin)
  return superAdmin || access.data?.billingReader === true
}

export function useParents(q: string) {
  return useQuery({ queryKey: profileKeys.parents(q), queryFn: () => profilesApi.parents(q) })
}

/** Re-read every few minutes: photo links are signed and expire. */
export function useParent(id: string) {
  return useQuery({ queryKey: profileKeys.parent(id), queryFn: () => profilesApi.parent(id), enabled: id !== '', refetchInterval: 4 * 60_000 })
}

export function useFamilyBilling(familyId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.billing(familyId ?? ''),
    queryFn: () => profilesApi.billing(familyId!),
    enabled: !!familyId,
  })
}

export function useStudent(id: string) {
  return useQuery({ queryKey: profileKeys.student(id), queryFn: () => profilesApi.student(id), enabled: id !== '', refetchInterval: 4 * 60_000 })
}

export function useUpdateParent(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ParentUpdate) => profilesApi.updateParent(id, body),
    onSuccess: (profile: ParentProfile) => {
      qc.setQueryData(profileKeys.parent(id), profile)
      void qc.invalidateQueries({ queryKey: [...profileKeys.all, 'parents'] })
    },
  })
}

/** Authorize, PUT the bytes straight to storage on the signed URL, then commit; the server judges the stored bytes. */
export function useParentPhoto(id: string) {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: profileKeys.parent(id) })
  const upload = useMutation({
    mutationFn: async (photo: Blob) => {
      const grant = await profilesApi.authorizePhoto(id, photo.type, photo.size)
      const response = await fetch(grant.uploadUrl, {
        method: grant.method,
        headers: signedPutHeaders(photo.type, grant.headers),
        body: photo,
        credentials: 'omit',
      })
      if (!response.ok) throw new PhotoUploadError(response.status)
      return profilesApi.commitPhoto(id, grant.objectKey)
    },
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: () => profilesApi.removePhoto(id), onSuccess: refresh })
  return { upload, remove }
}

export class PhotoUploadError extends Error {
  constructor(readonly status: number) {
    super(`upload failed with ${status}`)
    this.name = 'PhotoUploadError'
  }
}

/** Every money write answers with the family's billing; the Instalments queue is re-read too. */
function useBillingWrite<V>(familyId: string, fn: (v: V) => Promise<FamilyBilling>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (billing) => {
      qc.setQueryData(profileKeys.billing(familyId), billing)
      void qc.invalidateQueries({ queryKey: instalmentKeys.all })
    },
  })
}

export function useUpdateBilling(familyId: string) {
  return useBillingWrite(familyId, (body: BillingUpdate) => profilesApi.updateBilling(familyId, body))
}

export function useCreateInstalments(familyId: string) {
  return useBillingWrite(familyId, (body: NewInstalments | CustomInstalments) => profilesApi.createInstalments(familyId, body))
}

export function useRecordPayment(familyId: string) {
  return useBillingWrite(familyId, (v: { id: string; paidOn: string; method: InstalmentPaymentMethod; reference?: string }) =>
    profilesApi.recordPayment(v.id, { paidOn: v.paidOn, method: v.method, ...(v.reference ? { reference: v.reference } : {}) }),
  )
}

export function useVoidInstalment(familyId: string) {
  return useBillingWrite(familyId, (v: { id: string; reason: string }) => profilesApi.voidInstalment(v.id, v.reason))
}

/** PD-27: answers the new request (to show its link) and the family's billing (cached). */
export function useCreatePaymentRequest(familyId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: NewPaymentRequest) => profilesApi.createPaymentRequest(familyId, body),
    onSuccess: ({ billing }) => {
      qc.setQueryData(profileKeys.billing(familyId), billing)
      void qc.invalidateQueries({ queryKey: instalmentKeys.all })
    },
  })
}

export function useCancelPaymentRequest(familyId: string) {
  return useBillingWrite(familyId, (v: { id: string; reason: string }) => profilesApi.cancelPaymentRequest(v.id, v.reason))
}

export function useRecordFamilyPayment(familyId: string) {
  return useBillingWrite(familyId, (body: NewFamilyPayment) => profilesApi.recordFamilyPayment(familyId, body))
}

export function useVoidPayment(familyId: string) {
  return useBillingWrite(familyId, (v: { id: string; reason: string }) => profilesApi.voidPayment(v.id, v.reason))
}

export function useRefundPayment(familyId: string) {
  return useBillingWrite(familyId, (v: { id: string; amountMinor: number; reason: string }) =>
    profilesApi.refundPayment(v.id, { amountMinor: v.amountMinor, reason: v.reason }),
  )
}
