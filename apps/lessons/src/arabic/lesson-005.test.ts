import { describe, expect, it } from 'vitest';
import { arabicLessonFor } from './index';
import { isReadingLesson, resolveReadingLesson, wordsOf } from '../reading/reading';

// The REAL lesson 5 file (reading sentences, P0-5c): pending, so nothing shows; every
// sentence single-spaced words; the pausal sukun on the last word only.
describe('Arabic lesson 5 (reading sentences), the real file', () => {
  const raw = arabicLessonFor(5);
  const r = resolveReadingLesson(raw, 5)!;

  it('is a reading lesson that resolves pending', () => {
    expect(isReadingLesson(raw)).toBe(true);
    expect(r).not.toBeNull();
    expect(r.approved).toBe(false);
  });

  it('holds every sentence; only the last word takes the pausal sukun', () => {
    const items = (raw as { stages: { items: { text: string; review: string | null }[] }[] }).stages[0]!.items;
    expect(items).toHaveLength(62);
    expect(items.every((it) => !!it.review && wordsOf(it.text) !== null)).toBe(true);
    expect(items.map((it) => it.text)).toContain('فَتَحَ الْوَلَدُ الْبَابْ');
  });
});
