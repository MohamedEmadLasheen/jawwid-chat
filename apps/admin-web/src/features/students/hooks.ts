import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { studentKeys, studentsApi, type StudentQuery } from './api'

export function useStudentList(f: StudentQuery) {
  return useQuery({ queryKey: studentKeys.list(f), queryFn: () => studentsApi.list(f), placeholderData: keepPreviousData })
}
