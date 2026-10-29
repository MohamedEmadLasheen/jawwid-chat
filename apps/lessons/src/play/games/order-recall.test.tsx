import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Ayah } from '../../quran/dataset';
import { KNOBS } from '../adapt';
import { BuildAyah, MAX_TILES, buildable, planBuilds } from './BuildAyah';
import { NextAyah, planAsks } from './NextAyah';
import { OrderAyat, planOrders, windows } from './OrderAyat';
import { StartEnd, planPairs } from './StartEnd';
import { tilesOf } from './common';

// Stand-in verses (not Quran), of 3 to 8 words, one with a pause mark after a word.
const TEXTS = [
  'ألف باء تاء ثاء',
  'جيم حاء ۚ خاء دال ذال',
  'راء زاي سين شين',
  'صاد ضاد طاء ظاء عين',
  'غين فاء قاف كاف',
  'لام ميم نون هاء واو',
  'ياء همزة باء تاء ثاء جيم حاء خاء',
  'سين شين صاد',
];
const AYAHS: Ayah[] = TEXTS.map((text, i) => ({ ayah: i + 1, basmala: null, text, sha256: '' }));
const props = (over: Record<string, unknown> = {}) => ({ surah: 1, ayahs: AYAHS.slice(0, 4), pool: AYAHS, audio: null, band: '6-8' as const, seed: 3, onComplete: vi.fn(), ...over });
const verses = () => [...document.querySelectorAll('.play-card__verse')].map((v) => v.textContent);

describe('tiles: the words of a verse, never changed', () => {
  it('a pause mark stays with the word before it, and the tiles joined ARE the verse', () => {
    expect(tilesOf(TEXTS[1]!)).toEqual(['جيم', 'حاء ۚ', 'خاء', 'دال', 'ذال']);
    for (const t of TEXTS) expect(tilesOf(t).join(' ')).toBe(t);
  });
});

describe('Build the ayah (ركّب الآية)', () => {
  it("only the ayah's own words, 3-6 of them for 6-8, never offered in their order; 6-8 starts with the first placed", () => {
    expect(buildable(AYAHS, '6-8').map((a) => a.ayah)).toEqual([1, 2, 3, 4, 5, 6, 8]);
    expect(buildable(AYAHS, '9-12').map((a) => a.ayah)).toContain(7);
    expect(MAX_TILES['3-5']).toBe(0);
    for (let seed = 0; seed < 30; seed++) {
      for (const b of planBuilds(AYAHS, '6-8', seed)) {
        expect(b.given).toBe(1);
        expect([...b.tray].sort()).toEqual(b.tiles.map((_, i) => i).slice(1));
        expect(b.tray.map((i) => b.tiles[i])).not.toEqual(b.tiles.slice(1));
      }
    }
  });

  it('a tile out of turn is refused where it sits: the line only ever holds the ayah in order; then the whole ayah', () => {
    const onComplete = vi.fn();
    render(<BuildAyah {...props({ onComplete })} />);
    for (let r = 0; r < 3; r++) {
      const tiles = tilesOf(AYAHS[r]!.text);
      for (let k = 1; k < tiles.length; k++) {
        const line = () => [...document.querySelectorAll('.play__slot:not(.play__slot--empty)')].map((x) => x.textContent);
        expect(line()).toEqual(tiles.slice(0, k));
        // The line reads as words, with spaces between them (for a screen reader and a copy).
        const shown = document.querySelector('.play__line')!.cloneNode(true) as HTMLElement;
        shown.querySelectorAll('.sr-only').forEach((x) => x.remove());
        expect(shown.textContent!.trim()).toBe(tiles.slice(0, k).join(' '));
        // ...and tells a screen reader how far it is built.
        expect(document.querySelector('.play__line .sr-only')!.textContent).toBe(`الكلمات المرتّبة: ${(k).toLocaleString('ar-EG')} من ${tiles.length.toLocaleString('ar-EG')}: `);
        // Blanks for what is not built yet.
        expect(document.querySelectorAll('.play__slot--empty')).toHaveLength(tiles.length - k);
        const group = screen.getByRole('group', { name: 'الكلمات' });
        const wrong = within(group).getAllByRole('button').find((b) => !b.textContent!.startsWith(tiles[k]!));
        if (wrong) {
          fireEvent.click(wrong);
          expect(line()).toEqual(tiles.slice(0, k));
          expect(wrong.isConnected).toBe(true);
          // 6-8: one try, then the next word is shown.
          expect(screen.getByText('✓ هذه هي')).toBeTruthy();
        }
        fireEvent.click(within(group).getAllByRole('button').find((b) => b.textContent!.startsWith(tiles[k]!))!);
      }
      expect(verses()).toEqual([AYAHS[r]!.text]);
      expect(screen.getByText('✓ أحسنت')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    }
    // 6-8 keeps no score: praise, and the sitting moves on.
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('9-12 starts from nothing, and ends with a list of the ayat to review, then moves on when the child is ready', () => {
    const onComplete = vi.fn();
    render(<BuildAyah {...props({ band: '9-12', ayahs: AYAHS.slice(0, 1), onComplete })} />);
    const tiles = tilesOf(AYAHS[0]!.text);
    expect(document.querySelectorAll('.play__slot--empty')).toHaveLength(tiles.length);
    const group = screen.getByRole('group', { name: 'الكلمات' });
    fireEvent.click(within(group).getAllByRole('button').find((b) => b.textContent !== tiles[0])!);
    for (const t of tiles) fireEvent.click(within(group).getAllByRole('button').find((b) => b.textContent!.startsWith(t))!);
    fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    expect(screen.getByRole('region', { name: 'لنراجع هذه الآيات' })).toBeTruthy();
    expect(verses()).toEqual([AYAHS[0]!.text]);
    expect(onComplete).not.toHaveBeenCalled();
    const ready = screen.getByRole('button', { name: /التالي/ });
    fireEvent.click(ready);
    // Once only, however often it is touched.
    fireEvent.click(ready);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('Order the ayat (رتّب الآيات)', () => {
  it('3-5: neighbouring pairs, the first not always in one place; the cards carry no number', () => {
    const at = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      for (const o of planOrders(AYAHS.slice(0, 3), AYAHS, '3-5', seed)) {
        expect(o.ayat).toHaveLength(2);
        expect(o.ayat[1]!.ayah).toBe(o.ayat[0]!.ayah + 1);
        at.add(o.shown.indexOf(o.ayat[0]!));
      }
    }
    expect([...at].sort()).toEqual([0, 1]);
    render(<OrderAyat {...props({ band: '3-5', ayahs: AYAHS.slice(0, 1) })} />);
    expect(screen.getByRole('button', { name: TEXTS[0] })).toBeTruthy();
    expect(screen.queryByText(/الآية/)).toBeNull();
  });

  it('3-5: after two tries the first is shown and praised; a child never fails', () => {
    const onComplete = vi.fn();
    render(<OrderAyat {...props({ band: '3-5', ayahs: AYAHS.slice(0, 1), onComplete })} />);
    const second = screen.getByRole('button', { name: TEXTS[1] });
    fireEvent.click(second);
    expect(screen.getByText('لنحاول مرة أخرى')).toBeTruthy();
    fireEvent.click(second);
    expect(screen.getByText('✓ هذه هي')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('6-8: a card out of turn is refused where it sits; the ordered list only ever holds the true order', () => {
    const onComplete = vi.fn();
    const ayahs = AYAHS.slice(0, 5);
    render(<OrderAyat {...props({ ayahs, onComplete })} />);
    const ordered = () => [...document.querySelectorAll('ol .play-card__verse')].map((v) => v.textContent);
    for (let k = 0; k < 4; k++) {
      expect(ordered()).toEqual(TEXTS.slice(0, k));
      const tray = screen.getByRole('group', { name: 'الآيات' });
      const wrong = within(tray).getAllByRole('button').find((b) => Number(b.dataset.ayah) !== k + 1)!;
      fireEvent.click(wrong);
      expect(ordered()).toEqual(TEXTS.slice(0, k));
      // The answer shown is named for what it is: the first ayah, then the next one.
      expect(screen.getByText(k === 0 ? 'هذه هي الآية الأولى' : 'هذه هي الآية التالية')).toBeTruthy();
      fireEvent.click(within(tray).getAllByRole('button').find((b) => Number(b.dataset.ayah) === k + 1)!);
    }
    // The last card has nowhere else to go.
    expect(ordered()).toEqual(TEXTS.slice(0, 5));
    expect(screen.getByText('أحسنت! هذا ترتيبها')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('a round never holds more cards than the band allows, and none is left with one', () => {
    expect(windows(7, 6).map((w) => w.length)).toEqual([4, 3]);
    expect(windows(6, 5).map((w) => w.length)).toEqual([3, 3]);
    expect(windows(11, 5).map((w) => w.length)).toEqual([4, 4, 3]);
    expect(windows(5, 5)).toEqual([[1, 2, 3, 4, 5]]);
    expect(windows(1, 5)).toEqual([]);
    for (let n = 2; n <= 40; n++) {
      for (const size of [5, 6]) {
        const w = windows(n, size);
        expect(w.flat()).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        for (const x of w) expect(x.length).toBeGreaterThanOrEqual(2), expect(x.length).toBeLessThanOrEqual(size);
      }
    }
  });

  it('3-5: each listen button names its card by its shape, in words', () => {
    const { controller } = { controller: { play: vi.fn(), stop: vi.fn() } };
    render(<OrderAyat {...props({ band: '3-5', ayahs: AYAHS.slice(0, 1), audio: controller })} />);
    expect(screen.getByRole('button', { name: /لنستمع إلى الآية التي في الدائرة/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /لنستمع إلى الآية التي في المثلث/ })).toBeTruthy();
  });

  it('two ayat with the same words are never asked to be told apart', () => {
    const twins = [...AYAHS.slice(0, 3), { ...AYAHS[3]!, text: TEXTS[0]! }];
    expect(planOrders(twins, twins, '6-8', 1)).toEqual([]);
    expect(planOrders([twins[2]!], twins, '3-5', 1)[0]!.ayat.map((a) => a.ayah)).toEqual([3, 4]);
    expect(planOrders([twins[0]!], [twins[0]!, { ...twins[1]!, text: TEXTS[0]! }], '3-5', 1)).toEqual([]);
  });
});

describe('Start and end (بداية ونهاية)', () => {
  it('each half is cut from a real ayah at a word boundary; the halves of a pair ARE the ayah', () => {
    const pairs = planPairs(AYAHS.slice(0, 2), AYAHS, '6-8', 1);
    expect(pairs).toHaveLength(3);
    // The segment's ayat first (in a drawn order), then the nearest.
    expect(pairs.slice(0, 2).map((p) => p.ayah.ayah).sort()).toEqual([1, 2]);
    expect(pairs[2]!.ayah.ayah).toBe(3);
    for (const p of planPairs(AYAHS, AYAHS, '9-12', 1)) expect(`${p.start} ${p.end}`).toBe(p.ayah.text);
    expect(planPairs(AYAHS.slice(0, 2), AYAHS, '9-12', 1)).toHaveLength(5);
    // Fewer than two ayat long enough to cut: no game.
    expect(planPairs([AYAHS[7]!], [AYAHS[7]!, AYAHS[0]!], '6-8', 1)).toEqual([]);
  });

  it('drawn from the seed, like every game: the order changes with it', () => {
    const orders = new Set<string>();
    for (let seed = 0; seed < 20; seed++) orders.add(planPairs(AYAHS.slice(0, 4), AYAHS, '6-8', seed).map((p) => p.ayah.ayah).join());
    expect(orders.size).toBeGreaterThan(1);
  });

  it('9-12: the ends share the commonest rhyme first, so their last sound gives nothing away', () => {
    // Four ayat ending in nun, three in other letters (stand-ins, not Quran).
    const rhymed = ['ألف باء تاء نون', 'جيم حاء خاء دال', 'راء زاي سين نون', 'صاد ضاد طاء ظاء', 'غين فاء قاف نون', 'لام ميم هاء واو', 'ياء همزة باء نون']
      .map((text, i) => ({ ayah: i + 1, basmala: null, text, sha256: '' }));
    for (let seed = 0; seed < 10; seed++) {
      const pairs = planPairs(rhymed.slice(0, 2), rhymed, '9-12', seed);
      expect(pairs).toHaveLength(5);
      expect(pairs.slice(0, 4).map((p) => p.end.slice(-3))).toEqual(['نون', 'نون', 'نون', 'نون']);
    }
  });

  it('a wrong end is refused and nothing joined is shown; a match is the whole verified ayah', () => {
    const onComplete = vi.fn();
    render(<StartEnd {...props({ onComplete })} />);
    const pairs = planPairs(AYAHS.slice(0, 4), AYAHS, '6-8', 3);
    const starts = () => screen.getByRole('group', { name: 'البدايات' });
    const ends = () => screen.getByRole('group', { name: 'النهايات' });
    fireEvent.click(within(ends()).getAllByRole('button')[0]!);
    expect(screen.getByText('لنختر بداية أولًا')).toBeTruthy();
    for (const [n, p] of pairs.entries()) {
      fireEvent.click(within(starts()).getByRole('button', { name: `بداية آية: ${p.start}` }));
      const other = pairs.find((q) => q !== p && within(ends()).queryByRole('button', { name: `نهاية آية: ${q.end}` }));
      if (other) {
        fireEvent.click(within(ends()).getByRole('button', { name: `نهاية آية: ${other.end}` }));
        expect(screen.getByText('هذه هي نهايتها')).toBeTruthy();
        // Nothing assembled: only the matched ayat are shown as verses.
        expect(verses()).toEqual(pairs.slice(0, n).map((q) => q.ayah.text).sort((a, b) => TEXTS.indexOf(a) - TEXTS.indexOf(b)));
      }
      fireEvent.click(within(ends()).getByRole('button', { name: new RegExp(`نهاية آية: ${p.end}`) }));
    }
    expect(verses()).toEqual([...pairs].sort((x, y) => x.ayah.ayah - y.ayah.ayah).map((p) => p.ayah.text));
    fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('What comes next? (ما الآية التالية؟)', () => {
  it('6-8: three whole, real choices, the answer among them, never a neighbour as a wrong one', () => {
    const at = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      for (const a of planAsks(AYAHS.slice(0, 4), AYAHS, KNOBS['6-8'], seed)) {
        expect(a.way).toBe('next');
        expect(a.answer.ayah).toBe(a.prompt.ayah + 1);
        expect(a.options).toHaveLength(3);
        for (const o of a.options) expect(AYAHS).toContain(o);
        for (const o of a.options.filter((o) => o !== a.answer)) {
          expect(Math.min(Math.abs(o.ayah - a.prompt.ayah), Math.abs(o.ayah - a.answer.ayah))).toBeGreaterThan(1);
        }
        at.add(a.options.indexOf(a.answer));
      }
    }
    expect([...at].sort()).toEqual([0, 1, 2]);
  });

  it('9-12: the nearest ayat are the wrong choices, and every other question asks what comes before', () => {
    const asks = planAsks(AYAHS.slice(1, 7), AYAHS, KNOBS['9-12'], 5);
    expect(asks.map((a) => a.way)).toEqual(['next', 'previous', 'next', 'previous', 'next', 'previous']);
    for (const a of asks) {
      expect(a.answer.ayah).toBe(a.prompt.ayah + (a.way === 'next' ? 1 : -1));
      expect(a.options).toHaveLength(4);
    }
  });

  it('a refrain never makes two right answers, asking "next" or "before" (as Ar-Rahman 55:16-19)', () => {
    // R is a refrain (stand-in): ayat 2, 4 and 6 have the same words, so 3, 5 and 7 each follow it.
    const R = 'فاء باء ألف راء';
    const refrain = ['ألف باء تاء ثاء', R, 'جيم حاء خاء دال', R, 'راء زاي سين شين', R, 'صاد ضاد طاء ظاء', 'غين فاء قاف كاف', 'لام ميم نون هاء']
      .map((text, i) => ({ ayah: i + 1, basmala: null, text, sha256: '' }));
    const by = new Map(refrain.map((a) => [a.ayah, a]));
    for (const band of ['6-8', '9-12'] as const) {
      for (let seed = 0; seed < 40; seed++) {
        for (const a of planAsks(refrain, refrain, KNOBS[band], seed)) {
          // The refrain is never the prompt.
          expect(a.prompt.text).not.toBe(R);
          // Exactly one choice is next to (or just before) an ayah with the prompt's words: the answer.
          const step = a.way === 'next' ? -1 : 1;
          const right = a.options.filter((o) => by.get(o.ayah + step)?.text === a.prompt.text);
          expect(right).toEqual([a.answer]);
        }
      }
    }
  });

  it('the choices carry no number until answered; a wrong one is refused, then the answer is shown', () => {
    const onComplete = vi.fn();
    render(<NextAyah {...props({ ayahs: AYAHS.slice(0, 1), onComplete })} />);
    const group = () => screen.getByRole('group', { name: 'الاختيارات' });
    expect(within(group()).queryByText(/الآية/)).toBeNull();
    fireEvent.click(within(group()).getAllByRole('button').find((b) => Number(b.dataset.ayah) !== 2)!);
    expect(screen.getByText('✓ هذه هي')).toBeTruthy();
    expect(within(group()).getAllByText(/الآية/).length).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
