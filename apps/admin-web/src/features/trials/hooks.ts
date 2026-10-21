import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { trialKeys, trialsApi } from './api'

export function useTrials() {
  return useQuery({ queryKey: trialKeys.list, queryFn: () => trialsApi.list(), staleTime: 15_000 })
}

export function useProspects() {
  return useQuery({ queryKey: trialKeys.prospects, queryFn: trialsApi.prospects, staleTime: 30_000 })
}

export function useTrialTeachers(enabled: boolean) {
  return useQuery({ queryKey: trialKeys.teachers, queryFn: trialsApi.teachers, staleTime: 60_000, enabled })
}

export function useTrialSlots(teacherId: string, duration: number) {
  return useQuery({
    queryKey: trialKeys.slots(teacherId, duration),
    queryFn: () => trialsApi.slots(teacherId, duration),
    enabled: teacherId !== '' && duration > 0,
  })
}

export function useTrialGroup(conversationId: string, enabled = true) {
  return useQuery({
    queryKey: trialKeys.group(conversationId),
    queryFn: () => trialsApi.groupContext(conversationId),
    enabled: enabled && conversationId !== '',
    staleTime: 10_000,
    retry: false,
  })
}

export function useNewStudents() {
  // PD-16: refreshed every 15 s, so a parent's sign-up code reaches the supervisor promptly.
  return useQuery({ queryKey: trialKeys.newStudents, queryFn: trialsApi.newStudents, staleTime: 15_000, refetchInterval: 15_000 })
}

/** Every trial action can change the list, the free times and the New Students page: refresh all of them. */
export function useTrialOp<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trialKeys.all })
      void qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}
