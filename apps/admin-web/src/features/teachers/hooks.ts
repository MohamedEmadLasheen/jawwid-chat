import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { teacherFileApi, teacherFileKeys, type NewEntry, type PersonalPatch } from './api'

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

/**
 * Whether this staff member's navigation should offer Teacher Files. Only the
 * server knows who is in the Teachers department, so it is asked once: a 403
 * means "not for you" and is cached like an answer, not retried. This decides
 * a link, never access -- every request is still answered on its own.
 */
export function useTeacherFilesOffered(enabled: boolean): boolean {
  const probe = useQuery({
    queryKey: teacherFileKeys.list,
    queryFn: teacherFileApi.list,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  })
  return enabled && probe.isSuccess
}

function useRefresh(teacherId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: teacherFileKeys.detail(teacherId) })
    void qc.invalidateQueries({ queryKey: teacherFileKeys.list })
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
