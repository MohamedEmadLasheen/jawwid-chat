import { describe, expect, it } from 'vitest';
import { rounds, scrambled, shuffled } from './shuffle';

describe('game order', () => {
  it('a shuffle is fixed by its seed, is a permutation, and every order occurs (the original too)', () => {
    const items = [1, 2, 3, 4, 5];
    expect(shuffled(items, 7)).toEqual(shuffled(items, 7));
    expect([...shuffled(items, 7)].sort()).toEqual(items);
    const pairs = new Set<string>();
    for (let seed = 0; seed < 200; seed++) pairs.add(shuffled(['a', 'b'], seed).join());
    expect([...pairs].sort()).toEqual(['a,b', 'b,a']);
    const firsts = new Set<number>();
    for (let seed = 0; seed < 200; seed++) firsts.add(shuffled(items, seed)[0]!);
    expect([...firsts].sort()).toEqual(items);
  });

  it('a scramble (for ordering games) is never the answer itself', () => {
    const items = [1, 2, 3, 4, 5];
    expect([...scrambled(items, 7)].sort()).toEqual(items);
    for (let seed = 0; seed < 200; seed++) expect(scrambled(items, seed)).not.toEqual(items);
    for (let seed = 0; seed < 50; seed++) expect(scrambled([1, 2], seed)).toEqual([2, 1]);
  });

  it('the rounds cover EVERY ayah of the surah, each once', () => {
    for (const count of [3, 5, 6, 11, 22, 40, 286]) {
      const all = rounds(count).flat();
      expect(all).toEqual(Array.from({ length: count }, (_, i) => i + 1));
      expect(rounds(count).every((r) => r.length >= 2)).toBe(true);
    }
  });
});
