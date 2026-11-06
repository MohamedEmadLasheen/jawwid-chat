import { describe, expect, it } from 'vitest'
import { dueClock, HOUR_MS } from './dueClock'

// Fixed instants: the clock is pure, no today+N fixtures. FILED is late in a
// UTC day so the 24 h window deliberately crosses midnight and a month end.
const FILED = Date.UTC(2026, 9, 31, 21, 0, 0)
const DUE = new Date(FILED + 24 * HOUR_MS).toISOString()

describe('the 24 h due clock (PD-57 D-1)', () => {
  it('shows the full 24 h just after filing', () => {
    expect(dueClock(DUE, 'open', FILED)).toEqual({ state: 'ok', hours: 24, minutes: 0 })
  })
  it('turns to a warning at 18 h elapsed (6 h left), when the managers are told', () => {
    expect(dueClock(DUE, 'open', FILED + 17 * HOUR_MS + 59 * 60_000).state).toBe('ok')
    expect(dueClock(DUE, 'open', FILED + 18 * HOUR_MS)).toEqual({ state: 'warn', hours: 6, minutes: 0 })
    expect(dueClock(DUE, 'in_review', FILED + 23 * HOUR_MS).state).toBe('warn')
  })
  it('is overdue at 24 h and counts how late', () => {
    expect(dueClock(DUE, 'in_review', FILED + 24 * HOUR_MS).state).toBe('overdue')
    expect(dueClock(DUE, 'open', FILED + 26 * HOUR_MS + 30 * 60_000)).toEqual({ state: 'overdue', hours: 2, minutes: 30 })
  })
  it('trusts the server when it has marked the report overdue', () => {
    expect(dueClock(DUE, 'open', FILED + HOUR_MS, '2026-11-01T21:00:00Z').state).toBe('overdue')
  })
  it('has no clock on a closed report', () => {
    expect(dueClock(DUE, 'actioned', FILED + 30 * HOUR_MS).state).toBe('closed')
    expect(dueClock(DUE, 'dismissed', FILED).state).toBe('closed')
  })
})
