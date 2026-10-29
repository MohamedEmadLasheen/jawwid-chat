import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every picker's list is drawn by searchable-select.css, so one unreadable
 * colour here would be unreadable everywhere. Text never uses --accent (the
 * dark accent is 3.7:1, #273), and every text colour reaches 4.5:1 on each
 * background it can sit on, in light and dark.
 */
const css = readFileSync(join(__dirname, 'searchable-select.css'), 'utf8')
const tokens = readFileSync(join(__dirname, '../../core/theme/tokens.css'), 'utf8')
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
const colourOf = (selector: string) => {
  const at = css.indexOf(`${selector} {`)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  const rule = css.slice(at, css.indexOf('}', at))
  return /[{;\s]color: var\(--([a-z0-9-]+)\)/.exec(rule)?.[1]
}

// Each text colour and the option backgrounds it can be drawn on.
const OPTION_BGS = ['surface', 'surface-hover', 'surface-selected']
const TEXT: Array<[string, string[]]> = [
  ['.ss__option', OPTION_BGS],
  ['.ss__hint', OPTION_BGS],
  ['.ss__option .icon', ['surface-selected']],
  [".ss__option[aria-disabled='true']", ['surface']],
  ['.ss__empty', ['surface']],
  ['.ss__clear', ['surface']],
]

describe('the picker list is readable in both themes', () => {
  it('no text in the picker is drawn in --accent or a light gold', () => {
    for (const m of css.matchAll(/[{;\s]color: var\(--([a-z0-9-]+)\)/g)) {
      expect(m[1]).not.toMatch(/^(accent|gold-(?!700))/)
    }
  })

  it.each(TEXT)('%s reaches 4.5:1 on its backgrounds', (selector, backgrounds) => {
    const text = colourOf(selector)
    expect(text, `${selector} colour`).toBeDefined()
    for (const [theme, block] of [['light', light], ['dark', dark]] as const) {
      for (const bg of backgrounds) {
        expect(contrast(value(block, text!), value(block, bg)), `${selector} ${theme} on --${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
