import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCALE_TAG } from './I18nProvider'
import { durationLabel, countLabel, LESSONS } from './counts'

/**
 * RQA-F3 / DD-09 (docs/design/decisions.md): Western digits 0-9 in both locales, everywhere.
 * `ar-EG` alone makes Intl print Arabic-Indic digits (٠١٢٣) for counts, dates and times, beside
 * numbers a screen writes in 0-9. The Arabic tag carries `-u-nu-latn`; this guards both the tag
 * and that no source file formats with a bare Arabic tag again.
 */
const arabicIndic = /[٠-٩۰-۹]/

describe('DD-09: Arabic formats with Western digits', () => {
  it('the Arabic locale tag formats numbers, percents, dates and times in 0-9', () => {
    const tag = LOCALE_TAG.ar
    const when = new Date('2026-10-29T17:05:00Z')
    const out = [
      new Intl.NumberFormat(tag).format(1234.5),
      new Intl.NumberFormat(tag, { style: 'percent' }).format(0.91),
      new Intl.NumberFormat(tag, { style: 'currency', currency: 'EGP' }).format(1250),
      new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeZone: 'UTC' }).format(when),
      new Intl.DateTimeFormat(tag, { timeStyle: 'short', timeZone: 'UTC' }).format(when),
      new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(when),
      new Intl.RelativeTimeFormat(tag, { numeric: 'always' }).format(3, 'day'),
    ]
    for (const text of out) expect(text).not.toMatch(arabicIndic)
    expect(out[0]).toContain('1')
    expect(out[3]).toContain('29')
  })

  it('the counts helper, with numbers formatted by the locale, reads 0-9', () => {
    const n = new Intl.NumberFormat(LOCALE_TAG.ar)
    expect(countLabel(3, n.format(3), LESSONS, 'ar')).toBe('3 حصص')
    expect(countLabel(11, n.format(11), LESSONS, 'ar')).toBe('11 حصة')
    expect(durationLabel(5506, (x) => n.format(x), 'ar')).toBe('3 أيام و19 ساعة')
  })

  it('no source file formats with a bare Arabic tag (ar-EG or ar) that would print Arabic-Indic digits', () => {
    const root = join(__dirname, '..', '..')
    // A bare Arabic tag: the literal 'ar-EG', or a ternary that RETURNS a bare 'ar' into a formatter
    // (not `locale === 'ar'`, which is the comparison). Comments and Intl.DisplayNames (region
    // names, no digits) are not formatting numbers.
    const bare = /['"`]ar-EG['"`]|\?\s*['"]ar['"]\s*:/
    const formats = /Intl\.(NumberFormat|DateTimeFormat|RelativeTimeFormat)|toLocale\w*\(|coverDay\(/
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
            const code = line.trim()
            if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return
            if (bare.test(line) && formats.test(line)) hits.push(`${path.slice(root.length + 1)}:${i + 1}: ${line.trim().slice(0, 100)}`)
          })
        }
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})
