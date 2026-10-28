import pin from '../../quran-pin.json';
import type { Surah } from '../quran/dataset';

/**
 * A lesson's reviewed content (PD-29 P0-4): prose -- tafsir lines, word
 * meanings, quiz questions, lessons learned -- plus POSITIONS into the verified
 * text. The Quran itself is never in it: a quiz option or a game word is
 * {ayah} or {ayah, word}, and the words shown are cut from the verified verse.
 *
 * Resolution FAILS CLOSED: if any position does not exist in the verified
 * surah, the whole content is refused and the lesson shows the Quran sections
 * only. A line flagged for teacher review (`review` set) is held back, never
 * shown. scripts/lessons/check-lesson-content.py checks the same file against
 * the real dataset in CI, and also refuses typed Quran in the prose.
 */
export type Review = string | null;
export type AyahRef = { ayah: number };
export type WordRef = { ayah: number; word: number };
export type Option = { text: string } | AyahRef | WordRef;

export interface QuizItem {
  id: string;
  category: 'hifz' | 'meanings' | 'lessons';
  question: string;
  /** Shows the first `words` words of the ayah, then a gap. */
  prompt?: { ayah: number; words: number };
  /** The word the question is about. */
  word?: WordRef;
  options: Option[];
  answer: number;
  review: Review;
}

export interface LessonContent {
  surah: number;
  datasetId: string;
  review: { status: 'pending' | 'approved'; by: string | null; note: string };
  provenance: unknown;
  intro: { text: string; review: Review };
  tafsir: { ayah: number; text: string | null; review: Review }[];
  words: (WordRef & { meaning: string; review: Review })[];
  complete: WordRef[];
  quiz: QuizItem[];
  lessons: { text: string; review: Review }[];
  reflection: { question: string; ideas: string[]; review: Review };
  didYouKnow: { text: string; review: Review }[];
}

export interface ResolvedQuiz {
  id: string;
  question: string;
  prompt: string | null;
  word: string | null;
  options: string[];
  answer: number;
}

export interface ResolvedContent {
  intro: string | null;
  tafsir: Map<number, string>;
  words: { ayah: number; text: string; meaning: string }[];
  complete: (WordRef & { text: string })[];
  quiz: ResolvedQuiz[];
  lessons: string[];
  reflection: { question: string; ideas: string[] } | null;
  didYouKnow: string[];
  /** Lines held back for teacher review. */
  held: number;
  approved: boolean;
}

const LETTER = new RegExp('[' + String.fromCodePoint(0x621) + '-' + String.fromCodePoint(0x64a) + String.fromCodePoint(0x671) + ']');

/** The words of a verse: its space-separated tokens that hold a letter (a pause mark alone is not a word). */
export function wordsOf(verse: string): string[] {
  return verse.split(' ').filter((t) => LETTER.test(t));
}

class Unresolved extends Error {}

function isContent(x: unknown): x is LessonContent {
  const c = x as LessonContent;
  return !!c && typeof c === 'object' && [c.tafsir, c.words, c.complete, c.quiz, c.lessons, c.didYouKnow].every(Array.isArray)
    && !!c.intro && !!c.reflection && !!c.review;
}

export function resolveContent(content: unknown, surah: Surah): ResolvedContent | null {
  if (!isContent(content)) return null;
  if (content.surah !== surah.info.number || content.datasetId !== pin.datasetId) return null;
  const verses = surah.ayahs.map((a) => a.text);
  const words = verses.map(wordsOf);
  const verse = (r: AyahRef): string => {
    const v = verses[r.ayah - 1];
    if (!Number.isInteger(r.ayah) || v === undefined) throw new Unresolved();
    return v;
  };
  const word = (r: WordRef): string => {
    const w = words[r.ayah - 1]?.[r.word - 1];
    if (!Number.isInteger(r.ayah) || !Number.isInteger(r.word) || r.word < 1 || w === undefined) throw new Unresolved();
    return w;
  };
  const option = (o: Option): string => ('text' in o ? o.text : 'word' in o ? word(o) : verse(o));
  let held = 0;
  const shown = <T extends { review: Review }>(item: T): boolean => {
    if (item.review) held++;
    return !item.review;
  };

  try {
    // Every position is resolved, flagged or not: one bad position refuses the file.
    for (const t of content.tafsir) verse(t);
    content.words.forEach(word);
    content.complete.forEach(word);
    const quiz: ResolvedQuiz[] = [];
    for (const q of content.quiz) {
      const options = q.options.map(option);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= options.length) throw new Unresolved();
      let prompt: string | null = null;
      if (q.prompt) {
        const ws = words[q.prompt.ayah - 1];
        if (!ws || !Number.isInteger(q.prompt.words) || q.prompt.words < 1 || q.prompt.words >= ws.length) throw new Unresolved();
        prompt = ws.slice(0, q.prompt.words).join(' ');
      }
      const about = q.word ? word(q.word) : null;
      if (shown(q)) quiz.push({ id: q.id, question: q.question, prompt, word: about, options, answer: q.answer });
    }
    return {
      intro: shown(content.intro) ? content.intro.text : null,
      tafsir: new Map(content.tafsir.filter(shown).flatMap((t) => (t.text ? [[t.ayah, t.text] as [number, string]] : []))),
      words: content.words.filter(shown).map((w) => ({ ayah: w.ayah, text: word(w), meaning: w.meaning })),
      complete: content.complete.map((c) => ({ ...c, text: word(c) })),
      quiz,
      lessons: content.lessons.filter(shown).map((l) => l.text),
      reflection: shown(content.reflection) ? { question: content.reflection.question, ideas: content.reflection.ideas } : null,
      didYouKnow: content.didYouKnow.filter(shown).map((d) => d.text),
      held,
      approved: content.review.status === 'approved' && held === 0,
    };
  } catch {
    // A bad position (Unresolved) or a malformed file (a TypeError on a missing
    // field): either way nothing of it is shown.
    return null;
  }
}
