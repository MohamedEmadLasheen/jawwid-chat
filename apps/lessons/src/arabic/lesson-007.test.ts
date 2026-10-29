import { describe, expect, it } from 'vitest';
import { resolveArabicLesson } from './arabic-lesson';
import { arabicLessonFor } from './index';
import { MADD, has, type Madd } from './letters';

// The REAL lesson 7 file (the madd): three units, a word belonging to one only where
// its letter is BARE right after its own vowel; nothing shown until approved.
type Raw = { units: { id: string; letters: string[]; madd: Madd; words: { text: string; review: string | null }[] }[] };

describe('Arabic lesson 7 (the madd), the real file', () => {
  const raw = arabicLessonFor(7) as Raw;
  const r = resolveArabicLesson(raw, 7)!;

  it('resolves pending: three madd units, every word holding its madd', () => {
    expect(r).not.toBeNull();
    expect(r.approved).toBe(false);
    expect(raw.units.map((u) => [u.id, u.madd])).toEqual([['madd_alif', 'alif'], ['madd_ya', 'ya'], ['madd_waw', 'waw']]);
    for (const u of raw.units) for (const w of u.words) expect(has(w.text, { letters: u.letters, after: MADD[u.madd].after })).toBe(true);
  });

  it('holds every word; the hamza-dropped spellings carry their reason; بُول is left out', () => {
    const words = raw.units.flatMap((u) => u.words);
    expect(words).toHaveLength(163);
    expect(words.every((w) => !!w.review)).toBe(true);
    expect(words.find((w) => w.text.startsWith('رَاس'))!.review).toMatch(/SPELLING: hamza dropped/);
    expect(words.some((w) => w.text.startsWith('بُول'))).toBe(false);
  });

  it('the wrong options are distractors with no madd at all', () => {
    const d = (raw as unknown as { distractors: { text: string }[] }).distractors;
    expect(d.length).toBeGreaterThanOrEqual(6);
    for (const x of d) for (const u of raw.units) expect(has(x.text, { letters: u.letters, after: MADD[u.madd].after })).toBe(false);
  });
});
