import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError, fallbackMessages } from './errors'

describe('ApiError', () => {
  it('exposes the message in the operator’s own language', () => {
    const error = new ApiError({
      status: 403,
      code: 'not_on_duty',
      messageEn: 'You are not on duty for this family.',
      messageAr: 'لستِ على النوبة لهذه العائلة.',
    })
    expect(error.localized('en')).toBe('You are not on duty for this family.')
    expect(error.localized('ar')).toBe('لستِ على النوبة لهذه العائلة.')
  })

  it('classifies the statuses the UI reacts to differently', () => {
    const forbidden = new ApiError({ status: 403, code: 'x', messageEn: '', messageAr: '' })
    const conflict = new ApiError({ status: 409, code: 'x', messageEn: '', messageAr: '' })
    expect(forbidden.isForbidden).toBe(true)
    expect(forbidden.isConflict).toBe(false)
    expect(conflict.isConflict).toBe(true)
  })

  it('carries server detail so a coverage conflict can be shown', () => {
    const error = new ApiError({
      status: 409,
      code: 'shift_overlap',
      messageEn: '',
      messageAr: '',
      detail: { overlapping_shift_id: 'shift_9' },
    })
    expect(error.detail).toEqual({ overlapping_shift_id: 'shift_9' })
  })

  it('has an Arabic fallback for every status it special-cases', () => {
    for (const status of [401, 403, 404, 409, 500]) {
      const fallback = fallbackMessages(status)
      expect(fallback.ar.length).toBeGreaterThan(0)
      expect(fallback.en.length).toBeGreaterThan(0)
    }
  })

  it('never leaks a stack trace into a user-facing message', () => {
    const error = new NetworkError(new Error('ECONNREFUSED at Socket._onError'))
    expect(error.localized('en')).not.toContain('Socket')
    expect(error.localized('ar')).not.toContain('Socket')
  })
})
