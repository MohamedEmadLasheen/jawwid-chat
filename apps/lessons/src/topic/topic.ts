import type { ResolvedQuiz } from '../content/lesson-content';
import { WORD_ID } from '../arabic/arabic-lesson';

/**
 * A topic lesson (PD-29, the Islamic Studies lessons; plan in pd029-materials-quality-plan.md and the
 * owner's decisions of 2026-10-29): sections of prose, Quran BY REFERENCE ONLY ({surah, from, to},
 * drawn from the verified dataset, never typed), and hadith -- every hadith HELD, never shown, until a
 * verified hadith source is approved (HadeethEnc, pending IslamHouse's written confirmation).
 *
 * Resolution FAILS CLOSED: a malformed block, an id out of place, a quiz question without exactly one
 * answer, or a malformed file refuses the whole lesson. A held line (`review` set) is never shown, and
 * nothing at all is shown until the Teachers department (and, for fiqh, a qualified scholar) approved the
 * file. scripts/lessons/check-arabic-lesson.py proves the same in CI, and also refuses typed Quran in the
 * prose (rasm.py, the whole Quran), a reference to an ayah the verified text does not have, and a
 * madhhab name in child-facing text (owner, 2026-10-29).
 */
export type Review = string | null;

export type TopicBlock =
  | { id: string; kind: 'text'; text: string; review: Review }
  | { id: string; kind: 'quran'; surah: number; from: number; to: number; review: Review }
  | { id: string; kind: 'hadith'; source: string; text: string; review: Review };

export interface TopicSection {
  /** A lowercase slug; its blocks are `<section>-NNN`. */
  id: string;
  title: { text: string; review: Review };
  blocks: TopicBlock[];
}

export type TopicQuizItem =
  | { id: string; kind: 'choose'; question: string; options: string[]; answer: number; review: Review }
  | { id: string; kind: 'truefalse'; statement: string; answer: boolean; review: Review };

export interface TopicLesson {
  lesson: number;
  kind: 'topic';
  title: { text: string; review: Review };
  review: { status: 'pending' | 'approved'; by: string | null; note: string };
  provenance: unknown;
  retiredIds: string[];
  sections: TopicSection[];
  quiz: TopicQuizItem[];
}

export type ShownBlock = { id: string; kind: 'text'; text: string } | { id: string; kind: 'quran'; surah: number; from: number; to: number };

export interface ResolvedTopic {
  title: string | null;
  sections: { id: string; title: string | null; blocks: ShownBlock[] }[];
  quiz: ResolvedQuiz[];
  held: number;
  approved: boolean;
}

export const SECTION_ID = /^[a-z][a-z0-9_]*$/;
export const TRUE_FALSE = ['صَحِيحٌ', 'خَطَأٌ'] as const;

class Refused extends Error {}
function check(ok: boolean): asserts ok {
  if (!ok) throw new Refused();
}
const isReview = (r: unknown): r is Review => r === null || (typeof r === 'string' && r.trim().length > 0);
const isText = (t: unknown): t is string => typeof t === 'string' && t.trim().length > 0 && t === t.normalize('NFC');
const isAyah = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;

export function isTopicLesson(x: unknown): x is TopicLesson {
  const c = x as TopicLesson;
  return !!c && typeof c === 'object' && c.kind === 'topic' && Array.isArray(c.sections) && Array.isArray(c.quiz) && Array.isArray(c.retiredIds) && !!c.review;
}

export function resolveTopicLesson(raw: unknown, lesson: number): ResolvedTopic | null {
  if (!isTopicLesson(raw) || raw.lesson !== lesson) return null;
  const approved = raw.review.status === 'approved';
  let held = 0;
  const shown = (r: Review) => {
    if (r) held++;
    return !r;
  };
  try {
    check(raw.retiredIds.every((id) => typeof id === 'string' && WORD_ID.test(id)));
    const retired = new Set(raw.retiredIds);
    check(!!raw.title && isText(raw.title.text) && isReview(raw.title.review));
    const ids = new Set<string>();
    const sectionIds = new Set<string>();
    const sections: ResolvedTopic['sections'] = [];
    for (const s of raw.sections) {
      check(typeof s.id === 'string' && SECTION_ID.test(s.id) && !sectionIds.has(s.id));
      sectionIds.add(s.id);
      check(!!s.title && isText(s.title.text) && isReview(s.title.review) && Array.isArray(s.blocks));
      const blocks: ShownBlock[] = [];
      for (const b of s.blocks) {
        check(typeof b.id === 'string' && WORD_ID.test(b.id) && b.id.slice(0, -4) === s.id && !ids.has(b.id) && !retired.has(b.id));
        ids.add(b.id);
        check(isReview(b.review));
        if (b.kind === 'text') {
          check(isText(b.text));
          if (shown(b.review)) blocks.push({ id: b.id, kind: 'text', text: b.text });
        } else if (b.kind === 'quran') {
          // The verse itself comes from the verified dataset when the page draws it; here, a reference.
          check(isAyah(b.surah) && b.surah <= 114 && isAyah(b.from) && isAyah(b.to) && b.from <= b.to);
          if (shown(b.review)) blocks.push({ id: b.id, kind: 'quran', surah: b.surah, from: b.from, to: b.to });
        } else if (b.kind === 'hadith') {
          // Every hadith stays held until a verified hadith source is approved: never shown, whatever its review.
          check(isText(b.source) && isText(b.text) && !!b.review);
          held++;
        } else {
          throw new Refused();
        }
      }
      sections.push({ id: s.id, title: shown(s.title.review) ? s.title.text : null, blocks });
    }

    const quiz: ResolvedQuiz[] = [];
    const quizIds = new Set<string>();
    for (const q of raw.quiz) {
      check(typeof q.id === 'string' && !!q.id && !quizIds.has(q.id) && isReview(q.review));
      quizIds.add(q.id);
      let item: ResolvedQuiz;
      if (q.kind === 'choose') {
        check(isText(q.question) && Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 4 && q.options.every(isText));
        check(new Set(q.options).size === q.options.length && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
        item = { id: q.id, question: q.question, prompt: null, word: null, options: q.options, answer: q.answer };
      } else if (q.kind === 'truefalse') {
        check(isText(q.statement) && typeof q.answer === 'boolean');
        item = { id: q.id, question: q.statement, prompt: null, word: null, options: [...TRUE_FALSE], answer: q.answer ? 0 : 1 };
      } else {
        throw new Refused();
      }
      if (shown(q.review)) quiz.push(item);
    }
    return { title: shown(raw.title.review) ? raw.title.text : null, sections, quiz, held, approved };
  } catch {
    return null;
  }
}
