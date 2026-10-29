/**
 * The ONE letter rule of the Arabic lessons (PD-29 P0-5, finding #4). Every
 * game, the quiz and the examples tabs ask it, and CI asks its Python twin
 * (scripts/lessons/check-arabic-lesson.py); both run letters.fixture.json, so
 * the browser and CI cannot disagree.
 *
 * Only marks are removed (harakat, tanween, sukun, shadda, the dagger alif). A
 * letter is never replaced by another: أ إ آ ٱ ا ء are six letters, and ى is not
 * ي. The old lesson folded أ/إ/آ/ٱ into ا in its games but not in its quiz, so a
 * word "had" the letter in one place and not in the other.
 */
export type Position = 'start' | 'middle' | 'end';

/** The marks a unit may teach: the harakat (lesson 3), the sukun (lesson 6), the shadda (lesson 9). */
export type Haraka = 'fatha' | 'kasra' | 'damma' | 'sukun' | 'shadda';
export const HARAKA: Record<Haraka, string> = {
  fatha: String.fromCodePoint(0x64e),
  kasra: String.fromCodePoint(0x650),
  damma: String.fromCodePoint(0x64f),
  sukun: String.fromCodePoint(0x652),
  shadda: String.fromCodePoint(0x651),
};
const SUKUN = HARAKA.sukun;

/** Lesson 8: the three tanween, by name and code point. */
export type Tanween = 'fath' | 'damm' | 'kasr';
export const TANWEEN: Record<Tanween, string> = {
  fath: String.fromCodePoint(0x64b),
  damm: String.fromCodePoint(0x64c),
  kasr: String.fromCodePoint(0x64d),
};

/** Lesson 7 (the madd): each madd letter and the vowel it lengthens. */
export type Madd = 'alif' | 'ya' | 'waw';
export const MADD: Record<Madd, { letter: string; after: string }> = {
  alif: { letter: 'ا', after: HARAKA.fatha },
  ya: { letter: 'ي', after: HARAKA.kasra },
  waw: { letter: 'و', after: HARAKA.damma },
};
export const POSITIONS: readonly Position[] = ['start', 'middle', 'end'];

/**
 * A unit's letters. One entry is one letter, or a sequence matched as a pair (لا).
 * With a `mark` (one haraka, as its code point), a letter counts only where it
 * CARRIES that mark (lesson 3, the harakat): بَ in كَتَبَ is the last letter, not
 * the first. The sukun never counts on a word's LAST letter (lesson 6): there it
 * is the pausal sukun every word ends in, not the sukun the lesson teaches.
 * With `after` (a vowel's code point), the letter counts only where it is BARE
 * and the letter before carries that vowel (lesson 7, the madd): ا after a
 * fatha, ي after a kasra, و after a damma; بَيْتْ and يَوْمْ have no madd, and
 * neither has the silent waw of أُولَئِكَ / أُولُو (أ و ل: the و is not read).
 * With `tanween` (its code point), the word's END counts where it carries that
 * tanween (lesson 8): the last letter, or for the fath the letter before a bare
 * final ا or ى (كِتَابًا); `letters` is then empty.
 */
export interface LetterUnit {
  letters: readonly string[];
  mark?: string;
  after?: string;
  tanween?: string;
}

const TATWEEL = 0x640;

export function isMark(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (c >= 0x64b && c <= 0x652) || c === 0x670;
}

export function isLetter(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (c >= 0x621 && c <= 0x64a && c !== TATWEEL) || c === 0x671;
}

/**
 * One written word: letters and marks only, starting with a letter, in NFC
 * (marks in canonical order), so its text hash -- the voice-over binding -- is stable.
 */
export function isWord(word: string): boolean {
  const chars = [...word];
  return chars.length > 0 && word === word.normalize('NFC') && isLetter(chars[0]!) && chars.every((ch) => isLetter(ch) || isMark(ch));
}

/** A unit's name: one written word, or a short phrase of them (أَلِفٌ مَقْصُورَةْ), one space apart. */
export function isPhrase(text: string): boolean {
  return text.split(' ').every(isWord);
}

/** A word's letters, in order: every mark removed, no letter ever replaced. */
export function lettersOf(word: string): string[] {
  return [...word].filter(isLetter);
}

/** Each letter's own marks, in the order of lettersOf. */
function marksOf(word: string): string[][] {
  const out: string[][] = [];
  for (const ch of word) {
    if (isLetter(ch)) out.push([]);
    else if (isMark(ch) && out.length) out[out.length - 1]!.push(ch);
  }
  return out;
}

/** Where each of the unit's letters (or pairs) occurs in the word's letters (carrying the unit's mark, if it has one). */
function occurrences(word: string, unit: LetterUnit): { at: number; length: number }[] {
  const ls = lettersOf(word);
  if (unit.tanween) {
    const marks = marksOf(word);
    let k = ls.length - 1;
    if (k > 0 && unit.tanween === TANWEEN.fath && (ls[k] === 'ا' || ls[k] === 'ى') && marks[k]!.length === 0) k--;
    return k >= 0 && marks[k]!.includes(unit.tanween) ? [{ at: k, length: 1 }] : [];
  }
  const marks = unit.mark || unit.after ? marksOf(word) : [];
  const out: { at: number; length: number }[] = [];
  for (const entry of unit.letters) {
    const seq = [...entry];
    for (let i = 0; i + seq.length <= ls.length; i++) {
      if (!seq.every((ch, k) => ls[i + k] === ch)) continue;
      if (unit.mark && !marks[i]!.includes(unit.mark)) continue;
      if (unit.mark === SUKUN && i + seq.length === ls.length) continue;
      if (unit.after && (i === 0 || marks[i]!.length > 0 || !marks[i - 1]!.includes(unit.after))) continue;
      if (unit.after && isSilentWaw(ls, i)) continue;
      out.push({ at: i, length: seq.length });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The silent waw of أُولَئِكَ / أُولُو / أُولَاتُ: أ, then و, then ل -- written, never read. */
function isSilentWaw(ls: readonly string[], i: number): boolean {
  return i === 1 && ls[0] === 'أ' && ls[1] === 'و' && ls[2] === 'ل';
}

/**
 * A madd the madd rule does not count, though it is read long: a dagger alif
 * (هٰذَا), an alif maqsura after a fatha (عَلَى), or an alif madda (آ). A madd
 * unit's quiz refuses an option carrying one, so a "wrong" option never
 * secretly has a madd.
 */
export function uncountedMadd(word: string): boolean {
  const ls = lettersOf(word);
  const marks = marksOf(word);
  return [...word].some((ch) => ch === String.fromCodePoint(0x670)) || ls.includes('آ') || ls.some((l, i) => l === 'ى' && i > 0 && marks[i - 1]!.includes(HARAKA.fatha));
}

/** A sukun written on a madd letter (فِيْلْ): a content error, since a madd letter is written bare. With a shadda the letter is a consonant (غَنِيّْ), not a madd. */
export function sukunOnMadd(word: string): boolean {
  const ls = lettersOf(word);
  const marks = marksOf(word);
  return ls.some((l, i) => i > 0 && marks[i]!.includes(SUKUN) && !marks[i]!.includes(HARAKA.shadda) && Object.values(MADD).some((m) => m.letter === l && marks[i - 1]!.includes(m.after)));
}

export function has(word: string, unit: LetterUnit): boolean {
  return occurrences(word, unit).length > 0;
}

/** Start, middle or end: the letter's place among the word's letters, not its glyph form. */
export function positions(word: string, unit: LetterUnit): Position[] {
  const n = lettersOf(word).length;
  const found = new Set<Position>();
  for (const { at, length } of occurrences(word, unit)) {
    found.add(at === 0 ? 'start' : at + length === n ? 'end' : 'middle');
  }
  return POSITIONS.filter((p) => found.has(p));
}

/** The letters a lam joins into one glyph with (the lam-alif ligatures لا لأ لإ لآ). */
const LIGATURE_ALIFS = new Set(['ا', 'أ', 'إ', 'آ']);

/**
 * The word as tappable pieces: each letter with its own marks; a pair (لا) as
 * one piece; and a lam with the alif after it always as one piece, because
 * marking half of the lam-alif ligature breaks it on screen. `target` marks the
 * pieces that hold the unit's letter.
 */
export function clusters(word: string, unit: LetterUnit): { text: string; target: boolean }[] {
  const pieces: string[] = [];
  for (const ch of word) {
    if (isLetter(ch) || pieces.length === 0) pieces.push(ch);
    else pieces[pieces.length - 1] += ch;
  }
  const hits = occurrences(word, unit);
  const target = pieces.map((_, i) => hits.some((h) => i >= h.at && i < h.at + h.length));
  const out: { text: string; target: boolean }[] = [];
  for (let i = 0; i < pieces.length; ) {
    let j = i + 1;
    for (const h of hits) if (h.at === i) j = Math.max(j, i + h.length);
    while (j < pieces.length && pieces[j - 1]![0] === 'ل' && LIGATURE_ALIFS.has(pieces[j]![0]!)) j++;
    out.push({ text: pieces.slice(i, j).join(''), target: target.slice(i, j).some(Boolean) });
    i = j;
  }
  return out;
}
