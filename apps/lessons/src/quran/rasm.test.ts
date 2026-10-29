import { describe, expect, it } from 'vitest';
import vectors from './rasm.vectors.json';
import { rasm } from './rasm';

// The real verified snapshot, built by CI before the tests (scripts/lessons/build-quran-snapshot.py).
const SURAHS: Record<number, { ayahs: { text: string }[] }> = {
  1: await import('../../public/data/quran/surah-001.json'),
  2: await import('../../public/data/quran/surah-002.json'),
  36: await import('../../public/data/quran/surah-036.json'),
  55: await import('../../public/data/quran/surah-055.json'),
  112: await import('../../public/data/quran/surah-112.json'),
};

describe('rasm (the port of scripts/lessons/rasm.py)', () => {
  it.each(vectors.vectors.map((v) => [v.name, v] as const))('%s: folds to the Python skeleton', (_name, v) => {
    expect(rasm(v.input)).toBe(v.skeleton);
  });

  it.each(vectors.vectors.filter((v) => v.ref).map((v) => [v.name, v] as const))('%s: the standard spelling meets the verified Uthmani words', (_name, v) => {
    const ref = v.ref!;
    const verse = SURAHS[ref.surah]!.ayahs[ref.ayah - 1]!.text.split(' ');
    expect(rasm(verse.slice(ref.word - 1, ref.word - 1 + ref.count).join(' '))).toBe(v.skeleton);
  });
});
