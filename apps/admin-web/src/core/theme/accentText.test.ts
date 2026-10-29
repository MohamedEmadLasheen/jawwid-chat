import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Text is never drawn in --accent. In dark --accent is #1b7f93: 3.7:1 on a
 * surface and 2.9:1 on --accent-soft, below 4.5:1. Text uses --text-link and
 * --accent stays on borders, underlines, fills and icons. The tab strips came
 * first (tabs.test.ts); these are the links, initials, filter and cards.
 */
const src = join(__dirname, '../..')
const read = (file: string) => readFileSync(join(src, file), 'utf8')

const tokens = read('core/theme/tokens.css')
const light = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('}', tokens.indexOf(':root {')))
const darkStart = tokens.indexOf(":root:not([data-theme='light']) {")
const dark = tokens.slice(darkStart, tokens.indexOf('}', darkStart))
const value = (block: string, name: string): string => {
  const re = new RegExp(`--${name}:\\s*(#[0-9a-f]{6}|var\\(--([a-z0-9-]+)\\));`, 'i')
  const m = re.exec(block) ?? re.exec(light)
  if (!m) throw new Error(`no --${name}`)
  return m[2] ? value(block, m[2]) : m[1]!
}
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

// [file, selector, what it is, the backgrounds its text sits on]
const RULES: Array<[string, string, string, string[]]> = [
  ['features/profile/profile.css', '.sp-row__link', 'staff name link (Profile, Organization)', ['bg', 'surface']],
  ['features/profile/profile.css', '.sp-avatar', 'avatar initials', ['accent-soft']],
  ['features/staff-accounts/staff-accounts.css', '.sa-name', 'account name (Staff accounts)', ['surface']],
  ['features/schedule/schedule.css', '.sc-filter--on', 'active filter chip (Schedule)', ['accent-soft']],
  ['features/stories/stories.css', '.type-card.is-selected', 'selected story type', ['accent-soft']],
  ['features/stories/stories.css', '.cta-choice.is-selected', 'selected story button', ['accent-soft']],
]

describe('text on --accent surfaces is readable in both themes', () => {
  it.each(RULES)('%s %s (%s)', (file, selector, _what, backgrounds) => {
    const css = read(file)
    const at = css.indexOf(`${selector} {`)
    expect(at, selector).toBeGreaterThanOrEqual(0)
    const rule = css.slice(at, css.indexOf('}', at))
    const text = /[{;\s]color: var\(--([a-z0-9-]+)\)/.exec(rule)?.[1]
    expect(text, `${selector} text colour`).toBe('text-link')
    for (const [name, block] of [['light', light], ['dark', dark]] as const) {
      for (const bg of backgrounds) {
        expect(contrast(value(block, text!), value(block, bg)), `${selector} ${name} on --${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('no stylesheet draws text in --accent', () => {
  const sheets = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? sheets(join(dir, e.name)) : e.name.endsWith('.css') ? [join(dir, e.name)] : [],
    )

  it('only icons (non-text, graded 3:1) may take color: var(--accent)', () => {
    const found: string[] = []
    for (const path of sheets(src)) {
      const css = readFileSync(path, 'utf8')
      for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (!/(^|[;{\s])color:\s*var\(--accent\)/.test(m[2]!)) continue
        const selector = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim()
        if (selector.split(',').every((s) => /__icon$/.test(s.trim()))) continue
        found.push(`${relative(src, path)}: ${selector}`)
      }
    }
    expect(found).toEqual([])
  })
})
