import { useQuery } from '@tanstack/react-query'
import { lessonAudioApi, lessonAudioKeys } from './api'

/** PD-48: whether this account may open Lesson audio (and approve on it). The server's answer, nothing inferred. */
export function useLessonAudioAccess(enabled = true) {
  return useQuery({ queryKey: lessonAudioKeys.access, queryFn: lessonAudioApi.access, enabled, staleTime: 60_000, retry: false })
}
