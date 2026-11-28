import { describe, expect, it } from 'vitest'
import { digitsOf, findMatch, isNumeric, normalize } from './normalize'

describe('search matching', () => {
  it('folds alef forms, taa marbuta, alef maqsura, tashkeel and tatweel', () => {
    expect(normalize('أحمد')).toBe(normalize('احمد'))
    expect(normalize('إيمان')).toBe(normalize('ايمان'))
    expect(normalize('آمنة')).toBe(normalize('امنه'))
    expect(normalize('مصطفى')).toBe(normalize('مصطفي'))
    expect(normalize('مُحَمَّد')).toBe('محمد')
    expect(normalize('محـــمد')).toBe('محمد')
  })

  it('treats Arabic-Indic and Western digits as equal', () => {
    expect(normalize('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
    expect(normalize('۱۲۳')).toBe('123')
    expect(digitsOf('+971 (50) 123-4567')).toBe('971501234567')
    expect(digitsOf('٠٥٠ ١٢٣')).toBe('050123')
  })

  it('knows a number-only query', () => {
    expect(isNumeric('050 123')).toBe(true)
    expect(isNumeric('٠٥٠')).toBe(true)
    expect(isNumeric('أحمد 5')).toBe(false)
    expect(isNumeric('')).toBe(false)
  })

  it('finds the match in the original text, for highlighting', () => {
    const text = 'عائلة أحمد سالم'
    const m = findMatch(text, 'احمد')!
    expect(text.slice(m.start, m.end)).toBe('أحمد')
    expect(findMatch('Amal Hassan', 'hass')).toEqual({ start: 5, end: 9 })
    expect(findMatch('Amal Hassan', 'omar')).toBeNull()
  })

  it('highlights through diacritics', () => {
    const text = 'مُحَمَّد علي'
    const m = findMatch(text, 'محمد')!
    expect(normalize(text.slice(m.start, m.end))).toBe('محمد')
  })

  it('needs every word, in any order', () => {
    expect(findMatch('Salem family, Dubai', 'dubai salem')).not.toBeNull()
    expect(findMatch('Salem family, Dubai', 'salem cairo')).toBeNull()
  })

  it('matches a phone number by digits only', () => {
    const text = '+971 50 123 4567'
    const m = findMatch(text, '٥٠١٢٣')!
    expect(text.slice(m.start, m.end)).toBe('50 123')
    expect(findMatch(text, '999')).toBeNull()
  })
})
