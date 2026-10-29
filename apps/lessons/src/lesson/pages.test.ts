import { describe, expect, it } from 'vitest';
import { LONG_SURAH, PAGE_SIZE, pageCount, pageOf, pageOfAyah } from './pages';

describe('long surahs, a page at a time', () => {
  it('a surah of up to 50 ayat is one page (all of Juz\' Amma, as before); a longer one pages by 20', () => {
    expect([LONG_SURAH, PAGE_SIZE]).toEqual([50, 20]);
    expect(pageCount(7)).toBe(1);
    expect(pageCount(46)).toBe(1); // An-Nazi'at
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(3);
    expect(pageCount(286)).toBe(15); // Al-Baqarah
  });

  it('cuts the ayat, clamped to the surah', () => {
    const ayahs = Array.from({ length: 286 }, (_, i) => i + 1);
    expect(pageOf(ayahs, 0)).toEqual(ayahs.slice(0, 20));
    expect(pageOf(ayahs, 14)).toEqual([281, 282, 283, 284, 285, 286]);
    expect(pageOf(ayahs, 99)).toEqual(pageOf(ayahs, 14));
    expect(pageOf(ayahs, -1)).toEqual(pageOf(ayahs, 0));
    expect(pageOf([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect([pageOfAyah(286, 1), pageOfAyah(286, 20), pageOfAyah(286, 21), pageOfAyah(286, 286), pageOfAyah(22, 22)]).toEqual([0, 0, 1, 14, 0]);
  });
});
