import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Ayah } from '../../quran/dataset';
import { KNOBS } from '../adapt';
import { AyahNumber, planNumbers } from './AyahNumber';
import { CompleteAyah, planGaps } from './CompleteAyah';
import { FadingAyah, hiddenAt, planFades } from './FadingAyah';
import { firstLetter, skeleton, splitMark, tilesOf } from './common';

// Stand-in verses (not Quran). Ayah 2 has a pause mark; ayah 6 repeats ayah 1's words; ayah 5 spells
// ayah 4's last word with other marks.
const TEXTS = [
  'ألف باء تاء ثاء',
  'جيم حاء ۚ خاء دال',
  'راء زاي سين شين',
  'صاد ضاد طاء ظاء',
  'غين فاء قاف كَاف',
  'ألف باء تاء ثاء',
  'لام ميم نون هاء واو',
  'ياء همزة باء جيم',
];
const AYAHS: Ayah[] = TEXTS.map((text, i) => ({ ayah: i + 1, basmala: null, text, sha256: '' }));
const props = (over: Record<string, unknown> = {}) => ({ surah: 1, ayahs: AYAHS.slice(0, 2), pool: AYAHS, audio: null, band: '6-8' as const, seed: 3, onComplete: vi.fn(), ...over });
const verses = () => [...document.querySelectorAll('.play-card__verse')].map((v) => v.textContent);
/** The line as it is SHOWN (its screen-reader text aside). */
const line = () => {
  const l = document.querySelector('.play__line')!.cloneNode(true) as HTMLElement;
  l.querySelectorAll('.sr-only').forEach((x) => x.remove());
  return l.textContent;
};

describe('word helpers', () => {
  it('a word and its mark; its letters; its first letter', () => {
    expect(splitMark('حاء ۚ')).toEqual({ word: 'حاء', mark: 'ۚ' });
    expect(splitMark('حاء')).toEqual({ word: 'حاء', mark: '' });
    expect(skeleton('كَاف')).toBe(skeleton('كاف'));
    expect(firstLetter('ٱللَّهُ')).toBe('ٱ');
  });
});

describe('Complete the ayah (أكمل الآية)', () => {
  it("6-8: one blank, never the first word; three choices, real words of the surah, none looking like the answer", () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const g of planGaps(AYAHS, AYAHS, '6-8', seed)) {
        expect(g.blanks).toHaveLength(1);
        const b = g.blanks[0]!;
        expect(b.at).toBeGreaterThan(0);
        expect(b.word).toBe(splitMark(g.tiles[b.at]!).word);
        expect(b.options).toHaveLength(3);
        expect(b.options).toContain(b.word);
        const surahWords = AYAHS.flatMap((a) => tilesOf(a.text).map((t) => splitMark(t).word));
        for (const o of b.options) expect(surahWords).toContain(o);
        expect(b.options.filter((o) => skeleton(o) === skeleton(b.word))).toEqual([b.word]);
      }
    }
    // كاف and كَاف are the same letters: the one is never a wrong choice for the other.
    const g = planGaps([AYAHS[4]!], AYAHS, '6-8', 1);
    expect(g.length).toBe(1);
  });

  it('no wrong choice completes ANOTHER ayah: a near copy differing only in the hidden word', () => {
    // Ayah 2 is ayah 1 with its third word changed (stand-ins): hiding the third word of ayah 1,
    // ayah 2's word would complete ayah 2, so it is never a choice -- in any seed, either band.
    const near = [{ ayah: 1, text: 'ألف باء تاء ثاء' }, { ayah: 2, text: 'ألف باء جيم ثاء' }, ...TEXTS.slice(2).map((text, i) => ({ ayah: i + 3, text }))]
      .map((a) => ({ ...a, basmala: null, sha256: '' }));
    let asked = 0;
    for (const band of ['6-8', '9-12'] as const) {
      for (let seed = 0; seed < 60; seed++) {
        for (const g of planGaps(near.slice(0, 2), near, band, seed)) {
          for (const b of g.blanks) {
            if (b.at !== 2) continue;
            asked++;
            expect(b.options).not.toContain(g.ayah.ayah === 1 ? 'جيم' : 'تاء');
          }
        }
      }
    }
    expect(asked).toBeGreaterThan(0);
  });

  it('9-12: two blanks, filled in reading order, four choices each', () => {
    for (const g of planGaps(AYAHS, AYAHS, '9-12', 2)) {
      expect(g.blanks).toHaveLength(2);
      expect(g.blanks[0]!.at).toBeLessThan(g.blanks[1]!.at);
      for (const b of g.blanks) expect(b.options).toHaveLength(4);
    }
  });

  it('a wrong choice is refused and never put into the blank; the right one fills it; then the whole ayah', () => {
    const onComplete = vi.fn();
    render(<CompleteAyah {...props({ onComplete })} />);
    const gaps = planGaps(AYAHS.slice(0, 2), AYAHS, '6-8', 3);
    for (const g of gaps) {
      const b = g.blanks[0]!;
      const before = line();
      // The blank is a blank: the hidden word is not on the line, the rest is.
      expect(before).not.toContain(` ${b.word} `);
      expect(screen.getByText('الكلمة الناقصة')).toBeTruthy();
      const group = screen.getByRole('group', { name: 'الاختيارات' });
      fireEvent.click(within(group).getAllByRole('button').find((x) => !x.textContent!.startsWith(b.word))!);
      expect(line()).toBe(before);
      expect(screen.getByText('✓ هذه هي')).toBeTruthy();
      fireEvent.click(within(group).getAllByRole('button').find((x) => x.textContent!.startsWith(b.word))!);
      expect(verses()).toEqual([g.ayah.text]);
      fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("a hidden word's pause mark stays in its place", () => {
    const seed = [...Array(50).keys()].find((s) => planGaps([AYAHS[1]!], AYAHS, '6-8', s)[0]!.blanks[0]!.at === 1)!;
    expect(seed).toBeDefined();
    render(<CompleteAyah {...props({ ayahs: [AYAHS[1]!], seed })} />);
    expect(line()).toContain('ۚ');
    expect(line()).not.toContain('حاء');
  });
});

describe('The fading ayah (المحو التدريجي)', () => {
  it('more words are hidden at each step, until all are hidden at the last', () => {
    expect([0, 1, 2, 3].map((s) => hiddenAt(5, s, 3))).toEqual([0, 2, 4, 5]);
    expect(planFades(AYAHS, 1)).toHaveLength(3);
    for (const f of planFades(AYAHS, 1)) expect([...f.order].sort()).toEqual(f.tiles.map((_, i) => i));
  });

  it('6-8: words are hidden, never changed; a hidden one can be seen again; then the whole ayah', () => {
    const onComplete = vi.fn();
    render(<FadingAyah {...props({ ayahs: [AYAHS[0]!], onComplete })} />);
    expect(line()).toBe(TEXTS[0]);
    for (let step = 1; step <= 3; step++) {
      fireEvent.click(screen.getByRole('button', { name: 'أخفِ كلمات أكثر' }));
      const shown = [...document.querySelectorAll('.play__slot')].map((x) => x.textContent).filter((t) => !t!.includes('كلمة مخفية'));
      // What is still shown is the ayah's own words, untouched.
      for (const w of shown) expect(tilesOf(TEXTS[0]!)).toContain(w);
      expect(document.querySelectorAll('.play__hidden')).toHaveLength(hiddenAt(4, step, 3));
    }
    fireEvent.click(document.querySelector('.play__hidden')!);
    expect(document.querySelectorAll('.play__hidden')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'اكشف الآية' }));
    expect(verses()).toEqual([TEXTS[0]]);
    fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('9-12: up to five steps, one more word each; a hidden word leaves its first letter as a cue, so the last is first letters only', () => {
    render(<FadingAyah {...props({ ayahs: [AYAHS[0]!], band: '9-12' })} />);
    // A four-word ayah: four steps, not five, so no step repeats the one before.
    expect(screen.getByText(/الخطوة ٠ من ٤/)).toBeTruthy();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'أخفِ كلمات أكثر' }));
      expect(document.querySelectorAll('.play__cue')).toHaveLength(i + 1);
    }
    fireEvent.click(screen.getByRole('button', { name: 'أبقِ أوائل الحروف فقط' }));
    const cues = [...document.querySelectorAll('.play__cue')].map((c) => c.textContent!.replace('أول حرف: ', ''));
    expect(cues.sort()).toEqual(tilesOf(TEXTS[0]!).map(firstLetter).sort());
    // No word of the ayah is on the line any more.
    for (const w of tilesOf(TEXTS[0]!)) expect(line()).not.toContain(w);
  });
});

describe('The ayah number (رقم الآية)', () => {
  it('consecutive numbers, the answer anywhere among them; an ayah whose words repeat is never asked', () => {
    const at = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const asks = planNumbers(AYAHS, AYAHS, KNOBS['9-12'], seed);
      for (const a of asks) {
        if (a.kind === 'number') {
          expect(a.options).toHaveLength(4);
          expect(a.options).toContain(a.ayah.ayah);
          for (let k = 1; k < a.options.length; k++) expect(a.options[k]).toBe(a.options[k - 1]! + 1);
          expect(a.options[0]).toBeGreaterThanOrEqual(1);
          expect(a.options[3]).toBeLessThanOrEqual(8);
          at.add(a.options.indexOf(a.ayah.ayah));
          expect([1, 6]).not.toContain(a.ayah.ayah);
        } else {
          expect(a.first.ayah).toBe(Math.min(a.pair[0].ayah, a.pair[1].ayah));
          expect(Math.abs(a.pair[0].ayah - a.pair[1].ayah)).toBeGreaterThanOrEqual(2);
          for (const p of a.pair) expect([1, 6]).not.toContain(p.ayah);
        }
      }
      expect(asks.map((a) => a.kind).slice(0, 2)).toEqual(['number', 'first']);
    }
    expect([...at].sort()).toEqual([0, 1, 2, 3]);
  });

  it('the ayah carries no number until answered; a wrong number is refused, then the answer is shown', () => {
    render(<AyahNumber {...props({ ayahs: AYAHS.slice(1, 3), band: '9-12' })} />);
    expect(screen.queryByText(/^الآية/)).toBeNull();
    const group = screen.getByRole('group', { name: 'الأرقام' });
    fireEvent.click(within(group).getAllByRole('button').find((b) => b.textContent !== '٢')!);
    expect(screen.getByText('✓ هذه هي')).toBeTruthy();
    expect(document.querySelector('.play-card__shape')!.textContent).toContain('٢');
  });
});
