import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@/core/i18n/I18nProvider'
import { TrialBadge, isTrialGroup } from './TrialBadge'

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('PD-32: the Trial label', () => {
  it('reads "Trial" in English and "تجريبية" in Arabic', () => {
    const { unmount } = render(<I18nProvider initialLocale="en"><TrialBadge /></I18nProvider>)
    expect(screen.getByTestId('trial-badge')).toHaveTextContent('Trial')
    unmount()
    render(<I18nProvider initialLocale="ar"><TrialBadge /></I18nProvider>)
    expect(screen.getByTestId('trial-badge')).toHaveTextContent('تجريبية')
  })

  it('is for trial groups only', () => {
    expect(isTrialGroup({ type: 'trial_group' })).toBe(true)
    expect(isTrialGroup({ type: 'student_group' })).toBe(false)
    expect(isTrialGroup(undefined)).toBe(false)
  })

  it("every colour pair it is drawn in is AA (4.5:1), and is the app's pair", () => {
    const css = readFileSync(join(__dirname, 'trial-badge.css'), 'utf8')
    const pairs = [...css.matchAll(/--trial-fg:\s*(#[0-9a-f]{6});\s*--trial-bg:\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1]!, m[2]!])
    expect(pairs.length).toBe(3) // light, dark by preference, dark by choice
    for (const [fg, bg] of pairs) expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(4.5)
    // lib/design/tokens.dart: trialBadgeFg/Bg.
    expect(pairs[0]).toEqual(['#5b21b6', '#ede9fe'])
    expect(pairs[1]).toEqual(['#ddd6fe', '#3b2a6b'])
  })
})
