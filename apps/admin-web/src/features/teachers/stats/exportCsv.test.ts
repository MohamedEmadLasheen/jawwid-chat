import { describe, expect, it } from 'vitest'
import { toCsv } from './exportCsv'

describe('the list as CSV', () => {
  it('starts with a byte-order mark, quotes what needs quoting, and never lets a cell run as a formula', () => {
    const csv = toCsv(['Teacher', 'Reason'], [
      ['محمود صابر', 'missed 2 lessons; reports late, all month'],
      ['=HYPERLINK("x")', '-5'],
    ])
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).trimEnd().split('\r\n')
    expect(lines[0]).toBe('Teacher,Reason')
    expect(lines[1]).toBe('محمود صابر,"missed 2 lessons; reports late, all month"')
    expect(lines[2]).toBe(`"'=HYPERLINK(""x"")",-5`)
  })
})
