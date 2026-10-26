import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PALETTE, PALETTE_KEYS, contrast, paletteCss } from './palette'

/**
 * PD-38: the supervisor colors are readable, in both schemes, by measurement --
 * the rule the gold accent taught us (a pleasing color can fail 4.5:1).
 */

const SURFACE = { light: '#ffffff', dark: '#161d20' } // tokens.css --surface

describe('the palette', () => {
  it.each(PALETTE_KEYS.flatMap((k) => (['light', 'dark'] as const).map((scheme) => [k, scheme] as const)))(
    '%s (%s): text on its fill is AA, and its border shows on the page',
    (key, scheme) => {
      const s = PALETTE[key][scheme]
      expect(contrast(s.text, s.fill)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(s.border, SURFACE[scheme])).toBeGreaterThanOrEqual(3)
    },
  )

  it('is the same list of keys the server accepts', () => {
    const server = readFileSync(resolve(__dirname, '../../../../api/src/calendar/palette.ts'), 'utf8')
    const keys = [...(/PALETTE_KEYS = \[([^\]]*)\]/.exec(server)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1])
    expect(keys).toEqual([...PALETTE_KEYS])
  })

  it('generates one rule per key and scheme, with the dark scheme under the same selectors as tokens.css', () => {
    const css = paletteCss()
    for (const k of PALETTE_KEYS) expect(css).toContain(`.sc-c-${k}{--sc-fill:${PALETTE[k].light.fill}`)
    expect(css).toContain("@media (prefers-color-scheme: dark){:root:not([data-theme='light']) .sc-c-sky{")
    expect(css).toContain(":root[data-theme='dark'] .sc-c-sky{")
  })

  it('measures contrast the WCAG way', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrast('#d4a24c', '#ffffff')).toBeLessThan(3) // the gold that may never carry text
  })
})
