import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The underlined tab strips (Escalations, Trials, Teachers, Tasks, Organization,
 * Profile, Supervision, Staff accounts). The selected tab's label was drawn in
 * --accent, which in dark is 3.7:1 on a surface; on Escalations the tabs are
 * buttons and the browser's grey box showed through, so "Mine" read teal on
 * teal. The label now uses --text-link and only the underline uses --accent.
 */
const theme = (file: string) => readFileSync(join(__dirname, file), 'utf8')
const feature = (file: string) => readFileSync(join(__dirname, '../../features', file), 'utf8')

const tokens = theme('tokens.css')
const light = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('}', tokens.indexOf(':root {')))
const darkStart = tokens.indexOf(":root:not([data-theme='light']) {")
const dark = tokens.slice(darkStart, tokens.indexOf('}', darkStart))
const value = (block: string, name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6}|var\\(--([a-z0-9-]+)\\));`, 'i').exec(block) ?? new RegExp(`--${name}:\\s*(#[0-9a-f]{6}|var\\(--([a-z0-9-]+)\\));`, 'i').exec(light)
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

const ACTIVE: Array<[string, string, string]> = [
  ['teachers/teachers.css', '.ts-tab--active', 'Escalations, Trials, Teachers'],
  ['organization/organization.css', ".org-tab[aria-selected='true']", 'Organization, Students, Trials list'],
  ['tasks/tasks.css', ".tasks__tab[aria-selected='true']", 'Tasks'],
  ['profile/profile.css', ".sp-tab[aria-selected='true']", 'Profile'],
  ['supervision/supervision.css', ".sv-tab[aria-current='page']", 'Supervision'],
  ['staff-accounts/staff-accounts.css', '.sa-tab--active', 'Staff accounts'],
]

describe('the selected tab is readable in both themes', () => {
  it.each(ACTIVE)('%s %s (%s): label 4.5:1 on the page and on a card, underline 3:1', (file, selector) => {
    const css = feature(file)
    const at = css.indexOf(`${selector} {`)
    expect(at, selector).toBeGreaterThanOrEqual(0)
    const rule = css.slice(at, css.indexOf('}', at))
    const text = /[{;\s]color: var\(--([a-z0-9-]+)\)/.exec(rule)?.[1]
    const line = /border-block-end-color: var\(--([a-z0-9-]+)\)/.exec(rule)?.[1]
    expect(text, `${selector} label colour`).toBeDefined()
    expect(text).not.toMatch(/^(accent|gold-(?!700))/)
    for (const [name, block] of [['light', light], ['dark', dark]] as const) {
      for (const bg of ['bg', 'surface']) {
        expect(contrast(value(block, text!), value(block, bg)), `${selector} ${name} on --${bg}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(value(block, line!), value(block, bg)), `${selector} underline ${name} on --${bg}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('a .ts-tab button drops the browser box, so it looks like the link tabs', () => {
    const css = feature('teachers/teachers.css')
    const at = css.indexOf('.ts-tab {')
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toMatch(/background: transparent;/)
    expect(rule).toMatch(/border: 0;/)
    expect(rule).toMatch(/border-block-end: 2px solid transparent;/)
  })
})
