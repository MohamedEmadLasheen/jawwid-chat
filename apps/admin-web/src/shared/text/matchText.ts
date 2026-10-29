/**
 * Search matching that forgives how a name was typed. Staff type Arabic names
 * with or without harakat, with any of the alef forms, and with ى/ي and ة/ه
 * used interchangeably; Latin names in any case and with or without accents.
 * Both sides are folded the same way, so "احمد" finds "أحمد" and "fatma"
 * finds "Fâtma".
 *
 * Code points are built with fromCharCode rather than written as escapes or
 * literals: tashkeel is invisible in an editor, and an escape is easy to mangle.
 */
const ch = (code: number) => String.fromCharCode(code)

const TATWEEL = new RegExp(ch(0x0640), 'g')
const FOLDS: Array<[RegExp, string]> = [
  // ٱ (wasla) has no decomposition; أ إ آ lose their hamza and madda as marks.
  [new RegExp(ch(0x0671), 'g'), ch(0x0627)],
  // ى (alef maqsura) and the Persian ی read as ي.
  [new RegExp(`[${ch(0x0649)}${ch(0x06cc)}]`, 'g'), ch(0x064a)],
  // ة reads as ه.
  [new RegExp(ch(0x0629), 'g'), ch(0x0647)],
]
// Arabic-Indic and extended Arabic-Indic digits, so a typed ١٢ finds 12.
const DIGITS = new RegExp(`[${ch(0x0660)}-${ch(0x0669)}${ch(0x06f0)}-${ch(0x06f9)}]`, 'g')

/** Folds a string for comparison: no marks, one alef, ي for ى, ه for ة, lower case. */
export function foldForSearch(text: string): string {
  let out = text.normalize('NFKD').replace(/\p{M}/gu, '').replace(TATWEEL, '')
  for (const [from, to] of FOLDS) out = out.replace(from, to)
  out = out.replace(DIGITS, (d) => String(d.charCodeAt(0) & 0xf))
  return out.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * True when every word of the query appears somewhere in one of the texts, in
 * any order: "ali ahmed" finds "Ahmed Ali", and an e-mail or a role counts as
 * well as the name. An empty query matches everything.
 */
export function matchesQuery(query: string, ...texts: Array<string | null | undefined>): boolean {
  const words = foldForSearch(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const haystack = foldForSearch(texts.filter(Boolean).join(' '))
  return words.every((w) => haystack.includes(w))
}
