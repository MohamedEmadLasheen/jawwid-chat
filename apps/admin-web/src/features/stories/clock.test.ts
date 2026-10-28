import { describe, expect, it } from 'vitest'
import { clock } from './clock'

describe('clock', () => {
  it('formats a duration as m:ss, adding hours only when there are any', () => {
    expect(clock(8)).toBe('0:08')
    expect(clock(78)).toBe('1:18')
    expect(clock(3660)).toBe('1:01:00')
  })

  it('never renders a negative or non-finite duration', () => {
    expect(clock(-5)).toBe('0:00')
    expect(clock(Number.NaN)).toBe('0:00')
    expect(clock(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})
