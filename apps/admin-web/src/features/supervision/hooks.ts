import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  supervisionApi,
  supervisionKeys,
  type ApproveBody,
  type LeaveState,
} from './api'

export function useLeaveRequests(state?: LeaveState) {
  return useQuery({ queryKey: supervisionKeys.leave(state), queryFn: () => supervisionApi.leaveRequests(state), staleTime: 15_000 })
}

/**
 * One teacher's leave. A refusal (403) is an answer, not an outage -- the
 * section simply does not show -- so it is not retried.
 */
export function useTeacherLeave(teacherId: string, year?: number) {
  return useQuery({
    queryKey: supervisionKeys.teacherLeave(teacherId, year),
    queryFn: () => supervisionApi.teacherLeave(teacherId, year),
    staleTime: 15_000,
    retry: false,
  })
}

function useRefreshAll() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: supervisionKeys.allLeave })
    void qc.invalidateQueries({ queryKey: supervisionKeys.allTeacherLeave })
    // A leave approval writes day_off entries the Teacher File shows.
    void qc.invalidateQueries({ queryKey: ['teacher-files'] })
  }
}

export function useApproveLeave() {
  const done = useRefreshAll()
  return useMutation({
    mutationFn: ({ requestId, body }: { requestId: string; body: ApproveBody }) => supervisionApi.approveLeave(requestId, body),
    onSuccess: done,
  })
}

export function useDeclineLeave() {
  const done = useRefreshAll()
  return useMutation({
    mutationFn: ({ requestId, note }: { requestId: string; note: string }) => supervisionApi.declineLeave(requestId, note),
    onSuccess: done,
  })
}

export function useCancelLeave() {
  const done = useRefreshAll()
  return useMutation({
    mutationFn: ({ requestId, note }: { requestId: string; note: string }) => supervisionApi.cancelLeave(requestId, note),
    onSuccess: done,
  })
}

export function useSetAllowance(teacherId: string) {
  const done = useRefreshAll()
  return useMutation({
    mutationFn: (body: { year: number; days: number; note?: string }) => supervisionApi.setAllowance(teacherId, body),
    onSuccess: done,
  })
}

export function useOpenSupervision() {
  return useMutation({ mutationFn: (teacherId: string) => supervisionApi.openSupervision(teacherId) })
}
