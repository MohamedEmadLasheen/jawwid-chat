/**
 * LD-12 / MG-3: the form text is compared in. The filter's list and the text
 * under test go through the SAME function, so a listed word written with vowel
 * marks, a stretched letter or a digit for a letter still meets itself.
 *
 * Arabic: diacritics, Quranic annotation marks and tatweel are removed; alef,
 * ya and ta marbuta variants are unified. English: case-folded, and inside a
 * word that has Latin letters the common look-alike digits and symbols are
 * read as letters. Then any run of one repeated character becomes one.
 *
 * Only for matching: nothing here is ever stored or shown.
 */

/** Harakat, Quranic annotation and extended Arabic combining marks, superscript alef. */
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]/g;
const TATWEEL = /ـ/g;
/** Zero-width and direction controls: they would split a word without being seen. */
const INVISIBLE = /[­͏؜​-‏‪-‮⁠-⁤﻿]/g;
/** أ إ آ ٱ ٲ ٳ ٵ -> ا */
const ALEF_VARIANTS = /[آأإٱٲٳٵ]/g;
/** ى (alef maksura) and ی (Farsi yeh) -> ي */
const YA_VARIANTS = /[ىی]/g;
/** ة and ۃ -> ه */
const TA_MARBUTA = /[ةۃ]/g;

/** A word: letters, digits, and the two symbols commonly typed for letters. */
const WORD = /[\p{L}\p{N}@$]+/gu;
const LATIN = /[a-z]/;
const LOOK_ALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};
const REPEATS = /(.)\1+/gu;

/** The text as the filter compares it: one string per word, in order. */
export function matchTokens(text: string): string[] {
  const folded = text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(ARABIC_MARKS, '')
    .replace(TATWEEL, '')
    .replace(ALEF_VARIANTS, 'ا')
    .replace(YA_VARIANTS, 'ي')
    .replace(TA_MARBUTA, 'ه')
    .toLowerCase();
  const out: string[] = [];
  for (const [raw] of folded.matchAll(WORD)) {
    const word = LATIN.test(raw) ? raw.replace(/[013457@$]/g, (c) => LOOK_ALIKES[c]) : raw;
    const collapsed = word.replace(REPEATS, '$1');
    if (/[\p{L}\p{N}]/u.test(collapsed)) out.push(collapsed);
  }
  return out;
}
