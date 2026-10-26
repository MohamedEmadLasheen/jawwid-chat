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

/** PD-31: a learner's lessons from now to four weeks ahead (the Lessons dialog). */
export function useUpcomingLessons(learnerId: string) {
  return useQuery({
    queryKey: opsKeys.upcoming(learnerId),
    queryFn: () => {
      const now = new Date()
      return opsApi.lessons({ learnerId, from: now.toISOString(), to: new Date(now.getTime() + 28 * 86_400_000).toISOString() })
    },
  })
}

/** PD-31: the weekly times offered to a learner -- of their teacher, or of `teacherId` (changing teacher). */
export function useScheduleOptions(learnerId: string | null, teacherId?: string) {
  return useQuery({
    queryKey: opsKeys.scheduleOptions(learnerId ?? '', teacherId ?? ''),
    queryFn: () => opsApi.scheduleOptions(learnerId as string, teacherId),
    enabled: learnerId !== null,
  })
}

export function useFreeSlots(learnerId: string, minutes: number) {
  return useQuery({
    queryKey: opsKeys.freeSlots(learnerId, minutes),
    queryFn: () => opsApi.freeSlots(learnerId, minutes),
    enabled: minutes > 0,
  })
}

export function useMoveSlots(lessonId: string) {
  return useQuery({ queryKey: opsKeys.moveSlots(lessonId), queryFn: () => opsApi.moveSlots(lessonId) })
}

export function useBlockedSlots(blockedId: string) {
  return useQuery({ queryKey: opsKeys.blockedSlots(blockedId), queryFn: () => opsApi.blockedSlots(blockedId) })
}

export function useTeacherCandidates() {
  return useQuery({ queryKey: opsKeys.candidates, queryFn: opsApi.teacherCandidates, staleTime: 60_000 })
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
