import { describe, expect, it } from 'vitest';
import { resolveArabicLesson } from './arabic-lesson';
import { arabicLessonFor } from './index';
import { has } from './letters';

// The REAL lesson 2 file (letters that look or sound alike): one group per pair,
// a unit per letter of the pair, and nothing shown until the Teachers department
// approves it.
type Raw = {
  units: { id: string; letters: string[]; group: string; words: { text: string; review: string | null }[] }[];
  quiz: { kind: string; unit: string; options?: string[]; answer: number | string }[];
};

describe('Arabic lesson 2 (letters that look or sound alike), the real file', () => {
  const raw = arabicLessonFor(2) as Raw;
  const r = resolveArabicLesson(raw, 2)!;

  it('resolves pending: 19 pairs, two units each, every word holding its own letter', () => {
    expect(r).not.toBeNull();
    expect(r.approved).toBe(false);
    expect(r.units).toHaveLength(38);
    expect(new Set(raw.units.map((u) => u.group)).size).toBe(19);
    expect(raw.units.slice(0, 2).map((u) => [u.id, u.group])).toEqual([['ba_vs_nun', 'ب ن'], ['nun_vs_ba', 'ب ن']]);
    for (const u of raw.units) for (const w of u.words) expect(has(w.text, u)).toBe(true);
  });

  it('every quiz question\'s wrong options come from the pair\'s other letter', () => {
    const byId = new Map(raw.units.map((u) => [u.id, u]));
    const contains = raw.quiz.filter((q) => q.kind === 'contains');
    expect(contains.length).toBeGreaterThan(30);
    for (const q of contains) {
      const [mine, other] = q.unit.split('_vs_') as [string, string];
      const partner = byId.get(`${other}_vs_${mine}`)!;
      const wrong = q.options!.filter((_, i) => i !== q.answer);
      for (const w of wrong) expect(partner.words.map((x) => x.text)).toContain(w);
    }
  });

  it('holds every changed word: only the unchanged ones could ever show', () => {
    const words = raw.units.flatMap((u) => u.words);
    expect(words).toHaveLength(515);
    expect(words.filter((w) => w.review)).toHaveLength(513);
    // حِصَان was listed under س: it is not in the file.
    expect(raw.units.find((u) => u.id === 'sin_vs_shin')!.words.map((w) => w.text).some((t) => t.startsWith('حِصَان'))).toBe(false);
  });
});
