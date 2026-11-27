import { useCallback, useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { calendarApi, calendarKeys, type CalendarQuery, type SetWorkPattern } from './api'
import { SCHEDULE_WEEK_START, isWeekStart, type WeekStart } from './viewState'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the choice holds for this visit only.
  }
}

/** A yes/no the person chose on this page (a panel folded, filters opened), kept on this browser. */
export function useStoredFlag(key: string, fallback = false): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => {
    const v = read(key)
    return v === null ? fallback : v === '1'
  })
  const set = useCallback(
    (next: boolean) => {
      setValue(next)
      write(key, next ? '1' : '0')
    },
    [key],
  )
  return [value, set]
}

const WEEK_START_KEY = 'jawwid.schedule.week-start'

/**
 * The day the person's week starts on: SCHEDULE_WEEK_START (Saturday, the
 * academy's week) unless they chose another in the filters. A per-person
 * choice kept on this browser; no server setting exists for it.
 */
export function useWeekStart(): [WeekStart, (start: WeekStart) => void] {
  const [start, setStart] = useState<WeekStart>(() => {
    const v = Number(read(WEEK_START_KEY))
    return isWeekStart(v) ? v : (SCHEDULE_WEEK_START as WeekStart)
  })
  const set = useCallback((next: WeekStart) => {
    setStart(next)
    write(WEEK_START_KEY, String(next))
  }, [])
  return [start, set]
}

/** The instant now, moved on every half minute (the now line and what is over). */
export function useNow(): string {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date().toISOString()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

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
