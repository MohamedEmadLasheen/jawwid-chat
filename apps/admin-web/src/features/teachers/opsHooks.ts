import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { opsApi, opsKeys } from './opsApi'

export function useNeedsAction() {
  return useQuery({ queryKey: opsKeys.needsAction, queryFn: opsApi.needsAction, staleTime: 15_000 })
}

export function useRoster() {
  return useQuery({ queryKey: opsKeys.roster, queryFn: opsApi.roster, staleTime: 30_000 })
}

export function useAvailability(teacherId: string | null) {
  return useQuery({
    queryKey: opsKeys.availability(teacherId ?? ''),
    queryFn: () => opsApi.availability(teacherId as string),
    enabled: teacherId !== null,
  })
}

/** A learner's lessons from a week ago to four weeks ahead (the API's default window). */
export function useLearnerLessons(learnerId: string | null) {
  return useQuery({
    queryKey: opsKeys.learnerLessons(learnerId ?? ''),
    queryFn: () => opsApi.lessons({ learnerId: learnerId as string }),
    enabled: learnerId !== null,
  })
}

export function useSuspensions(kind: 'temporary' | 'permanent', status: 'active' | 'ended') {
  return useQuery({ queryKey: opsKeys.suspensions(kind, status), queryFn: () => opsApi.suspensions({ kind, status }) })
}

/**
 * Every operation here can change the queue, the roster, a learner's lessons
 * and the statistics, so each success refreshes all of them -- a supervisor
 * never looks at a list that still shows what they just resolved.
 */
export function useOp<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: opsKeys.all })
      void qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}
