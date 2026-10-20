import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Chat theme backgrounds in dark mode (review fix, PR #72). Dark comes either
 * from the system (`prefers-color-scheme`, unless the app is set to Light) or
 * from the app's own setting (`data-theme='dark'`), so every dark theme rule
 * must exist in both forms -- the second was missing, and choosing Dark in the
 * app painted pale light-mode backgrounds behind dark bubbles.
 */
describe('chat theme backgrounds follow the app’s Dark setting', () => {
  const css = readFileSync(join(__dirname, 'chat.css'), 'utf8')
  const systemDark = [...css.matchAll(/:root:not\(\[data-theme='light'\]\) (\.[^{]*cw-bg[^{]*)\{([^}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!.trim()])

  it('has a dark rule for every theme and the photo scrim', () => {
    expect(systemDark.length).toBe(9) // eight presets + the photo scrim
  })

  it.each(systemDark)('%s is also dark when Dark is chosen in the app', (selector, body) => {
    const twin = new RegExp(`:root\\[data-theme='dark'\\] ${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{\\s*${body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}`)
    expect(css).toMatch(twin)
  })
})
