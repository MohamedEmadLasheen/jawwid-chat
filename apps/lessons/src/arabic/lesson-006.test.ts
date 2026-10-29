import { describe, expect, it } from 'vitest';
import { resolveArabicLesson } from './arabic-lesson';
import { arabicLessonFor } from './index';
import { HARAKA, has } from './letters';

// The REAL lesson 6 file (the sukun): one unit, a word belonging to it only where a
// letter carries an INTERNAL sukun; nothing shown until the Teachers department approves it.
type Raw = {
  units: { letters: string[]; words: { text: string; review: string | null }[] }[];
  distractors: { id: string; text: string; review: string | null }[];
};

describe('Arabic lesson 6 (the sukun), the real file', () => {
  const raw = arabicLessonFor(6) as Raw;
  const r = resolveArabicLesson(raw, 6)!;
  const sukun = { letters: raw.units[0]!.letters, mark: HARAKA.sukun };

  it('resolves pending: one unit, every word with an internal sukun, every distractor without one', () => {
    expect(r).not.toBeNull();
    expect(r.approved).toBe(false);
    expect(r.units.map((u) => [u.id, u.name])).toEqual([['sukun', 'سُكُونْ']]);
    for (const w of raw.units[0]!.words) expect(has(w.text, sukun)).toBe(true);
    for (const d of raw.distractors) expect(has(d.text, sukun)).toBe(false);
    expect(raw.distractors.every((d) => /^distractor-\d{3}$/.test(d.id) && !!d.review)).toBe(true);
  });

  it('holds every word (the tanween read as the pausal sukun), and left out the syllables', () => {
    const words = raw.units[0]!.words;
    expect(words).toHaveLength(23);
    expect(words.every((w) => !!w.review)).toBe(true);
    expect(words.map((w) => w.text)).toContain('نَجْمْ');
    expect(words.map((w) => w.text)).not.toContain('أبْ');
    expect(r.quiz).toHaveLength(0); // every question shows a held word until review
  });
});
