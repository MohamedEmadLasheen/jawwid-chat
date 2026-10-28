import { describe, expect, it } from 'vitest';
import { StarLedger } from './stars';

describe('stars', () => {
  it('one per section, once: revisiting never adds another', () => {
    const s = new StarLedger();
    expect(s.award('verses')).toBe(true);
    expect(s.award('verses')).toBe(false);
    expect(s.award('verses')).toBe(false);
    expect(s.award('order')).toBe(true);
    expect([s.total, s.max]).toEqual([2, 3]);
  });
});
