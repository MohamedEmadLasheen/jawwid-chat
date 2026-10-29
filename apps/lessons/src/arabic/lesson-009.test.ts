import { describe, expect, it } from 'vitest';
import { resolveArabicLesson } from './arabic-lesson';
import { arabicLessonFor } from './index';
import { HARAKA, has } from './letters';

// The REAL lesson 9 file (the shadda), a starter: real verbs only, one unit per
// letter carrying the shadda; nothing shown until the Teachers department approves it.
type Raw = { units: { id: string; letters: string[]; words: { text: string; was: string | null; review: string | null }[] }[] };

describe('Arabic lesson 9 (the shadda), the real file', () => {
  const raw = arabicLessonFor(9) as Raw;
  const r = resolveArabicLesson(raw, 9)!;

  it('resolves pending: every word\'s letter carries its shadda', () => {
    expect(r).not.toBeNull();
    expect(r.approved).toBe(false);
    expect(raw.units).toHaveLength(9);
    for (const u of raw.units) for (const w of u.words) expect(has(w.text, { letters: u.letters, mark: HARAKA.shadda })).toBe(true);
  });

  it('holds every verb (its first vowel added); the non-words are left out', () => {
    const words = raw.units.flatMap((u) => u.words);
    expect(words).toHaveLength(52);
    expect(words.every((w) => !!w.review && !!w.was)).toBe(true);
    expect(words.map((w) => w.text)).toContain('مَدّْ');
    expect(words.some((w) => w.was === 'زدَّ')).toBe(false);
  });
});
