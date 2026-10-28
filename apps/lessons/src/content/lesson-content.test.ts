import { describe, expect, it } from 'vitest';
import { resolveContent, wordsOf, type LessonContent } from './lesson-content';
import { contentFor } from './index';
import { snapshot } from '../test/fixtures';
import { loadSurah, type Fetcher, type QuranAnchor } from '../quran/dataset';
// The real verified snapshot, built by CI before the tests (scripts/lessons/build-quran-snapshot.py).
import realManifest from '../../public/data/quran/manifest.json';
import realSurah from '../../public/data/quran/surah-085.json';
import real107 from '../../public/data/quran/surah-107.json';
import real108 from '../../public/data/quran/surah-108.json';
import real109 from '../../public/data/quran/surah-109.json';
import real110 from '../../public/data/quran/surah-110.json';
import real111 from '../../public/data/quran/surah-111.json';
import real112 from '../../public/data/quran/surah-112.json';
import real113 from '../../public/data/quran/surah-113.json';
import real114 from '../../public/data/quran/surah-114.json';
import real99 from '../../public/data/quran/surah-099.json';
import real100 from '../../public/data/quran/surah-100.json';
import real101 from '../../public/data/quran/surah-101.json';
import real102 from '../../public/data/quran/surah-102.json';
import real103 from '../../public/data/quran/surah-103.json';
import real104 from '../../public/data/quran/surah-104.json';
import real105 from '../../public/data/quran/surah-105.json';
import real106 from '../../public/data/quran/surah-106.json';
import real89 from '../../public/data/quran/surah-089.json';
import real90 from '../../public/data/quran/surah-090.json';
import real91 from '../../public/data/quran/surah-091.json';
import real92 from '../../public/data/quran/surah-092.json';
import real93 from '../../public/data/quran/surah-093.json';
import real94 from '../../public/data/quran/surah-094.json';
import real95 from '../../public/data/quran/surah-095.json';
import real96 from '../../public/data/quran/surah-096.json';
import real97 from '../../public/data/quran/surah-097.json';
import real98 from '../../public/data/quran/surah-098.json';

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

// Every lesson rebuilt on the engine (Juz' Amma, batch 1), each on its real verified surah.
// Juz' Amma batch 3 (89-98). Al-Fajr's old lesson split ayah 23: its tafsir is merged and renumbered.
const BATCH3: Record<number, { file: unknown; ayat: number; held: number; complete: number }> = {
  89: { file: real89, ayat: 30, held: 24, complete: 8 },
  90: { file: real90, ayat: 20, held: 8, complete: 8 },
  91: { file: real91, ayat: 15, held: 6, complete: 10 },
  92: { file: real92, ayat: 21, held: 2, complete: 7 },
  93: { file: real93, ayat: 11, held: 5, complete: 5 },
  94: { file: real94, ayat: 8, held: 4, complete: 9 },
  95: { file: real95, ayat: 8, held: 11, complete: 7 },
  96: { file: real96, ayat: 19, held: 6, complete: 7 },
  97: { file: real97, ayat: 5, held: 9, complete: 3 },
  98: { file: real98, ayat: 8, held: 22, complete: 4 },
};

// Juz' Amma batch 2 (99-106).
const BATCH2: Record<number, { file: unknown; ayat: number; held: number; complete: number }> = {
  99: { file: real99, ayat: 8, held: 7, complete: 8 },
  100: { file: real100, ayat: 11, held: 4, complete: 5 },
  101: { file: real101, ayat: 11, held: 7, complete: 3 },
  102: { file: real102, ayat: 8, held: 4, complete: 4 },
  103: { file: real103, ayat: 3, held: 7, complete: 4 },
  104: { file: real104, ayat: 9, held: 10, complete: 9 },
  105: { file: real105, ayat: 5, held: 4, complete: 5 },
  106: { file: real106, ayat: 4, held: 10, complete: 4 },
};

const BATCH1: Record<number, { file: unknown; ayat: number; held: number; complete: number }> = {
  107: { file: real107, ayat: 7, held: 4, complete: 9 },
  108: { file: real108, ayat: 3, held: 5, complete: 6 },
  109: { file: real109, ayat: 6, held: 10, complete: 4 },
  110: { file: real110, ayat: 3, held: 2, complete: 3 },
  111: { file: real111, ayat: 5, held: 9, complete: 4 },
  112: { file: real112, ayat: 4, held: 5, complete: 5 },
  113: { file: real113, ayat: 5, held: 4, complete: 5 },
  114: { file: real114, ayat: 6, held: 4, complete: 8 },
};

describe("Juz' Amma batches 1 to 3, each on its real verified text", () => {
  const anchor: QuranAnchor = {
    datasetId: realManifest.datasetId,
    fileSha256: realManifest.fileSha256,
    rangeSha256: realManifest.surahs.map((s) => s.rangeSha256),
  };
  for (const [n, expected] of Object.entries({ ...BATCH1, ...BATCH2, ...BATCH3 })) {
    it(`surah ${n}: every position resolves, flagged lines are held, and it waits for approval`, async () => {
      const surah = Number(n);
      const fetcher: Fetcher = async (path) =>
        structuredClone(path.endsWith('manifest.json') ? realManifest : path.endsWith(`surah-${n.padStart(3, '0')}.json`) ? expected.file : null);
      const s = await loadSurah(surah, fetcher, anchor);
      expect(s.ayahs).toHaveLength(expected.ayat);
      const r = resolveContent(contentFor(surah), s)!;
      expect(r).not.toBeNull();
      expect(r.approved).toBe(false);
      expect(r.held).toBe(expected.held);
      expect(r.complete).toHaveLength(expected.complete);
      // Each game word, meaning word and quiz word really is that word of the verified verse.
      for (const c of r.complete) expect(wordsOf(s.ayahs[c.ayah - 1]!.text)[c.word - 1]).toBe(c.text);
      expect(new Set(r.complete.map((c) => c.text)).size).toBeGreaterThanOrEqual(3);
    });
  }
});
