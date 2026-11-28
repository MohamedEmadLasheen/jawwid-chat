/**
 * Arabic-friendly matching for the search palette, done on the client.
 *
 * Folds the spellings people type interchangeably: alef forms, taa marbuta and
 * haa, alef maqsura and yaa, tashkeel and tatweel, Arabic-Indic and Western
 * digits, and letter case. Nothing here is sent anywhere; it only decides
 * whether text already on the page matches.
 */
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g

export function foldChar(ch: string): string {
  const code = ch.charCodeAt(0)
  // Arabic-Indic and Extended Arabic-Indic digits.
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660)
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0)
  switch (ch) {
    case 'أ':
    case 'إ':
    case 'آ':
    case 'ٱ':
      return 'ا'
    case 'ة':
      return 'ه'
    case 'ى':
      return 'ي'
    case 'ؤ':
      return 'و'
    case 'ئ':
      return 'ي'
    default:
      return ch.toLocaleLowerCase()
  }
}

export function normalize(text: string): string {
  let out = ''
  for (const ch of text.replace(TASHKEEL, '')) out += foldChar(ch)
  return out.replace(/\s+/g, ' ').trim()
}

/** Digits only, in Western form: how a phone number is compared. */
export function digitsOf(text: string): string {
  return normalize(text).replace(/\D/g, '')
}

/** A query that is only a number (spaces, +, - and brackets aside) is matched by its digits. */
export function isNumeric(query: string): boolean {
  const n = normalize(query)
  return n.length > 0 && /^[\d\s+\-()]+$/.test(n)
}

export interface Match {
  /** Offsets into the ORIGINAL text, for highlighting. */
  start: number
  end: number
}

/**
 * Where `query` occurs in `text` after folding, as offsets into the original
 * text; null when it does not. Every word of the query must occur; the first
 * word's position is the one highlighted.
 */
export function findMatch(text: string, query: string): Match | null {
  const q = normalize(query)
  if (!q) return null
  // Fold the text one original character at a time so offsets map back.
  const folded: string[] = []
  const origin: number[] = []
  let i = 0
  for (const ch of text) {
    if (!TASHKEEL.test(ch)) {
      folded.push(foldChar(ch))
      origin.push(i)
    }
    TASHKEEL.lastIndex = 0
    i += ch.length
  }
  const hay = folded.join('')
  if (isNumeric(query)) {
    const d = q.replace(/\D/g, '')
    if (!d) return null
    // Compare digit runs, ignoring separators in the text.
    const digitIdx: number[] = []
    let digits = ''
    folded.forEach((c, k) => {
      if (/\d/.test(c)) {
        digits += c
        digitIdx.push(k)
      }
    })
    const at = digits.indexOf(d)
    if (at === -1) return null
    const s = origin[digitIdx[at]!]!
    const e = origin[digitIdx[at + d.length - 1]!]! + 1
    return { start: s, end: e }
  }
  const words = q.split(' ')
  let first: Match | null = null
  for (const w of words) {
    const at = hay.indexOf(w)
    if (at === -1) return null
    if (!first) {
      const last = at + w.length - 1
      first = { start: origin[at]!, end: origin[last]! + Array.from(text.slice(origin[last]!))[0]!.length }
    }
  }
  // The whole phrase, when it occurs as typed, is the better highlight.
  const whole = hay.indexOf(q)
  if (whole !== -1) {
    const last = whole + q.length - 1
    return { start: origin[whole]!, end: origin[last]! + Array.from(text.slice(origin[last]!))[0]!.length }
  }
  return first
}
