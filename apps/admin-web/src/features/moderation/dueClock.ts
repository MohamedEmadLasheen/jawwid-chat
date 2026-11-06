import type { ReportStatus } from './api'

export const HOUR_MS = 3_600_000
/** D-1 (closure plan 2026-11-06): every report is due 24 h after it was filed; managers hear at 18 h (6 h left). */
export const WARN_LEFT_MS = 6 * HOUR_MS

export type ClockState = 'ok' | 'warn' | 'overdue' | 'closed'

export interface DueClock {
  state: ClockState
  /** Whole hours and minutes, of the time left (or, once overdue, past due). Always >= 0. */
  hours: number
  minutes: number
}

/** The 24 h clock at a given instant. Pure: the caller passes `nowMs`. */
export function dueClock(dueAt: string, status: ReportStatus, nowMs: number, overdueAt?: string | null): DueClock {
  if (status === 'actioned' || status === 'dismissed') return { state: 'closed', hours: 0, minutes: 0 }
  const diff = new Date(dueAt).getTime() - nowMs
  const abs = Math.abs(diff)
  const hours = Math.floor(abs / HOUR_MS)
  const minutes = Math.floor((abs % HOUR_MS) / 60_000)
  if (diff <= 0 || overdueAt) return { state: 'overdue', hours, minutes }
  return { state: diff <= WARN_LEFT_MS ? 'warn' : 'ok', hours, minutes }
}
