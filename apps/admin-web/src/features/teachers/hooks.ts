import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/core/auth/SessionProvider'
import { statsApi, statsKeys } from './api'

/**
 * Whether the server counts this staff member as a lesson manager (Teachers
 * department or super admin). Navigation uses it to avoid offering a page that
 * would only answer "forbidden"; the page itself still asks the server.
 */
export function useLessonAccess(enabled = true) {
  return useQuery({
    queryKey: statsKeys.access,
    queryFn: statsApi.access,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

/**
 * PD-31: whether to OFFER "Change teacher" -- the super admin, the Teachers
 * department (lessonManager) and Operations (the child's supervisor, their
 * backup, the Operations manager). Guidance only: Operations is limited to its
 * PD-8 caseload, which only the server knows, and its refusal is shown as it is.
 */
export function useMayChangeTeacher(): boolean {
  const { staff } = useSession()
  const q = useLessonAccess(Boolean(staff))
  return staff?.role === 'super_admin' || q.data?.lessonManager === true || q.data?.operations === true
}

export function useTeacherStats(month: string) {
  return useQuery({ queryKey: statsKeys.teachers(month), queryFn: () => statsApi.teachers(month), staleTime: 60_000 })
}

export function useTeacherDetail(id: string | null, month: string) {
  return useQuery({
    queryKey: statsKeys.teacher(id ?? '', month),
    queryFn: () => statsApi.teacher(id as string, month),
    enabled: id !== null,
    staleTime: 60_000,
  })
}
