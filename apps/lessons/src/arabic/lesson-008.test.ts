import { describe, expect, it } from 'vitest';
import { resolveArabicLesson } from './arabic-lesson';
import { arabicLessonFor } from './index';
import { TANWEEN, has, type Tanween } from './letters';

// The REAL lesson 8 file (the tanween): three units, a word belonging to one if it ENDS in
// that tanween; every word keeps it, held; nothing shown until approved.
type Raw = { units: { id: string; tanween: Tanween; words: { text: string; review: string | null; finalMarkException?: string }[] }[] };

describe('Arabic lesson 8 (the tanween), the real file', () => {
  const raw = arabicLessonFor(8) as Raw;
  const r = resolveArabicLesson(raw, 8)!;

  it('resolves pending: three tanween units, every word ending in its own', () => {
    expect(r).not.toBeNull();
    expect(r.approved).toBe(false);
    expect(raw.units.map((u) => u.tanween)).toEqual(['fath', 'damm', 'kasr']);
    for (const u of raw.units) for (const w of u.words) expect(has(w.text, { letters: [], tanween: TANWEEN[u.tanween] })).toBe(true);
  });

  it('every word keeps its tanween as a held final-mark exception', () => {
    const words = raw.units.flatMap((u) => u.words);
    expect(words).toHaveLength(165);
    expect(words.every((w) => !!w.finalMarkException && !!w.review)).toBe(true);
    expect(words.map((w) => w.text)).toContain('كِتَابًا');
  });
});
