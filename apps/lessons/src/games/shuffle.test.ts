import { describe, expect, it } from 'vitest';
import { rounds, shuffled } from './shuffle';

describe('game order', () => {
  it('a shuffle is fixed by its seed and is a permutation, never the answer itself', () => {
    const items = [1, 2, 3, 4, 5];
    expect(shuffled(items, 7)).toEqual(shuffled(items, 7));
    expect([...shuffled(items, 7)].sort()).toEqual(items);
    for (let seed = 0; seed < 200; seed++) expect(shuffled(items, seed)).not.toEqual(items);
  });

  it('the rounds cover EVERY ayah of the surah, each once', () => {
    for (const count of [3, 5, 6, 11, 22, 40, 286]) {
      const all = rounds(count).flat();
      expect(all).toEqual(Array.from({ length: count }, (_, i) => i + 1));
      expect(rounds(count).every((r) => r.length >= 2)).toBe(true);
    }
  });
});
