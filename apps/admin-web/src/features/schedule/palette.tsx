/**
 * PD-38: the supervisor colors. The server stores only a key (the CHECK on
 * chat.staff_calendar_color); every fill, border and text color lives here, for
 * the light and the dark scheme, and the CSS is generated from this one table
 * (paletteCss), so no second copy can drift.
 *
 * Contrast is a requirement, measured by palette.test.ts (WCAG 2.1):
 *   - text on its fill >= 4.5:1 (a lesson's label sits on the fill);
 *   - the border >= 3:1 against the page surface (it carries the status:
 *     solid active, dashed trial, dotted paused).
 * A lesson is never identified by color alone: the supervisor's name is in the
 * legend and in the lesson's details, and the status is a line style.
 */

export const PALETTE_KEYS = [
  'sky', 'red', 'peach', 'green', 'purple', 'teal',
  'amber', 'pink', 'indigo', 'olive', 'brown', 'slate',
] as const

export type PaletteKey = (typeof PALETTE_KEYS)[number]

export interface Swatch {
  fill: string
  border: string
  text: string
}

export const PALETTE: Record<PaletteKey, { light: Swatch; dark: Swatch; name: { en: string; ar: string } }> = {
  sky: { light: { fill: '#dbeafe', border: '#2563eb', text: '#1e3a8a' }, dark: { fill: '#1b3354', border: '#60a5fa', text: '#dbeafe' }, name: { en: 'Light blue', ar: 'أزرق فاتح' } },
  red: { light: { fill: '#fee2e2', border: '#dc2626', text: '#7f1d1d' }, dark: { fill: '#4a1d1d', border: '#f87171', text: '#fee2e2' }, name: { en: 'Red', ar: 'أحمر' } },
  peach: { light: { fill: '#fde7d4', border: '#c2410c', text: '#7a3e0c' }, dark: { fill: '#4a2c16', border: '#fb923c', text: '#fde7d4' }, name: { en: 'Peach', ar: 'خوخي' } },
  green: { light: { fill: '#dcfce7', border: '#15803d', text: '#14532d' }, dark: { fill: '#183d27', border: '#4ade80', text: '#dcfce7' }, name: { en: 'Green', ar: 'أخضر' } },
  purple: { light: { fill: '#ede9fe', border: '#7c3aed', text: '#4c1d95' }, dark: { fill: '#33255a', border: '#a78bfa', text: '#ede9fe' }, name: { en: 'Purple', ar: 'بنفسجي' } },
  teal: { light: { fill: '#ccfbf1', border: '#0f766e', text: '#134e4a' }, dark: { fill: '#123d3a', border: '#2dd4bf', text: '#ccfbf1' }, name: { en: 'Teal', ar: 'فيروزي' } },
  amber: { light: { fill: '#fef3c7', border: '#b45309', text: '#78350f' }, dark: { fill: '#45330f', border: '#fbbf24', text: '#fef3c7' }, name: { en: 'Amber', ar: 'كهرماني' } },
  pink: { light: { fill: '#fce7f3', border: '#be185d', text: '#831843' }, dark: { fill: '#4a1a33', border: '#f472b6', text: '#fce7f3' }, name: { en: 'Pink', ar: 'وردي' } },
  indigo: { light: { fill: '#e0e7ff', border: '#4f46e5', text: '#312e81' }, dark: { fill: '#262a5c', border: '#818cf8', text: '#e0e7ff' }, name: { en: 'Indigo', ar: 'نيلي' } },
  olive: { light: { fill: '#eef2d6', border: '#65731f', text: '#3f4716' }, dark: { fill: '#2e3414', border: '#b5c44f', text: '#eef2d6' }, name: { en: 'Olive', ar: 'زيتوني' } },
  brown: { light: { fill: '#f0e4da', border: '#8b5e3c', text: '#4a2e1a' }, dark: { fill: '#3a2a1e', border: '#c79a73', text: '#f0e4da' }, name: { en: 'Brown', ar: 'بني' } },
  slate: { light: { fill: '#e2e8f0', border: '#475569', text: '#1e293b' }, dark: { fill: '#273241', border: '#94a3b8', text: '#e2e8f0' }, name: { en: 'Slate', ar: 'رمادي' } },
}

export function isPaletteKey(v: unknown): v is PaletteKey {
  return typeof v === 'string' && (PALETTE_KEYS as readonly string[]).includes(v)
}

/** The class that sets --sc-fill / --sc-border / --sc-text for a key (or none). */
export function swatchClass(key: string | null | undefined): string {
  return isPaletteKey(key) ? `sc-c-${key}` : 'sc-c-none'
}

const vars = (s: Swatch) => `--sc-fill:${s.fill};--sc-border:${s.border};--sc-text:${s.text};`

/**
 * The palette as CSS, with the same dark-scheme selectors as tokens.css (the OS
 * preference unless the page pins light, and an explicit dark theme).
 */
export function paletteCss(): string {
  const light = PALETTE_KEYS.map((k) => `.sc-c-${k}{${vars(PALETTE[k].light)}}`).join('')
  const darkOs = PALETTE_KEYS.map((k) => `:root:not([data-theme='light']) .sc-c-${k}{${vars(PALETTE[k].dark)}}`).join('')
  const darkPinned = PALETTE_KEYS.map((k) => `:root[data-theme='dark'] .sc-c-${k}{${vars(PALETTE[k].dark)}}`).join('')
  return `${light}@media (prefers-color-scheme: dark){${darkOs}}${darkPinned}`
}

/** Mounted once by the pages that show supervisor colors. */
export function PaletteStyle() {
  return <style data-pd38-palette="">{paletteCss()}</style>
}

/** WCAG 2.1 contrast ratio of two #rrggbb colors. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
