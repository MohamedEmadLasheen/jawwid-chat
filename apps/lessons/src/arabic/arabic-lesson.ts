import type { ResolvedQuiz } from '../content/lesson-content';
import { HARAKA, MADD, POSITIONS, TANWEEN, has, isLetter, isPhrase, isWord, positions, sukunOnMadd, uncountedMadd, type Haraka, type LetterUnit, type Madd, type Position, type Tanween } from './letters';
import { POSITION_LABEL, askContains, askPosition } from './ui-text';

/**
 * An Arabic letters lesson (PD-29 P0-5): units (a letter, the hamza with its
 * five seats, لا), their forms, a note, and example words; plus a fixed quiz.
 * Nothing derivable is stored: a word carries no "start/middle/end" label and
 * no letter tag; both come from letters.ts.
 *
 * STABLE IDS, for voice-over (PD-48): a word's id is `<unit id>-NNN`, assigned
 * once and never renumbered; a removed word's id goes to `retiredIds` and is
 * never reused. A unit's name and note have derived ids, `<unit id>.name` and
 * `<unit id>.note`. A clip also binds to the SHA-256 of the exact text, so a
 * changed text simply has no audio.
 *
 * Resolution FAILS CLOSED, as for the Quran lessons: a word that does not
 * contain its unit's letter, a quiz question without exactly one right answer,
 * or a malformed file refuses the whole lesson. A flagged word, note or
 * question (`review` set) is held back; a spelling flagged anywhere is held
 * everywhere, and so is any question that shows it. Nothing at all is shown
 * until the Teachers department approved the file.
 * scripts/lessons/check-arabic-lesson.py proves the same in CI and also
 * enforces full tashkeel with the one final mark (pausal sukun).
 */
export type Review = string | null;

export interface ArabicWord {
  /** `<unit id>-NNN`: stable, never renumbered or reused (a voice-over clip binds to it). */
  id: string;
  text: string;
  /** The old lesson's spelling, when the rebuild changed it (added marks): held until a teacher clears it. */
  was: string | null;
  review: Review;
  /** Keeps a final mark other than the pausal sukun; the word stays held until the file is approved. */
  finalMarkException?: string;
}

export interface ArabicUnit {
  /** A lowercase slug (ba, lam_alif); its name and note strings are `<id>.name` and `<id>.note`. */
  id: string;
  letters: string[];
  /**
   * Lesson 3 (the harakat): the unit is the letter CARRYING this mark, and its name
   * is that syllable (بَ). Its words are the ones where the letter carries it.
   * Lesson 6: `sukun`, which never counts on a word's last letter (the pausal sukun).
   */
  mark?: Haraka;
  /** Lesson 7 (the madd): the unit is this madd letter, bare after its own vowel (ـَا ـِي ـُو). */
  madd?: Madd;
  /** Lesson 8: the unit is a word ENDING in this tanween, whatever its letter; `letters` is empty. */
  tanween?: Tanween;
  /** The picker's first row: units of one group (the letter) sit under it. */
  group?: string;
  name: string;
  forms: string[];
  note: { text: string; review: Review } | null;
  words: ArabicWord[];
}

export type ArabicQuizItem =
  | { id: string; kind: 'contains'; unit: string; options: string[]; answer: number; review: Review }
  | { id: string; kind: 'position'; unit: string; word: string; answer: Position; review: Review };

export interface ArabicLesson {
  lesson: number;
  review: { status: 'pending' | 'approved'; by: string | null; note: string };
  provenance: unknown;
  finalMark: 'sukun';
  /** Ids of removed words: never used again. */
  retiredIds: string[];
  /**
   * Lesson 6 (one unit): words that are only ever WRONG quiz options, ids `distractor-NNN`. They are
   * checked and held like any word and join the vocabulary, but belong to no unit and are never shown
   * as examples.
   */
  distractors?: ArabicWord[];
  units: ArabicUnit[];
  quiz: ArabicQuizItem[];
}

export interface ResolvedUnit extends LetterUnit {
  id: string;
  letters: string[];
  /** The mark's code point, so the unit IS the letter rule (letters.ts). */
  mark?: string;
  /** A madd unit's vowel (its code point): the letter counts only bare after it. */
  after?: string;
  /** A tanween unit's tanween (its code point). */
  tanween?: string;
  group?: string;
  name: string;
  forms: string[];
  note: { id: string; text: string } | null;
  words: { id: string; text: string; positions: Position[] }[];
}

/** A question, and the unit it asks about: the quiz runs one unit at a time, as the old lesson's did. */
export type ResolvedArabicQuiz = ResolvedQuiz & { unit: string };

export interface ResolvedArabicLesson {
  units: ResolvedUnit[];
  quiz: ResolvedArabicQuiz[];
  held: number;
  approved: boolean;
}

export const UNIT_ID = /^[a-z][a-z0-9_]*$/;
export const WORD_ID = /^[a-z][a-z0-9_]*-[0-9]{3}$/;

class Refused extends Error {}

/** The unit as the one letter rule sees it: its letters, and its mark if it has one. */
function ruleOf(u: ArabicUnit): LetterUnit {
  if (u.tanween !== undefined) return { letters: [], tanween: TANWEEN[u.tanween] };
  if (u.madd !== undefined) return { letters: u.letters, after: MADD[u.madd].after };
  return u.mark === undefined ? { letters: u.letters } : { letters: u.letters, mark: HARAKA[u.mark] };
}

function check(ok: boolean): asserts ok {
  if (!ok) throw new Refused();
}

const isReview = (r: unknown): r is Review => r === null || (typeof r === 'string' && r.trim().length > 0);

function isLesson(x: unknown): x is ArabicLesson {
  const c = x as ArabicLesson;
  return !!c && typeof c === 'object' && Array.isArray(c.units) && Array.isArray(c.quiz) && Array.isArray(c.retiredIds) && !!c.review;
}

export function resolveArabicLesson(raw: unknown, lesson: number): ResolvedArabicLesson | null {
  if (!isLesson(raw) || raw.lesson !== lesson || raw.finalMark !== 'sukun') return null;
  const approved = raw.review.status === 'approved';
  let held = 0;
  const shown = (item: { review: Review }): boolean => {
    if (item.review) held++;
    return !item.review;
  };
  try {
    check(raw.retiredIds.every((id) => typeof id === 'string' && WORD_ID.test(id)));
    const retired = new Set(raw.retiredIds);
    const byId = new Map<string, ArabicUnit>();
    const wordIds = new Set<string>();
    // Every spelling of the lesson; a spelling flagged in ANY entry is held everywhere.
    const vocabulary = new Set<string>();
    const flagged = new Set<string>();
    for (const u of raw.units) {
      check(typeof u.id === 'string' && UNIT_ID.test(u.id) && !byId.has(u.id));
      if (u.tanween !== undefined) {
        // A tanween unit counts the word's end: no letters, no mark, no madd.
        check(typeof u.tanween === 'string' && Object.hasOwn(TANWEEN, u.tanween) && Array.isArray(u.letters) && u.letters.length === 0 && u.mark === undefined && u.madd === undefined);
      } else {
        check(Array.isArray(u.letters) && u.letters.length > 0 && u.letters.every((l) => typeof l === 'string' && [...l].length > 0 && [...l].every(isLetter)));
      }
      check(typeof u.name === 'string' && isPhrase(u.name));
      if (u.mark !== undefined) {
        // A marked unit is single letters with one mark; its name is exactly that syllable (بَ) --
        // except a unit over the whole alphabet (lesson 6's one sukun unit), named like any unit.
        check(typeof u.mark === 'string' && Object.hasOwn(HARAKA, u.mark) && u.letters.every((l) => [...l].length === 1));
        check(u.letters.length > 5 || u.letters.some((l) => u.name === l + HARAKA[u.mark!]));
      }
      if (u.madd !== undefined) {
        // A madd unit is exactly its madd letter, and never also marked.
        check(typeof u.madd === 'string' && Object.hasOwn(MADD, u.madd) && u.mark === undefined && u.letters.length === 1 && u.letters[0] === MADD[u.madd].letter);
      }
      check(u.group === undefined || (typeof u.group === 'string' && u.group.length > 0 && u.group.length <= 8));
      check(Array.isArray(u.forms) && u.forms.every((f) => typeof f === 'string' && f.length > 0));
      check(u.note === null || (typeof u.note === 'object' && typeof u.note.text === 'string' && u.note.text.trim().length > 0 && isReview(u.note.review)));
      check(Array.isArray(u.words));
      byId.set(u.id, u);
      for (const w of u.words) {
        check(typeof w.id === 'string' && WORD_ID.test(w.id) && w.id.slice(0, -4) === u.id && !wordIds.has(w.id) && !retired.has(w.id));
        wordIds.add(w.id);
        check(typeof w.text === 'string' && isWord(w.text) && has(w.text, ruleOf(u)) && isReview(w.review));
        check(!sukunOnMadd(w.text)); // a madd letter is written bare
        check(w.was === null || typeof w.was === 'string');
        if (w.finalMarkException !== undefined) {
          check(typeof w.finalMarkException === 'string' && w.finalMarkException.trim().length > 0);
          check(approved || !!w.review); // an exception stays held until the file is approved
        }
        vocabulary.add(w.text);
        if (w.review) flagged.add(w.text);
      }
    }
    check(raw.distractors === undefined || Array.isArray(raw.distractors));
    for (const w of raw.distractors ?? []) {
      check(typeof w.id === 'string' && WORD_ID.test(w.id) && w.id.slice(0, -4) === 'distractor' && !wordIds.has(w.id) && !retired.has(w.id));
      wordIds.add(w.id);
      check(typeof w.text === 'string' && isWord(w.text) && !sukunOnMadd(w.text) && isReview(w.review));
      check(w.was === null || typeof w.was === 'string');
      if (w.finalMarkException !== undefined) check(typeof w.finalMarkException === 'string' && (approved || !!w.review));
      vocabulary.add(w.text);
      if (w.review) {
        flagged.add(w.text);
        held++;
      }
    }
    const cleared = (word: string) => vocabulary.has(word) && !flagged.has(word);

    const quiz: ResolvedArabicQuiz[] = [];
    const quizIds = new Set<string>();
    for (const q of raw.quiz) {
      check(typeof q.id === 'string' && !!q.id && !quizIds.has(q.id) && isReview(q.review));
      quizIds.add(q.id);
      const unit = byId.get(q.unit);
      check(!!unit);
      let item: ResolvedQuiz;
      let words: string[];
      if (q.kind === 'contains') {
        check(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 4 && new Set(q.options).size === q.options.length);
        check(q.options.every((o) => typeof o === 'string' && vocabulary.has(o)) && typeof q.answer === 'number');
        const right = q.options.flatMap((o, i) => (has(o, ruleOf(unit)) ? [i] : []));
        check(right.length === 1 && right[0] === q.answer); // exactly one right answer, and it is the answer
        // A madd unit's wrong option must not secretly have a madd the rule cannot see (هٰذَا، عَلَى، آ).
        if (unit.madd !== undefined) check(q.options.every((o) => !uncountedMadd(o)));
        item = { id: q.id, question: askContains(unit.name), prompt: null, word: null, options: q.options, answer: q.answer };
        words = q.options;
      } else if (q.kind === 'position') {
        check(typeof q.word === 'string' && vocabulary.has(q.word) && typeof q.answer === 'string' && POSITIONS.includes(q.answer));
        const at = positions(q.word, ruleOf(unit));
        check(at.length === 1 && at[0] === q.answer); // the letter is in exactly one place
        item = { id: q.id, question: askPosition(unit.name), prompt: null, word: q.word, options: POSITIONS.map((p) => POSITION_LABEL[p]), answer: POSITIONS.indexOf(q.answer) };
        words = [q.word];
      } else {
        throw new Refused();
      }
      if (!words.every(cleared)) {
        held++; // it would show a word still held for a teacher
        continue;
      }
      if (shown(q)) quiz.push({ ...item, unit: unit.id });
    }

    const units: ResolvedUnit[] = raw.units.map((u) => ({
      id: u.id,
      letters: u.letters,
      ...(u.mark === undefined ? {} : { mark: HARAKA[u.mark] }),
      ...(u.madd === undefined ? {} : { after: MADD[u.madd].after }),
      ...(u.tanween === undefined ? {} : { tanween: TANWEEN[u.tanween] }),
      ...(u.group === undefined ? {} : { group: u.group }),
      name: u.name,
      forms: u.forms,
      note: u.note && shown(u.note) ? { id: `${u.id}.note`, text: u.note.text } : null,
      words: u.words
        .filter((w) => {
          const ok = cleared(w.text);
          if (!ok) held++;
          return ok;
        })
        .map((w) => ({ id: w.id, text: w.text, positions: positions(w.text, ruleOf(u)) })),
    }));
    return { units, quiz, held, approved };
  } catch {
    // A failed proof (Refused) or a malformed file (a TypeError): nothing of it is shown.
    return null;
  }
}
