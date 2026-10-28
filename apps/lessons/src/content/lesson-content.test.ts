import { describe, expect, it } from 'vitest';
import { resolveContent, wordsOf, type LessonContent } from './lesson-content';
import { contentFor } from './index';
import { snapshot } from '../test/fixtures';
import { loadSurah, type Fetcher, type QuranAnchor } from '../quran/dataset';
// The real verified snapshot, built by CI before the tests (scripts/lessons/build-quran-snapshot.py).
import realManifest from '../../public/data/quran/manifest.json';
import realSurah from '../../public/data/quran/surah-085.json';

// Stand-in verses (not Quran text), 3, 2 and 4 words.
const TEXTS = ['أحد اثنان ثلاثة', 'أربعة خمسة', 'ستة سبعة ثمانية تسعة'];

async function surah() {
  const { fetcher, anchor } = await snapshot(85, 3, { basmala: true, texts: TEXTS });
  return loadSurah(85, fetcher, anchor);
}

function content(): LessonContent {
  return {
    surah: 85,
    datasetId: 'tanzil-uthmani-1.1',
    review: { status: 'pending', by: null, note: '' },
    provenance: {},
    intro: { text: 'مقدمة', review: null },
    tafsir: [
      { ayah: 1, text: 'شرح الأولى', review: null },
      { ayah: 2, text: 'شرح فيه شك', review: 'unsure' },
      { ayah: 3, text: null, review: 'missing' },
    ],
    words: [
      { ayah: 1, word: 3, meaning: 'معنى', review: null },
      { ayah: 3, word: 2, meaning: 'معنى فيه شك', review: 'unsure' },
    ],
    complete: [{ ayah: 1, word: 3 }, { ayah: 2, word: 2 }, { ayah: 3, word: 4 }],
    quiz: [
      { id: 'q1', category: 'hifz', question: 'ما أول آية؟', options: [{ ayah: 1 }, { ayah: 2 }], answer: 0, review: null },
      { id: 'q2', category: 'hifz', question: 'أكمل', prompt: { ayah: 3, words: 2 }, options: [{ ayah: 3, word: 3 }, { ayah: 1, word: 1 }], answer: 0, review: null },
      { id: 'q3', category: 'meanings', question: 'ما معنى كلمة', word: { ayah: 1, word: 3 }, options: [{ text: 'أ' }, { text: 'ب' }], answer: 1, review: null },
      { id: 'q4', category: 'hifz', question: 'سؤال فيه شك', options: [{ text: 'أ' }, { text: 'ب' }], answer: 0, review: 'unsure' },
    ],
    lessons: [{ text: 'درس', review: null }],
    reflection: { question: 'سؤال', ideas: ['فكرة'], review: null },
    didYouKnow: [{ text: 'هل تعلم', review: null }, { text: 'هل تعلم فيه شك', review: 'unsure' }],
  };
}

describe('lesson content: prose plus positions into the verified text', () => {
  it('a word is the n-th space-separated token that holds a letter (pause marks are not words)', () => {
    const mark = String.fromCodePoint(0x6d6);
    expect(wordsOf(`أحد ${mark} اثنان`)).toEqual(['أحد', 'اثنان']);
  });

  it('resolves every position from the verified surah, and holds back each flagged line', async () => {
    const r = resolveContent(content(), await surah())!;
    expect([...r.tafsir]).toEqual([[1, 'شرح الأولى']]);
    expect(r.words).toEqual([{ ayah: 1, text: 'ثلاثة', meaning: 'معنى' }]);
    expect(r.complete.map((c) => c.text)).toEqual(['ثلاثة', 'خمسة', 'تسعة']);
    expect(r.quiz.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
    expect(r.quiz[0]!.options).toEqual(['أحد اثنان ثلاثة', 'أربعة خمسة']);
    expect(r.quiz[1]).toMatchObject({ prompt: 'ستة سبعة', options: ['ثمانية', 'أحد'], answer: 0 });
    expect(r.quiz[2]).toMatchObject({ word: 'ثلاثة', options: ['أ', 'ب'], answer: 1 });
    expect(r.didYouKnow).toEqual(['هل تعلم']);
    expect(r.held).toBe(5);
    expect(r.approved).toBe(false);
  });

  it('refuses the whole content when any position does not exist in the verified surah', async () => {
    const s = await surah();
    for (const change of [
      (c: LessonContent) => { c.words[0]!.word = 4; },
      (c: LessonContent) => { c.complete[0] = { ayah: 4, word: 1 }; },
      (c: LessonContent) => { c.quiz[0]!.options[0] = { ayah: 9 }; },
      (c: LessonContent) => { c.quiz[1]!.prompt = { ayah: 3, words: 4 }; },
      (c: LessonContent) => { c.quiz[0]!.answer = 2; },
      (c: LessonContent) => { c.surah = 86; },
      (c: LessonContent) => { c.datasetId = 'another'; },
      (c: LessonContent) => { (c as { quiz: unknown }).quiz = undefined; },
      (c: LessonContent) => { (c.quiz[0] as { options: unknown }).options = undefined; },
    ]) {
      const c = content();
      change(c);
      expect(resolveContent(c, s)).toBeNull();
    }
  });

  it('Al-Buruj has reviewed content; a surah without any has none', () => {
    expect((contentFor(85) as LessonContent).surah).toBe(85);
    expect(contentFor(86)).toBeNull();
  });
});

// The REAL thing: the reviewed Al-Buruj file against the real verified snapshot.

describe('Al-Buruj, on the real verified text', () => {
  it('every position in its reviewed content resolves; the flagged lines are held back', async () => {
    const fetcher: Fetcher = async (path) =>
      structuredClone(path.endsWith('manifest.json') ? realManifest : path.endsWith('surah-085.json') ? realSurah : null);
    const anchor: QuranAnchor = {
      datasetId: realManifest.datasetId,
      fileSha256: realManifest.fileSha256,
      rangeSha256: realManifest.surahs.map((s) => s.rangeSha256),
    };
    const s = await loadSurah(85, fetcher, anchor);
    expect(s.ayahs).toHaveLength(22);
    const r = resolveContent(contentFor(85), s)!;
    expect(r).not.toBeNull();
    expect(r.approved).toBe(false);
    expect(r.held).toBe(18);
    // Shown: the tafsir of the 10 unflagged ayat; 12 are held (6 doubtful or merged, 6 missing: 17-22).
    expect([...r.tafsir.keys()]).toEqual([2, 4, 5, 6, 7, 8, 12, 13, 14, 16]);
    expect(r.complete).toHaveLength(9);
    // The "last ayah" question was corrected to 22 and is held for a teacher; the Tajweed question is gone.
    expect(r.quiz.map((q) => q.id)).toEqual(['q1', 'q3', 'q6', 'q7', 'q8', 'q9']);
    // Each game word really is that word of the verified verse.
    for (const c of r.complete) expect(wordsOf(s.ayahs[c.ayah - 1]!.text)[c.word - 1]).toBe(c.text);
  });
});
