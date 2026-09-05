import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { coverageApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'

export function useShifts() {
  return useQuery({ queryKey: qk.shifts, queryFn: () => coverageApi.shifts() })
}

export function useCoverageRules() {
  return useQuery({ queryKey: qk.coverageRules, queryFn: () => coverageApi.rules() })
}

export function useAbsences() {
  return useQuery({ queryKey: qk.absences, queryFn: () => coverageApi.absences() })
}

export function useCoverageTonight() {
  return useQuery({ queryKey: qk.coverageTonight, queryFn: () => coverageApi.tonight() })
}

export function useCoverageGaps(days = 7) {
  return useQuery({ queryKey: qk.coverageGaps(days), queryFn: () => coverageApi.gaps(days) })
}

/**
 * Every coverage mutation invalidates duty and the inbox as well as the
 * schedule: changing a rule changes who on_duty() returns, which changes whose
 * inbox a family sits in. Refreshing only the schedule table would leave the
 * operator looking at an inbox that no longer reflects reality.
 */
function useCoverageMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.coverageAll })
      void queryClient.invalidateQueries({ queryKey: qk.duty })
      void queryClient.invalidateQueries({ queryKey: qk.inboxAll })
      void queryClient.invalidateQueries({ queryKey: qk.dashboardAll })
    },
  })
}

export function useCreateShift() {
  return useCoverageMutation(coverageApi.createShift)
}
export function useDeleteShift() {
  return useCoverageMutation(coverageApi.deleteShift)
}
export function useCreateRule() {
  return useCoverageMutation(coverageApi.createRule)
}
export function useDeleteRule() {
  return useCoverageMutation(coverageApi.deleteRule)
}
/** Manager one-click. The brief forbids activating a backup automatically. */
export function useActivateBackup() {
  return useCoverageMutation(coverageApi.activateBackup)
}
