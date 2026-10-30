import { describe, expect, it } from 'vitest';
import { islamicLessonFor } from './index';
import { isTopicLesson, resolveTopicLesson, type TopicLesson } from '../topic/topic';
import { settled } from '../test/topic-settled';

// The REAL batch 1 files (the Prophet ﷺ lessons): pending, so nothing shows; every hadith held;
// Quran only by reference; and each file is otherwise well formed -- an approved copy with its
// CHECK lines settled resolves, holding nothing but its hadith.
const BATCH1 = { 8: 'التعريف بالنبي ﷺ', 9: 'رحمته ﷺ', 10: 'صِدْقُهُ ﷺ', 11: 'أمانة النبي ﷺ', 20: 'محمد ﷺ نبيي' } as const;
const blocks = (c: TopicLesson) => c.sections.flatMap((s) => s.blocks);

describe('Islamic Studies batch 1, the real files', () => {
  for (const [n, title] of Object.entries(BATCH1)) {
    const lesson = Number(n);
    const raw = islamicLessonFor(lesson) as TopicLesson;

    it(`lesson ${lesson} (${title}) resolves pending, and holds every hadith`, () => {
      expect(isTopicLesson(raw)).toBe(true);
      const r = resolveTopicLesson(raw, lesson)!;
      expect(r).not.toBeNull();
      expect(r.approved).toBe(false);
      expect(raw.title.text).toBe(title);
      expect(raw.fiqh).toBe(false); // none of the Prophet ﷺ lessons teaches fiqh
      expect(blocks(raw).filter((b) => b.kind === 'hadith').every((b) => b.review?.startsWith('HADITH'))).toBe(true);
      expect(r.sections.flatMap((s) => s.blocks).some((b) => (b as { kind: string }).kind === 'hadith')).toBe(false);
    });

    it(`lesson ${lesson}: approved as it stands it is refused while a line is flagged; settled, it holds only its hadith`, () => {
      const hadith = blocks(raw).filter((b) => b.kind === 'hadith').length;
      const flagged = blocks(raw).some((b) => b.kind !== 'hadith' && b.review) || raw.quiz.some((q) => q.review);
      const asIs = { ...structuredClone(raw), review: { status: 'approved' as const, by: 'x', note: 'x' } };
      expect(resolveTopicLesson(asIs, lesson) === null).toBe(flagged);
      const r = resolveTopicLesson(settled(raw), lesson)!;
      expect(r.approved).toBe(true);
      expect(r.held).toBe(hadith);
    });
  }

  it('cites the Quran by reference only: lesson 20 points at five ayat, the others at none', () => {
    const refs = (n: number) => blocks(islamicLessonFor(n) as TopicLesson).flatMap((b) => (b.kind === 'quran' ? [`${b.surah}:${b.from}-${b.to}`] : []));
    expect(refs(20)).toEqual(['7:158-158', '18:1-1', '33:40-40', '4:13-13', '33:56-56']);
    for (const n of [8, 9, 10, 11]) expect(refs(n)).toEqual([]);
  });

});
