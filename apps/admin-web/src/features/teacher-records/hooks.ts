import { useQuery } from '@tanstack/react-query'
import { teacherRecordsApi, teacherRecordsKeys } from './api'

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
