import { describe, expect, it } from 'vitest';
import { resolveArabicLesson } from './arabic-lesson';
import { arabicLessonFor } from './index';
import { has, positions } from './letters';

// The REAL lesson 1 file (P0-5 PR-2): every proof the browser makes holds, and
// nothing of it is shown until the Teachers department approves it.
describe('Arabic lesson 1 (the letters), the real file', () => {
  const raw = arabicLessonFor(1) as { units: { id: string; letters: string[]; words: { text: string; review: string | null }[] }[] };
  const r = resolveArabicLesson(raw, 1)!;

  it('resolves: every word holds its unit\'s letter, every question has one right answer', () => {
    expect(r).not.toBeNull();
    expect(r.approved).toBe(false);
    expect(r.units.map((u) => u.id)).toEqual([
      'alif', 'ba', 'ta', 'ta_marbuta', 'tha', 'jim', 'hha', 'kha', 'dal', 'dhal', 'ra', 'zay', 'sin', 'shin', 'sad', 'dad',
      'tta', 'zza', 'ain', 'ghain', 'fa', 'qaf', 'kaf', 'lam', 'mim', 'nun', 'ha', 'waw', 'ya', 'hamza', 'alif_maqsura', 'lam_alif',
    ]);
  });

  it('no alif word starts with alif: the old alif-start words are hamza words now', () => {
    const alif = raw.units.find((u) => u.id === 'alif')!;
    expect(alif.words.every((w) => !positions(w.text, alif).includes('start'))).toBe(true);
    const hamza = raw.units.find((u) => u.id === 'hamza')!;
    for (const w of ['أَسَدْ', 'أَرْنَبْ', 'أُمّْ']) expect(hamza.words.map((x) => x.text)).toContain(w);
    expect(has('أَسَدْ', alif)).toBe(false);
  });

  it('holds every changed word: only the unchanged ones could ever show', () => {
    const words = raw.units.flatMap((u) => u.words);
    expect(words).toHaveLength(1521);
    expect(words.filter((w) => w.review)).toHaveLength(1416);
    expect(r.held).toBeGreaterThanOrEqual(1416);
  });
});
