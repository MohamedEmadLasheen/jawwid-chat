import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  certificateKeys,
  certificatesApi,
  uploadDesign,
  type CertificateCategory,
  type ConsentBody,
  type ListQuery,
  type RequestBody,
} from './api'

/** What the caller may do on the page (nav, form, tabs). The server's answer, nothing inferred. */
export function useCertificateAccess(enabled = true) {
  return useQuery({ queryKey: certificateKeys.access, queryFn: certificatesApi.access, enabled, staleTime: 60_000, retry: false })
}

export function useCertificates(q: ListQuery, enabled = true) {
  return useQuery({ queryKey: certificateKeys.list(q), queryFn: () => certificatesApi.list(q), enabled, staleTime: 15_000 })
}

export function useCertificate(certificateId: string | null) {
  return useQuery({
    queryKey: certificateKeys.one(certificateId ?? ''),
    queryFn: () => certificatesApi.get(certificateId!),
    enabled: !!certificateId,
  })
}

export function useCertificateTypes(category?: CertificateCategory, includeDisabled = false, enabled = true) {
  return useQuery({ queryKey: certificateKeys.types(category, includeDisabled), queryFn: () => certificatesApi.types(category, includeDisabled), enabled, staleTime: 60_000 })
}

export function useRecipients(category: CertificateCategory, q: string, enabled = true) {
  return useQuery({ queryKey: certificateKeys.recipients(category, q), queryFn: () => certificatesApi.recipients(category, q), enabled, staleTime: 30_000 })
}

export function useDeliveryTarget(certificateId: string, enabled: boolean) {
  return useQuery({ queryKey: certificateKeys.delivery(certificateId), queryFn: () => certificatesApi.delivery(certificateId), enabled, staleTime: 0 })
}

/** Every write refreshes every list and the open certificate: the server's state is the only state. */
function useRefresh() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: certificateKeys.all })
}

export function useCreateCertificate() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (body: RequestBody) => certificatesApi.create(body), onSuccess: refresh })
}

/** One mutation for every act on a certificate: the route names it, the server decides it. */
export function useCertificateAct() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ certificateId, path, body }: { certificateId: string; path: string; body?: Record<string, unknown> }) =>
      certificatesApi.act(certificateId, path, body),
    onSuccess: refresh,
    onError: refresh,
  })
}

export function useConsent() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ certificateId, body }: { certificateId: string; body: ConsentBody }) => certificatesApi.act(certificateId, 'consent', body),
    onSuccess: refresh,
  })
}

export function useUploadDesign() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: ({ certificateId, file }: { certificateId: string; file: File }) => uploadDesign(certificateId, file), onSuccess: refresh })
}

export function useSaveType() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (args: { typeId?: string; body: Record<string, unknown> }) =>
      args.typeId ? certificatesApi.updateType(args.typeId, args.body) : certificatesApi.createType(args.body as never),
    onSuccess: refresh,
  })
}
