import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Highlighted, matchRanges, searchable, snippetAround } from './search'

// Code points, so the test source carries no invisible marks.
const c = (...cps: number[]) => String.fromCodePoint(...cps)
const FATHA = c(0x64e)
const SHADDA = c(0x651)
const ALEF_HAMZA = c(0x623)
const TEH_MARBUTA = c(0x629)

describe('search highlighting (mirrors chat.search_fold)', () => {
  it('matches case-insensitively', () => {
    expect(matchRanges('Surah Al-Mulk, surah AL', 'surah al')).toEqual([[0, 8], [15, 23]])
  })

  it('ignores harakat and spelling variants, and marks the ORIGINAL letters including their marks', () => {
    // "muhammad" with harakat on the meem and shadda+fatha on the second meem.
    const vowelled = `${c(0x645)}${FATHA}${c(0x62d)}${c(0x645)}${SHADDA}${FATHA}${c(0x62f)}`
    const plain = c(0x645, 0x62d, 0x645, 0x62f)
    const text = `${vowelled} ${c(0x62c, 0x627, 0x621)}`
    expect(matchRanges(text, plain)).toEqual([[0, vowelled.length]])
    // A typed bare alef finds a hamza alef; a typed heh finds a teh marbuta.
    expect(matchRanges(`${ALEF_HAMZA}${c(0x62d, 0x633, 0x646)}`, c(0x627, 0x62d, 0x633, 0x646))).toHaveLength(1)
    expect(matchRanges(`${c(0x62d, 0x635)}${TEH_MARBUTA}`, c(0x62d, 0x635, 0x647))).toHaveLength(1)
  })

  it('wraps each match in <mark> and leaves the rest as text', () => {
    const { container } = render(<Highlighted text="a fee and a FEE" query="fee" />)
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['fee', 'FEE'])
    expect(container.textContent).toBe('a fee and a FEE')
  })

  it('needs two real characters, and cuts a long text to its first match', () => {
    expect(searchable('a')).toBe(false)
    expect(searchable(`${FATHA}${SHADDA}`)).toBe(false)
    expect(searchable('ab')).toBe(true)
    const long = `${'word '.repeat(30)}the needle is here`
    expect(snippetAround(long, 'needle').startsWith('…')).toBe(true)
    expect(snippetAround(long, 'needle')).toContain('needle')
  })
})
