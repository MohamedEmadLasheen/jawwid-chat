import type { ResolvedQuiz } from '../content/lesson-content';
import { HARAKA, isLetter, isMark, isWord, lettersOf } from '../arabic/letters';
import { WORD_ID } from '../arabic/arabic-lesson';

/**
 * A reading lesson (PD-29 P0-5c, pd029-p05-reading-lessons-design.md): Arabic
 * lessons 4, 5 and 10 -- vowel drills, words, sentences and passages a child
 * reads aloud. Stages hold items; a passage is an ordered list of sentence ids.
 *
 * Resolution FAILS CLOSED, as for the letter lessons: a drill that breaks its
 * stage's vowel, a sentence that is not single-spaced words, a quiz question
 * without exactly one right answer, or a malformed file refuses the whole
 * lesson. A held item (`review` set) is never shown; a spelling held anywhere is
 * held everywhere, and so is any question or passage that shows it. Nothing is
 * shown until the Teachers department approved the file.
 * scripts/lessons/check-arabic-lesson.py proves the same in CI, plus full
 * tashkeel and the typed-Quran refusal (3+ consecutive Quran words, rasm.py).
 */
export type Review = string | null;
export type ReadingKind = 'syllables' | 'word' | 'sentence';
export type StageVowel = 'fatha' | 'kasra' | 'damma';

export interface ReadingItem {
  /** `<stage id>-NNN`, stable (PD-48 binds a clip to it and to the text's hash). */
  id: string;
  kind: ReadingKind;
  text: string;
  was: string | null;
  review: Review;
}

export interface ReadingStage {
  id: string;
  name: string;
  /** Lesson 4: every letter of every drill and word in this stage carries this vowel. */
  vowel?: StageVowel;
  items: ReadingItem[];
}

export interface ReadingPassage {
  /** `passage-NNN`. */
  id: string;
  title: { text: string; review: Review };
  /** Sentence item ids, in reading order. */
  sentences: string[];
}

export type ReadingQuizItem =
  | { id: string; kind: 'vowel'; stage: string; options: string[]; answer: number; review: Review }
  | { id: string; kind: 'missing'; sentence: string; blank: number; options: string[]; answer: number; review: Review };

export interface ReadingLesson {
  lesson: number;
  kind: 'reading';
  review: { status: 'pending' | 'approved'; by: string | null; note: string };
  provenance: unknown;
  retiredIds: string[];
  stages: ReadingStage[];
  passages?: ReadingPassage[];
  /** The proper names the sentences use: a "missing" question that blanks one never offers another. */
  names?: string[];
  quiz: ReadingQuizItem[];
}

export interface ResolvedReading {
  stages: { id: string; name: string; vowel?: StageVowel; items: { id: string; kind: ReadingKind; text: string }[] }[];
  passages: { id: string; title: string; sentences: string[] }[];
  quiz: ResolvedQuiz[];
  held: number;
  approved: boolean;
}

export const STAGE_ID = /^[a-z][a-z0-9_]*$/;

const FATHATAN = String.fromCodePoint(0x64b);
/** A word's bare letters, with a tanween fath's carrier alif or alif maqsura dropped (كِتَابًا = كِتَابْ). */
export function bare(word: string): string {
  const w = word.endsWith(FATHATAN + 'ا') || word.endsWith(FATHATAN + 'ى') ? word.slice(0, -1) : word;
  return lettersOf(w).join('');
}
const PUNCTUATION = new Set(['.', '،', '؟', '!', '؛']);

/** A sentence's words, in order: single spaces only, one optional closing punctuation mark. */
export function wordsOf(sentence: string): string[] | null {
  const last = [...sentence].at(-1);
  const body = last !== undefined && PUNCTUATION.has(last) ? sentence.slice(0, -1) : sentence;
  const words = body.split(' ');
  return words.length > 0 && words.every(isWord) ? words : null;
}

/** Every letter carries this vowel (a lesson-4 drill or word of one stage): بَتَ, كَتَبَ. */
export function allCarry(text: string, vowel: StageVowel): boolean {
  const mark = HARAKA[vowel];
  const letters: string[][] = [];
  for (const ch of text) {
    if (isLetter(ch)) letters.push([]);
    else if (isMark(ch) && letters.length) letters[letters.length - 1]!.push(ch);
    else if (ch !== ' ') return false;
  }
  return letters.length > 0 && letters.every((m) => m.includes(mark));
}

class Refused extends Error {}
function check(ok: boolean): asserts ok {
  if (!ok) throw new Refused();
}
const isReview = (r: unknown): r is Review => r === null || (typeof r === 'string' && r.trim().length > 0);

export function isReadingLesson(x: unknown): x is ReadingLesson {
  const c = x as ReadingLesson;
  return !!c && typeof c === 'object' && c.kind === 'reading' && Array.isArray(c.stages) && Array.isArray(c.quiz) && Array.isArray(c.retiredIds) && !!c.review;
}

export function resolveReadingLesson(raw: unknown, lesson: number): ResolvedReading | null {
  if (!isReadingLesson(raw) || raw.lesson !== lesson) return null;
  const approved = raw.review.status === 'approved';
  let held = 0;
  try {
    check(raw.retiredIds.every((id) => typeof id === 'string' && WORD_ID.test(id)));
    const retired = new Set(raw.retiredIds);
    const ids = new Set<string>();
    const stageIds = new Set<string>();
    const byId = new Map<string, ReadingItem & { stage: ReadingStage }>();
    const flagged = new Set<string>();
    for (const s of raw.stages) {
      check(typeof s.id === 'string' && STAGE_ID.test(s.id) && !stageIds.has(s.id) && s.id !== 'passage');
      stageIds.add(s.id);
      check(typeof s.name === 'string' && wordsOf(s.name) !== null);
      check(s.vowel === undefined || (typeof s.vowel === 'string' && ['fatha', 'kasra', 'damma'].includes(s.vowel)));
      check(Array.isArray(s.items));
      for (const it of s.items) {
        check(typeof it.id === 'string' && WORD_ID.test(it.id) && it.id.slice(0, -4) === s.id && !ids.has(it.id) && !retired.has(it.id));
        ids.add(it.id);
        check(['syllables', 'word', 'sentence'].includes(it.kind) && typeof it.text === 'string' && it.text === it.text.normalize('NFC'));
        check(isReview(it.review) && (it.was === null || (typeof it.was === 'string' && !!it.review)));
        if (it.kind === 'sentence') check(wordsOf(it.text) !== null && wordsOf(it.text)!.length >= 2);
        else check(isWord(it.text));
        if (s.vowel !== undefined && it.kind !== 'sentence') check(allCarry(it.text, s.vowel)); // the stage's vowel, on every letter
        byId.set(it.id, { ...it, stage: s });
        if (it.review) flagged.add(it.text);
      }
    }
    const shown = (text: string) => !flagged.has(text);

    const passages: ResolvedReading['passages'] = [];
    const passageIds = new Set<string>();
    check(raw.passages === undefined || Array.isArray(raw.passages));
    check(raw.names === undefined || (Array.isArray(raw.names) && raw.names.every(isWord)));
    for (const p of raw.passages ?? []) {
      check(typeof p.id === 'string' && WORD_ID.test(p.id) && p.id.slice(0, -4) === 'passage' && !passageIds.has(p.id) && !ids.has(p.id));
      passageIds.add(p.id);
      check(!!p.title && typeof p.title.text === 'string' && wordsOf(p.title.text) !== null && isReview(p.title.review));
      check(Array.isArray(p.sentences) && p.sentences.length > 0 && new Set(p.sentences).size === p.sentences.length);
      check(p.sentences.every((id) => byId.get(id)?.kind === 'sentence'));
      const ok = !p.title.review && p.sentences.every((id) => shown(byId.get(id)!.text));
      if (ok) passages.push({ id: p.id, title: p.title.text, sentences: p.sentences.map((id) => byId.get(id)!.text) });
      else held++;
    }

    const quiz: ResolvedQuiz[] = [];
    const quizIds = new Set<string>();
    for (const q of raw.quiz) {
      check(typeof q.id === 'string' && !!q.id && !quizIds.has(q.id) && isReview(q.review));
      quizIds.add(q.id);
      check(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 4 && new Set(q.options).size === q.options.length);
      check(typeof q.answer === 'number' && Number.isInteger(q.answer));
      let item: ResolvedQuiz;
      let words: string[];
      if (q.kind === 'vowel') {
        const stage = raw.stages.find((s) => s.id === q.stage);
        check(!!stage && stage.vowel !== undefined);
        const kinds = new Map([...byId.values()].filter((it) => it.kind !== 'sentence').map((it) => [it.text, it.kind]));
        check(q.options.every((o) => kinds.has(o)));
        check(new Set(q.options.map((o) => kinds.get(o))).size === 1); // all drills or all words, never mixed
        const right = q.options.flatMap((o, i) => (allCarry(o, stage.vowel!) ? [i] : []));
        check(right.length === 1 && right[0] === q.answer);
        check([...byId.values()].some((it) => it.stage === stage && it.text === q.options[q.answer])); // the answer is the stage's own
        item = { id: q.id, question: `أَيُّهَا كُلُّهُ بِـ${stage.name}؟`, prompt: null, word: null, options: q.options, answer: q.answer };
        words = q.options;
      } else if (q.kind === 'missing') {
        const s = byId.get(q.sentence);
        check(!!s && s.kind === 'sentence' && typeof q.blank === 'number');
        const ws = wordsOf(s.text)!;
        check(Number.isInteger(q.blank) && q.blank >= 0 && q.blank < ws.length);
        check(q.options.every(isWord));
        const right = q.options.flatMap((o, i) => (o === ws[q.blank] ? [i] : []));
        check(right.length === 1 && right[0] === q.answer); // exactly one option completes the sentence verbatim
        // A wrong option is a word of ANOTHER sentence of this lesson (never a drill), and it is held with it:
        // the question shows only if each wrong option has a sentence that is not held.
        const drills = new Set([...byId.values()].filter((it) => it.kind === 'syllables').map((it) => it.text));
        const sources = q.options.map((o, i) =>
          i === q.answer ? [s.text] : [...byId.values()].filter((it) => it.kind === 'sentence' && it.id !== s.id && wordsOf(it.text)!.includes(o)).map((it) => it.text),
        );
        check(q.options.every((o, i) => sources[i]!.length > 0 && (i === q.answer || !drills.has(o))));
        // A wrong option must not be able to complete the sentence too (reviews of #292): it is never
        //  - a word of the blank's own sentence;
        //  - a word that sits in the blank's place in another sentence (the subject for a subject);
        //  - a sentence's last word (its pausal form);
        //  - the answer in another form (الْوَلَدْ / الْوَلَدُ, كِتَابًا / كِتَابْ);
        //  - another name where the blank is a name (compared by letters, so أَحْمَدْ is أَحْمَدُ).
        const sentences = [...byId.values()].filter((it) => it.kind === 'sentence').map((it) => wordsOf(it.text)!);
        const names = new Set((raw.names ?? []).map(bare));
        const answer = ws[q.blank]!;
        check(q.options.every((o, i) =>
          i === q.answer || (
            !ws.includes(o) &&
            !sentences.some((x) => x[q.blank] === o || x[x.length - 1] === o) &&
            bare(o) !== bare(answer) &&
            !(names.has(bare(answer)) && names.has(bare(o)))
          ),
        ));
        const shownText = ws.map((w, i) => (i === q.blank ? '…' : w)).join(' ');
        item = { id: q.id, question: 'أَيُّ كَلِمَةٍ تُكْمِلُ الْجُمْلَةَ؟', prompt: shownText, word: null, options: q.options, answer: q.answer };
        words = [s.text, ...sources.slice(0).filter((_, i) => i !== q.answer).map((src) => src.find((t) => !flagged.has(t)) ?? src[0]!)];
      } else {
        throw new Refused();
      }
      if (!q.review && words.every(shown)) quiz.push(item);
      else held++;
    }

    const stages = raw.stages.map((s) => ({
      id: s.id,
      name: s.name,
      ...(s.vowel === undefined ? {} : { vowel: s.vowel }),
      items: s.items.filter((it) => {
        const ok = shown(it.text);
        if (!ok) held++;
        return ok;
      }).map((it) => ({ id: it.id, kind: it.kind, text: it.text })),
    }));
    return { stages, passages, quiz, held, approved };
  } catch {
    return null;
  }
}
