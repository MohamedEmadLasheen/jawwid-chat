import { describe, expect, it } from 'vitest'
import { initials } from './Avatar'

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Salem family')).toBe('SF')
    expect(initials('  owner_o  ')).toBe('OO')
    expect(initials('عائلة سالم')).toBe('عس')
  })

  it('skips words with no letter in them, so a dash or a number never becomes an initial', () => {
    expect(initials('Parent — Haddad family')).toBe('PH')
    expect(initials('Teacher 11')).toBe('T')
  })

  it('falls back to a question mark rather than an empty circle', () => {
    expect(initials('')).toBe('?')
    expect(initials('— 42')).toBe('?')
  })
})
