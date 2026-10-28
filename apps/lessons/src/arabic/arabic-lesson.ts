import type { ResolvedQuiz } from '../content/lesson-content';
import { POSITIONS, has, isLetter, isWord, positions, type Position } from './letters';
import { POSITION_LABEL, askContains, askPosition } from './ui-text';

/**
 * An Arabic letters lesson (PD-29 P0-5): units (a letter, the hamza with its
 * five seats, لا), their forms, a note, and example words; plus a fixed quiz.
 * Nothing derivable is stored: a word carries no "start/middle/end" label and
 * no letter tag; both come from letters.ts. Every reading string (a unit's
 * name, a note, a word) has a stable id, unique in the lesson and never reused,
 * so a voice-over clip can bind to (id, SHA-256 of the text).
 *
 * Resolution FAILS CLOSED, as for the Quran lessons: a word that does not
 * contain its unit's letter, a quiz question without exactly one right answer,
 * or a malformed file refuses the whole lesson. A flagged word, note or
 * question (`review` set) is held back, and so is any question that shows a
 * flagged word. Nothing at all is shown until the Teachers department approved
 * the file. scripts/lessons/check-arabic-lesson.py proves the same in CI and
 * also enforces full tashkeel with the one final mark (pausal sukun).
 */
export type Review = string | null;

export interface ArabicWord {
  /** Stable, never reused: a voice-over clip binds to (id, text hash). */
  id: string;
  text: string;
  /** The old lesson's spelling, when the rebuild changed it (added marks): held until a teacher clears it. */
  was: string | null;
  review: Review;
  finalMarkException?: string;
}

export interface ArabicUnit {
  /** Stable, never reused; it also names the unit's name string. */
  id: string;
  letters: string[];
  name: string;
  forms: string[];
  note: { id: string; text: string; review: Review } | null;
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
  units: ArabicUnit[];
  quiz: ArabicQuizItem[];
}

export interface ResolvedUnit {
  id: string;
  letters: string[];
  name: string;
  forms: string[];
  note: { id: string; text: string } | null;
  words: { id: string; text: string; positions: Position[] }[];
}

export interface ResolvedArabicLesson {
  units: ResolvedUnit[];
  quiz: ResolvedQuiz[];
  held: number;
  approved: boolean;
}

class Refused extends Error {}

/** A reading string's id: a lowercase slug (ba-w1, alif-note). */
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function check(ok: boolean): asserts ok {
  if (!ok) throw new Refused();
}

function isLesson(x: unknown): x is ArabicLesson {
  const c = x as ArabicLesson;
  return !!c && typeof c === 'object' && Array.isArray(c.units) && Array.isArray(c.quiz) && !!c.review;
}

export function resolveArabicLesson(raw: unknown, lesson: number): ResolvedArabicLesson | null {
  if (!isLesson(raw) || raw.lesson !== lesson || raw.finalMark !== 'sukun') return null;
  let held = 0;
  const shown = (item: { review: Review }): boolean => {
    if (item.review) held++;
    return !item.review;
  };
  try {
    const byId = new Map<string, ArabicUnit>();
    // One namespace for every reading string's id: units, notes, words.
    const ids = new Set<string>();
    const fresh = (id: unknown) => {
      check(typeof id === 'string' && ID.test(id) && !ids.has(id));
      ids.add(id as string);
    };
    // Every word of the lesson, and whether a teacher has cleared it.
    const vocabulary = new Map<string, boolean>();
    for (const u of raw.units) {
      fresh(u.id);
      check(Array.isArray(u.letters) && u.letters.length > 0 && u.letters.every((l) => typeof l === 'string' && [...l].length > 0 && [...l].every(isLetter)));
      check(typeof u.name === 'string' && isWord(u.name));
      check(Array.isArray(u.forms) && u.forms.every((f) => typeof f === 'string' && f.length > 0));
      if (u.note) fresh(u.note.id);
      byId.set(u.id, u);
      for (const w of u.words) {
        fresh(w.id);
        check(typeof w.text === 'string' && isWord(w.text) && has(w.text, u));
        vocabulary.set(w.text, (vocabulary.get(w.text) ?? true) && !w.review);
      }
    }
    const cleared = (word: string) => vocabulary.get(word) === true;

    const quiz: ResolvedQuiz[] = [];
    const quizIds = new Set<string>();
    for (const q of raw.quiz) {
      check(typeof q.id === 'string' && !!q.id && !quizIds.has(q.id));
      quizIds.add(q.id);
      const unit = byId.get(q.unit);
      check(!!unit);
      let item: ResolvedQuiz;
      if (q.kind === 'contains') {
        check(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 4 && new Set(q.options).size === q.options.length);
        check(q.options.every((o) => vocabulary.has(o)));
        const right = q.options.flatMap((o, i) => (has(o, unit) ? [i] : []));
        check(right.length === 1 && right[0] === q.answer); // exactly one right answer, and it is the answer
        item = { id: q.id, question: askContains(unit.name), prompt: null, word: null, options: q.options, answer: q.answer };
        if (!q.options.every(cleared)) {
          held++;
          continue;
        }
      } else if (q.kind === 'position') {
        check(vocabulary.has(q.word) && POSITIONS.includes(q.answer));
        const at = positions(q.word, unit);
        check(at.length === 1 && at[0] === q.answer); // the letter is in exactly one place
        item = { id: q.id, question: askPosition(unit.name), prompt: null, word: q.word, options: POSITIONS.map((p) => POSITION_LABEL[p]), answer: POSITIONS.indexOf(q.answer) };
        if (!cleared(q.word)) {
          held++;
          continue;
        }
      } else {
        throw new Refused();
      }
      if (shown(q)) quiz.push(item);
    }

    const units: ResolvedUnit[] = raw.units.map((u) => ({
      id: u.id,
      letters: u.letters,
      name: u.name,
      forms: u.forms,
      note: u.note && shown(u.note) ? { id: u.note.id, text: u.note.text } : null,
      words: u.words.filter(shown).map((w) => ({ id: w.id, text: w.text, positions: positions(w.text, u) })),
    }));
    return { units, quiz, held, approved: raw.review.status === 'approved' };
  } catch {
    // A failed proof (Refused) or a malformed file (a TypeError): nothing of it is shown.
    return null;
  }
}
