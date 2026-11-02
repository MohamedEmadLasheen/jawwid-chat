import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parentFeedbackKeys, supervisionHubKeys } from '@/features/teacher-supervision/api'
import { teacherRecordsApi, teacherRecordsKeys, type RecordAbout, type TestimonialQuery, type TestimonialSource } from './api'

/** Which of the two pages, and which actions, the server offers this account. */
export function useTeacherRecordsAccess(enabled = true) {
  return useQuery({
    queryKey: teacherRecordsKeys.access,
    queryFn: teacherRecordsApi.access,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useTestimonials(q: TestimonialQuery) {
  return useQuery({ queryKey: teacherRecordsKeys.testimonials(q), queryFn: () => teacherRecordsApi.testimonials(q), staleTime: 15_000 })
}

/** One teacher's strip; a refusal hides it, so it is never retried. */
export function useTeacherSummary(teacherId: string | null) {
  return useQuery({
    queryKey: teacherRecordsKeys.summary(teacherId ?? ''),
    queryFn: () => teacherRecordsApi.summary(teacherId!),
    enabled: !!teacherId,
    retry: false,
    staleTime: 15_000,
  })
}

export function useTeacherStudents(teacherId: string) {
  return useQuery({
    queryKey: teacherRecordsKeys.students(teacherId),
    queryFn: () => teacherRecordsApi.students(teacherId),
    enabled: !!teacherId,
    retry: false,
    staleTime: 30_000,
  })
}

/** A record changes the lists, the strip and the complaints of the Supervision sections. */
function useRefresh() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: teacherRecordsKeys.all })
    void qc.invalidateQueries({ queryKey: supervisionHubKeys.all })
    void qc.invalidateQueries({ queryKey: parentFeedbackKeys.all })
  }
}

export function useRecordTestimonial() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ teacherId, ...body }: { teacherId: string; body: string; source: TestimonialSource } & RecordAbout) =>
      teacherRecordsApi.recordTestimonial(teacherId, body),
    onSettled: refresh,
  })
}

export function useSharePraise() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (feedbackId: string) => teacherRecordsApi.sharePraise(feedbackId), onSettled: refresh })
}

export function useVoidEntry() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => teacherRecordsApi.voidEntry(id, reason), onSettled: refresh })
}
