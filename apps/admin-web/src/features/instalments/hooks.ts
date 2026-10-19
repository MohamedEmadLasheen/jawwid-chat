import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { instalmentKeys, instalmentsApi, type InstalmentQuery } from './api'

/** The navigation probe. Only operators ask; the super admin reaches the page as a section. */
export function useInstalmentAccess(enabled: boolean) {
  return useQuery({ queryKey: instalmentKeys.access, queryFn: instalmentsApi.access, enabled, staleTime: 5 * 60_000 })
}

/** Read from Core on every request: kept fresh for a minute, never persisted. */
export function useInstalments(query: InstalmentQuery) {
  return useQuery({ queryKey: instalmentKeys.list(query), queryFn: () => instalmentsApi.list(query), staleTime: 60_000 })
}

export function useBillingSupervisor(familyId: string) {
  return useQuery({ queryKey: instalmentKeys.billingSupervisor(familyId), queryFn: () => instalmentsApi.billingSupervisor(familyId) })
}

export function useSetBillingSupervisor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ familyId, supervisorId, reason }: { familyId: string; supervisorId: string | null; reason: string }) =>
      instalmentsApi.setBillingSupervisor(familyId, { supervisorId, reason }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: instalmentKeys.all }),
  })
}
