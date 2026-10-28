import { describe, expect, it } from 'vitest';
import { resolveArabicLesson } from './arabic-lesson';
import { arabicLessonFor } from './index';
import { HARAKA, has, type Haraka } from './letters';

// The REAL lesson 3 file (the harakat): a word is in a unit only where that
// letter CARRIES that haraka, and nothing of it is shown until the Teachers
// department approves it.
type Raw = {
  units: { id: string; letters: string[]; mark: Haraka; group: string; name: string; words: { text: string; review: string | null; finalMarkException?: string }[] }[];
};

describe('Arabic lesson 3 (the harakat), the real file', () => {
  const raw = arabicLessonFor(3) as Raw;
  const r = resolveArabicLesson(raw, 3)!;

  it('resolves pending: a letter carrying one haraka per unit, three per letter, grouped by the letter', () => {
    expect(r).not.toBeNull();
    expect(r.approved).toBe(false);
    expect(r.units).toHaveLength(83);
    expect(r.units.slice(0, 6).map((u) => u.id)).toEqual(['hamza_fatha', 'hamza_kasra', 'hamza_damma', 'ba_fatha', 'ba_kasra', 'ba_damma']);
    expect(r.units.slice(0, 6).map((u) => u.name)).toEqual(['أَ', 'إِ', 'أُ', 'بَ', 'بِ', 'بُ']);
    // يِ is left out: every old word was a nisba ـِي, whose ي does not carry the kasra.
    expect(raw.units.map((u) => u.id)).not.toContain('ya_kasra');
    expect(new Set(raw.units.map((u) => u.group)).size).toBe(28);
  });

  it('every word has its letter carrying its haraka; the old mislabelled words are gone', () => {
    for (const u of raw.units) for (const w of u.words) expect(has(w.text, { letters: u.letters, mark: HARAKA[u.mark] })).toBe(true);
    const ya = raw.units.filter((u) => u.group === 'ي').flatMap((u) => u.words.map((w) => w.text.normalize('NFC')));
    for (const nisba of ['عَرَبِيْ', 'عَرَبِي', 'إِسْلَامِيْ']) expect(ya).not.toContain(nisba);
  });

  it("keeps the lesson's vowel on the last letter only as a held exception", () => {
    const ba = raw.units.find((u) => u.id === 'ba_fatha')!;
    const katab = ba.words.find((w) => w.text === 'كَتَبَ')!;
    expect(katab.finalMarkException).toBeTruthy();
    expect(katab.review).toMatch(/FINAL MARK EXCEPTION/);
    const words = raw.units.flatMap((u) => u.words);
    expect(words.filter((w) => w.finalMarkException)).toHaveLength(39);
    expect(words.filter((w) => w.finalMarkException && !w.review)).toHaveLength(0);
  });

  it('holds every changed word: only the unchanged ones could ever show', () => {
    const words = raw.units.flatMap((u) => u.words);
    expect(words).toHaveLength(747);
    expect(words.filter((w) => w.review)).toHaveLength(729);
    expect(r.held).toBeGreaterThanOrEqual(729);
  });
});
