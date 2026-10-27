import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { OrderAyat } from './OrderAyat';
import type { Ayah } from '../quran/dataset';

const ayahs = (texts: string[]): Ayah[] => texts.map((text, i) => ({ ayah: i + 1, basmala: null, text, sha256: 'x' }));
const shown = () => screen.getAllByRole('listitem').map((li) => Number(li.getAttribute('data-ayah')));

/** Move cards until they are in ayah order, using the ▲ buttons like a child would. */
function solve() {
  for (let pass = 0; pass < 10; pass++) {
    const order = shown();
    const i = order.findIndex((n, k) => k > 0 && n < order[k - 1]!);
    if (i < 0) return;
    fireEvent.click(within(screen.getAllByRole('listitem')[i]!).getByRole('button', { name: 'إلى الأعلى' }));
  }
}

describe('order the ayat', () => {
  it('the cards keep their order across re-renders and taps (no reshuffle in render)', () => {
    const { rerender } = render(<OrderAyat surah={85} ayahs={ayahs(['a', 'b', 'c', 'd', 'e'])} onComplete={() => {}} />);
    const before = shown();
    rerender(<OrderAyat surah={85} ayahs={ayahs(['a', 'b', 'c', 'd', 'e'])} onComplete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'تحقّق' }));
    expect(shown()).toEqual(before);
    expect(before).not.toEqual([1, 2, 3, 4, 5]);
  });

  it('checks by ayah number: identical words in two ayat cannot fail a correct order', () => {
    const done = vi.fn();
    render(<OrderAyat surah={109} ayahs={ayahs(['x', 'same words', 'y', 'same words'])} onComplete={done} />);
    solve();
    fireEvent.click(screen.getByRole('button', { name: 'تحقّق' }));
    expect(screen.getByRole('status').textContent).toMatch(/أحسنت/);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('walks every round of the surah before it is complete', () => {
    const done = vi.fn();
    render(<OrderAyat surah={85} ayahs={ayahs(Array.from({ length: 12 }, (_, i) => `t${i + 1}`))} onComplete={done} />);
    const seen: number[] = [];
    for (let r = 0; r < 3; r++) {
      solve();
      seen.push(...shown());
      fireEvent.click(screen.getByRole('button', { name: 'تحقّق' }));
      if (r < 2) fireEvent.click(screen.getByRole('button', { name: 'الجولة التالية' }));
    }
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(done).toHaveBeenCalledTimes(1);
  });
});
