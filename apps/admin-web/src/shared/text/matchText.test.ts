import { describe, expect, it } from 'vitest'
import { foldForSearch, matchesQuery } from './matchText'

// Built from code points, so the source shows what each case is about.
const c = (...codes: number[]) => String.fromCharCode(...codes)
const ALEF = c(0x627)
const AHMAD_HAMZA = c(0x623, 0x62d, 0x645, 0x62f) // أحمد
const AHMAD_BARE = c(0x627, 0x62d, 0x645, 0x62f) // احمد
const MUHAMMAD_VOWELLED = c(0x645, 0x64f, 0x62d, 0x64e, 0x645, 0x651, 0x64e, 0x62f) // مُحَمَّد
const MUHAMMAD = c(0x645, 0x62d, 0x645, 0x62f)
const FATIMA_TA = c(0x641, 0x627, 0x637, 0x645, 0x629) // فاطمة
const FATIMA_HA = c(0x641, 0x627, 0x637, 0x645, 0x647) // فاطمه
const MUSTAFA_MAQSURA = c(0x645, 0x635, 0x637, 0x641, 0x649) // مصطفى
const MUSTAFA_YA = c(0x645, 0x635, 0x637, 0x641, 0x64a) // مصطفي
const TATWEEL = c(0x640)

describe('foldForSearch', () => {
  it('drops harakat, shadda and tatweel', () => {
    expect(foldForSearch(MUHAMMAD_VOWELLED)).toBe(MUHAMMAD)
    expect(foldForSearch(c(0x645, 0x62d) + TATWEEL + TATWEEL + c(0x645, 0x62f))).toBe(MUHAMMAD)
  })

  it('reads every alef form as a bare alef', () => {
    for (const alef of [0x623, 0x625, 0x622, 0x671]) {
      expect(foldForSearch(c(alef))).toBe(ALEF)
    }
  })

  it('reads alef maqsura and Persian yeh as yeh, and teh marbuta as heh', () => {
    expect(foldForSearch(MUSTAFA_MAQSURA)).toBe(MUSTAFA_YA)
    expect(foldForSearch(c(0x6cc))).toBe(c(0x64a))
    expect(foldForSearch(FATIMA_TA)).toBe(FATIMA_HA)
  })

  it('lower-cases Latin, drops its accents and squeezes spaces', () => {
    expect(foldForSearch('  Fâtma   ÉL-Sayed ')).toBe('fatma el-sayed')
  })

  it('reads Arabic-Indic digits as ASCII digits', () => {
    expect(foldForSearch(c(0x661, 0x662) + c(0x6f3))).toBe('123')
  })
})

describe('matchesQuery', () => {
  it('finds a hamza spelling from a bare one, and the reverse', () => {
    expect(matchesQuery(AHMAD_BARE, `${AHMAD_HAMZA} family`)).toBe(true)
    expect(matchesQuery(AHMAD_HAMZA, AHMAD_BARE)).toBe(true)
  })

  it('finds vowelled names from a plain query and plain names from a vowelled one', () => {
    expect(matchesQuery(MUHAMMAD, MUHAMMAD_VOWELLED)).toBe(true)
    expect(matchesQuery(MUHAMMAD_VOWELLED, MUHAMMAD)).toBe(true)
  })

  it('treats ة/ه and ى/ي as the same letter both ways', () => {
    expect(matchesQuery(FATIMA_HA, FATIMA_TA)).toBe(true)
    expect(matchesQuery(FATIMA_TA, FATIMA_HA)).toBe(true)
    expect(matchesQuery(MUSTAFA_YA, MUSTAFA_MAQSURA)).toBe(true)
  })

  it('matches anywhere in the label, every word in any order', () => {
    expect(matchesQuery('family', 'Ali family')).toBe(true)
    expect(matchesQuery('ali fam', 'Ali family')).toBe(true)
    expect(matchesQuery('fam ali', 'Ali family')).toBe(true)
    expect(matchesQuery('ali bakr', 'Ali family')).toBe(false)
  })

  it('searches the secondary text too (an e-mail, a role)', () => {
    expect(matchesQuery('qa.owner@', 'Organization Owner', 'qa.owner@example.test')).toBe(true)
    expect(matchesQuery('supervisor', 'Teacher A', null, 'Supervisor')).toBe(true)
  })

  it('is case-insensitive for Latin and matches everything on an empty query', () => {
    expect(matchesQuery('ALI', 'ali family')).toBe(true)
    expect(matchesQuery('   ', 'anything')).toBe(true)
  })
})
