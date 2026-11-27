import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Dark comes two ways: from the device (Auto: `prefers-color-scheme`, unless Light was chosen) and
 * from the theme switch (`data-theme="dark"` on <html>). Every dark rule must exist in both forms,
 * with the same declarations, or choosing Dark paints part of a page in light-mode colours.
 */
const SRC = join(__dirname, '..', '..')
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return name.endsWith('.css') ? [path] : []
  })
}
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('every Auto-dark rule has its Dark twin', () => {
  const rules = cssFiles(SRC).flatMap((file) => {
    const css = readFileSync(file, 'utf8')
    return [...css.matchAll(/:root:not\(\[data-theme='light'\]\)([^{]*)\{([^}]*)\}/g)].map((m) => ({
      file: relative(SRC, file),
      selector: squash(m[1]!),
      body: squash(m[2]!),
      css: squash(css),
    }))
  })

  it('finds the dark rules (tokens, logo, chips, chat, schedule picker, trial badge)', () => {
    expect(rules.length).toBeGreaterThan(20)
  })

  it.each(rules.map((r) => [`${r.file}: ${r.selector || ':root'}`, r] as const))('%s', (_name, r) => {
    const twin = `:root[data-theme='dark']${r.selector ? ` ${r.selector}` : ''} { ${r.body} }`.replace(/ +\}/, ' }')
    expect(r.css.includes(squash(twin)) || r.css.includes(squash(twin).replace('{ ', '{').replace(' }', '}'))).toBe(true)
  })
})
