import { useQuery } from '@tanstack/react-query'
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
