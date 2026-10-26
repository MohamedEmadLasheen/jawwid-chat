import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { calendarApi, calendarKeys, type CalendarQuery, type SetWorkPattern } from './api'

/** The filter panel's choices and what the viewer may edit. Refused (403) for anyone without a calendar. */
export function useCalendarOptions(enabled = true) {
  return useQuery({ queryKey: calendarKeys.options, queryFn: calendarApi.options, staleTime: 5 * 60_000, retry: false, enabled })
}

/** Day and week views. The previous answer stays on screen while the next one loads. */
export function useCalendarWindow(q: CalendarQuery, enabled: boolean) {
  return useQuery({
    queryKey: calendarKeys.window(q),
    queryFn: () => calendarApi.window(q),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

export function useCalendarSummary(q: CalendarQuery, enabled: boolean) {
  return useQuery({
    queryKey: calendarKeys.summary(q),
    queryFn: () => calendarApi.summary(q),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

/** The stats bar: the same filters as the calendar, so the two always agree. */
export function useCalendarStats(q: CalendarQuery) {
  return useQuery({
    queryKey: calendarKeys.stats(q),
    queryFn: () => calendarApi.stats(q),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

export function useWorkPatterns(teacherId: string) {
  return useQuery({ queryKey: calendarKeys.patterns(teacherId), queryFn: () => calendarApi.patterns(teacherId), staleTime: 60_000 })
}

/** A shift change moves every number: the calendar, its stats and (bookable hours) availability are re-read. */
export function useSetWorkPattern(teacherId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SetWorkPattern) => calendarApi.setPattern(teacherId, body),
    onSuccess: (data) => {
      qc.setQueryData(calendarKeys.patterns(teacherId), data)
      void qc.invalidateQueries({ queryKey: calendarKeys.all })
      void qc.invalidateQueries({ queryKey: ['lessons-ops'] })
    },
  })
}

export function useSetCalendarColor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { staffId: string; colorKey: string | null }) => calendarApi.setColor(v.staffId, v.colorKey),
    onSuccess: () => void qc.invalidateQueries({ queryKey: calendarKeys.all }),
  })
}
