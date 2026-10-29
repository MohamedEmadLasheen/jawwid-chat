/**
 * `m:ss`, or `h:mm:ss` past an hour.
 *
 * Durations are an LTR run in both locales, so this returns a bare string and
 * the element that renders it sets `dir="ltr"` — never concatenated into a
 * sentence, because Arabic word order differs.
 */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const whole = Math.floor(seconds)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const ss = String(s).padStart(2, '0')
  return h === 0 ? `${m}:${ss}` : `${h}:${String(m).padStart(2, '0')}:${ss}`
}
