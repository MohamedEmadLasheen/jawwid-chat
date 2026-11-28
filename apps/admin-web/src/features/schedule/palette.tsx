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
 *
 * The twelve are quiet, slightly greyed tones chosen to sit on the paper beside
 * the teal and the gold: same keys and names, measured again (and on the paper
 * itself each border is above 4:1).
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
  sky: { light: { fill: '#dde9f1', border: '#3f7193', text: '#234a66' }, dark: { fill: '#1c3242', border: '#7fb0cf', text: '#dbe9f2' }, name: { en: 'Light blue', ar: 'أزرق فاتح' } },
  red: { light: { fill: '#f3ddd6', border: '#a44a36', text: '#6c2a1d' }, dark: { fill: '#40221b', border: '#dc8f7b', text: '#f6e0d9' }, name: { en: 'Red', ar: 'أحمر' } },
  peach: { light: { fill: '#f6e4d2', border: '#a9652f', text: '#6a3b15' }, dark: { fill: '#3f2a19', border: '#dba071', text: '#f7e6d6' }, name: { en: 'Peach', ar: 'خوخي' } },
  green: { light: { fill: '#dfeadb', border: '#47774d', text: '#284a2d' }, dark: { fill: '#1d3523', border: '#86bb8c', text: '#e0ecdd' }, name: { en: 'Green', ar: 'أخضر' } },
  purple: { light: { fill: '#e8e1ef', border: '#765a99', text: '#463367' }, dark: { fill: '#2f2542', border: '#b39ad3', text: '#ebe4f2' }, name: { en: 'Purple', ar: 'بنفسجي' } },
  teal: { light: { fill: '#d9eae8', border: '#2a7371', text: '#164746' }, dark: { fill: '#163533', border: '#6fb9b5', text: '#dbecea' }, name: { en: 'Teal', ar: 'فيروزي' } },
  amber: { light: { fill: '#f6eac4', border: '#8f6a18', text: '#59400d' }, dark: { fill: '#3b2f10', border: '#d4ae55', text: '#f7ecc9' }, name: { en: 'Amber', ar: 'كهرماني' } },
  pink: { light: { fill: '#f2dfe5', border: '#a25273', text: '#682c46' }, dark: { fill: '#40212e', border: '#d993b0', text: '#f4e2e8' }, name: { en: 'Pink', ar: 'وردي' } },
  indigo: { light: { fill: '#dfe2f0', border: '#505a98', text: '#2d3565' }, dark: { fill: '#232844', border: '#9aa3d8', text: '#e2e5f2' }, name: { en: 'Indigo', ar: 'نيلي' } },
  olive: { light: { fill: '#e9ecd4', border: '#687330', text: '#3e4718' }, dark: { fill: '#2c3115', border: '#b1bb70', text: '#ebeed8' }, name: { en: 'Olive', ar: 'زيتوني' } },
  brown: { light: { fill: '#ece1d4', border: '#845f42', text: '#4c3420' }, dark: { fill: '#35281d', border: '#c59d7d', text: '#eee4d8' }, name: { en: 'Brown', ar: 'بني' } },
  slate: { light: { fill: '#e1e5e6', border: '#56656a', text: '#2c383d' }, dark: { fill: '#242d31', border: '#9eb0b6', text: '#e3e7e8' }, name: { en: 'Slate', ar: 'رمادي' } },
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
