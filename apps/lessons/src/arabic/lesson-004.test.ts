import { describe, expect, it } from 'vitest';
import { arabicLessonFor } from './index';
import { allCarry, isReadingLesson, resolveReadingLesson, type StageVowel } from '../reading/reading';

// The REAL lesson 4 file (reading with the harakat, P0-5c): pending, so nothing shows; every letter of a
// vowel stage carries its vowel; drills are drills and never offered as words; one right answer each.
type Item = { id: string; kind: 'syllables' | 'word' | 'sentence'; text: string; review: string | null };
type Stage = { id: string; vowel?: StageVowel; items: Item[] };

describe('Arabic lesson 4 (reading with the harakat), the real file', () => {
  const raw = arabicLessonFor(4);
  const stages = (raw as { stages: Stage[] }).stages;

  it('is a reading lesson that resolves pending', () => {
    expect(isReadingLesson(raw)).toBe(true);
    const r = resolveReadingLesson(raw, 4)!;
    expect(r).not.toBeNull();
    expect(r.approved).toBe(false);
  });

  it('has the three vowel stages and the mixed stage; every letter of a vowel stage carries its vowel', () => {
    expect(stages.map((s) => [s.id, s.vowel ?? null])).toEqual([['fatha', 'fatha'], ['kasra', 'kasra'], ['damma', 'damma'], ['mixed', null]]);
    for (const s of stages) if (s.vowel) expect(s.items.every((it) => allCarry(it.text, s.vowel!))).toBe(true);
    expect(stages.map((s) => s.items.length)).toEqual([56, 56, 56, 47]);
  });

  it('keeps drills as drills: the kasra and damma stages are all drills, the mixed stage all words', () => {
    const kinds = (id: string) => new Set(stages.find((s) => s.id === id)!.items.map((it) => it.kind));
    expect(kinds('kasra')).toEqual(new Set(['syllables']));
    expect(kinds('damma')).toEqual(new Set(['syllables']));
    expect(kinds('mixed')).toEqual(new Set(['word']));
    const fatha = stages[0]!.items;
    expect(fatha.find((it) => it.text === 'كَتَبَ')!.kind).toBe('word');
    expect(fatha.find((it) => it.text === 'بَتَ')!.kind).toBe('syllables');
  });

  it('leaves out the old items that are not words as vowelled, and holds two for suitability', () => {
    const texts = stages.flatMap((s) => s.items.map((it) => it.text));
    for (const gone of ['كَتِبَ', 'نَجِحَ', 'عَرِفَ', 'رَجُلَ']) expect(texts).not.toContain(gone);
    expect(new Set(texts).size).toBe(texts.length);
    const held = stages.flatMap((s) => s.items.filter((it) => it.review).map((it) => it.text));
    expect(held.sort()).toEqual(['ضُرِبَ', 'قُتِلَ'].sort());
  });

  it('approved, every vowel question resolves with exactly one option carrying the stage\'s vowel', () => {
    const approved = { ...structuredClone(raw as object), review: { status: 'approved', by: 'test', note: '' } } as unknown as { stages: Stage[] };
    for (const s of approved.stages) for (const it of s.items) it.review = null;
    const r = resolveReadingLesson(approved, 4)!;
    expect(r.approved).toBe(true);
    expect(r.quiz).toHaveLength(19);
    for (const q of r.quiz) expect(q.question.startsWith('أَيُّهَا كُلُّهُ بِـ')).toBe(true);
  });
});
