import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supervisionTimelineApi, teacherFileApi, teacherFileKeys, timelineKeys, type NewEntry, type PersonalPatch } from './api'

export function useTeacherList(enabled = true) {
  return useQuery({ queryKey: teacherFileKeys.list, queryFn: teacherFileApi.list, enabled, staleTime: 30_000 })
}

export function useTeacherFile(teacherId: string) {
  return useQuery({
    queryKey: teacherFileKeys.detail(teacherId),
    queryFn: () => teacherFileApi.detail(teacherId),
    staleTime: 15_000,
  })
}

function useRefresh(teacherId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: teacherFileKeys.detail(teacherId) })
    void qc.invalidateQueries({ queryKey: teacherFileKeys.list })
    // Complaints, comments and days off are on the timeline too.
    void qc.invalidateQueries({ queryKey: timelineKeys.timeline(teacherId) })
  }
}

export function useUpdatePersonal(teacherId: string) {
  const done = useRefresh(teacherId)
  return useMutation({ mutationFn: (body: PersonalPatch) => teacherFileApi.updatePersonal(teacherId, body), onSuccess: done })
}

export function useAddEntry(teacherId: string) {
  const done = useRefresh(teacherId)
  return useMutation({ mutationFn: (body: NewEntry) => teacherFileApi.addEntry(teacherId, body), onSuccess: done })
}

/** PD-11's supervision timeline. A refusal is an answer (the section then does not show), not retried. */
export function useSupervisionTimeline(teacherId: string) {
  return useQuery({
    queryKey: timelineKeys.timeline(teacherId),
    queryFn: () => supervisionTimelineApi.timeline(teacherId),
    staleTime: 15_000,
    retry: false,
  })
}

export function useAddNote(teacherId: string) {
  const done = useRefresh(teacherId)
  return useMutation({ mutationFn: (body: string) => supervisionTimelineApi.addNote(teacherId, body), onSuccess: done })
}

export function useRecordBonus(teacherId: string) {
  const done = useRefresh(teacherId)
  return useMutation({ mutationFn: (reason: string) => supervisionTimelineApi.bonus(teacherId, reason), onSuccess: done })
}
