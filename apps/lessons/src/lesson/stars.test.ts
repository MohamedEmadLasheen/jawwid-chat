import { describe, expect, it } from 'vitest';
import { CONTENT_SECTIONS, StarLedger } from './stars';

describe('stars', () => {
  it('one per section, once: revisiting never adds another', () => {
    const s = new StarLedger();
    expect(s.award('verses')).toBe(true);
    expect(s.award('verses')).toBe(false);
    expect(s.award('verses')).toBe(false);
    expect(s.award('order')).toBe(true);
    expect([s.total, s.max]).toEqual([2, 3]);
  });

  it('only for the sections this lesson has', () => {
    const s = new StarLedger();
    expect(s.award('quiz')).toBe(false);
    const full = new StarLedger(CONTENT_SECTIONS);
    expect(full.award('quiz')).toBe(true);
    expect(full.max).toBe(7);
  });
});
