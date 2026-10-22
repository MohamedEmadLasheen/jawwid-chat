import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { disciplineApi, disciplineKeys, type DecideBody, type ViolationQuery } from './api'

export function useViolations(query: ViolationQuery) {
  return useQuery({ queryKey: disciplineKeys.violations(query), queryFn: () => disciplineApi.violations(query), staleTime: 15_000 })
}

function useRefresh() {
  const qc = useQueryClient()
  return () => {
    // A decision moves every later step of the month, and a suspension cancels lessons.
    void qc.invalidateQueries({ queryKey: disciplineKeys.all })
    void qc.invalidateQueries({ queryKey: ['teacher-files'] })
    void qc.invalidateQueries({ queryKey: ['lessons'] })
    void qc.invalidateQueries({ queryKey: ['trials'] })
    void qc.invalidateQueries({ queryKey: ['teacher-supervision'] })
  }
}

export function useDecide() {
  const done = useRefresh()
  return useMutation({
    mutationFn: ({ violationId, body }: { violationId: string; body: DecideBody }) => disciplineApi.decide(violationId, body),
    onSuccess: done,
  })
}

export function useRecordLateness() {
  const done = useRefresh()
  return useMutation({
    mutationFn: ({ lessonId, minutes, note }: { lessonId: string; minutes: number; note?: string }) =>
      disciplineApi.recordLateness(lessonId, { minutes, ...(note ? { note } : {}) }),
    onSuccess: done,
  })
}

export function useRecordAbsence() {
  const done = useRefresh()
  return useMutation({
    mutationFn: ({ teacherId, occurredOn, note }: { teacherId: string; occurredOn: string; note: string }) =>
      disciplineApi.recordAbsence(teacherId, { occurredOn, note }),
    onSuccess: done,
  })
}

export function useUpholdComplaint() {
  const done = useRefresh()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ complaintId, note }: { complaintId: string; note?: string }) => disciplineApi.upholdComplaint(complaintId, note),
    onSuccess: () => {
      done()
      void qc.invalidateQueries({ queryKey: ['teacher-supervision'] })
    },
  })
}
