import { describe, expect, it } from 'vitest'
import { dueClock, HOUR_MS } from './dueClock'

// A fixed instant: the clock is pure, no today+N fixtures.
const FILED = Date.UTC(2026, 10, 3, 9, 0, 0)
const DUE = new Date(FILED + 48 * HOUR_MS).toISOString()

describe('the 48 h due clock', () => {
  it('shows the full time left just after filing', () => {
    expect(dueClock(DUE, 'open', FILED)).toEqual({ state: 'ok', hours: 48, minutes: 0 })
  })
  it('turns to a warning at 36 h elapsed (12 h left), when the manager is told', () => {
    expect(dueClock(DUE, 'open', FILED + 35 * HOUR_MS + 59 * 60_000).state).toBe('ok')
    expect(dueClock(DUE, 'open', FILED + 36 * HOUR_MS)).toEqual({ state: 'warn', hours: 12, minutes: 0 })
    expect(dueClock(DUE, 'open', FILED + 40 * HOUR_MS).state).toBe('warn')
  })
  it('is overdue at 48 h and counts how late', () => {
    expect(dueClock(DUE, 'in_review', FILED + 48 * HOUR_MS).state).toBe('overdue')
    expect(dueClock(DUE, 'open', FILED + 50 * HOUR_MS + 30 * 60_000)).toEqual({ state: 'overdue', hours: 2, minutes: 30 })
  })
  it('trusts the server when it has marked the report overdue', () => {
    expect(dueClock(DUE, 'open', FILED + HOUR_MS, '2026-11-05T09:00:00Z').state).toBe('overdue')
  })
  it('has no clock on a closed report', () => {
    expect(dueClock(DUE, 'actioned', FILED + 60 * HOUR_MS).state).toBe('closed')
    expect(dueClock(DUE, 'dismissed', FILED).state).toBe('closed')
  })
})
