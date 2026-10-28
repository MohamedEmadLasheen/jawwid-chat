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
export const POSITIONS: readonly Position[] = ['start', 'middle', 'end'];

/** A unit's letters. One entry is one letter, or a sequence matched as a pair (لا). */
export interface LetterUnit {
  letters: readonly string[];
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

/** One written word: letters and marks only, starting with a letter. */
export function isWord(word: string): boolean {
  const chars = [...word];
  return chars.length > 0 && isLetter(chars[0]!) && chars.every((ch) => isLetter(ch) || isMark(ch));
}

/** A word's letters, in order: every mark removed, no letter ever replaced. */
export function lettersOf(word: string): string[] {
  return [...word].filter(isLetter);
}

/** Where each of the unit's letters (or pairs) occurs in the word's letters. */
function occurrences(word: string, unit: LetterUnit): { at: number; length: number }[] {
  const ls = lettersOf(word);
  const out: { at: number; length: number }[] = [];
  for (const entry of unit.letters) {
    const seq = [...entry];
    for (let i = 0; i + seq.length <= ls.length; i++) {
      if (seq.every((ch, k) => ls[i + k] === ch)) out.push({ at: i, length: seq.length });
    }
  }
  return out.sort((a, b) => a.at - b.at);
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

/**
 * The word as tappable pieces: each letter with its own marks, and a pair (لا)
 * as one piece. `target` marks the pieces that are the unit's letter.
 */
export function clusters(word: string, unit: LetterUnit): { text: string; target: boolean }[] {
  const pieces: string[] = [];
  for (const ch of word) {
    if (isLetter(ch) || pieces.length === 0) pieces.push(ch);
    else pieces[pieces.length - 1] += ch;
  }
  const hits = occurrences(word, unit);
  const out: { text: string; target: boolean }[] = [];
  for (let i = 0; i < pieces.length; ) {
    const hit = hits.find((h) => h.at === i);
    const length = hit ? hit.length : 1;
    out.push({ text: pieces.slice(i, i + length).join(''), target: !!hit });
    i += length;
  }
  return out;
}
