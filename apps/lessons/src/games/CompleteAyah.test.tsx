import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CompleteAyah, optionsFor } from './CompleteAyah';
import type { Ayah } from '../quran/dataset';

// Stand-in verses (not Quran text).
const ayahs: Ayah[] = ['أحد اثنان ثلاثة', 'أربعة خمسة', 'ستة سبعة ثمانية تسعة'].map((text, i) => ({ ayah: i + 1, basmala: null, text, sha256: 'x' }));
const items = [
  { ayah: 1, word: 3, text: 'ثلاثة' },
  { ayah: 2, word: 1, text: 'أربعة' },
  { ayah: 3, word: 4, text: 'تسعة' },
];

const choose = (word: string) => fireEvent.click(within(screen.getByRole('group', { name: 'الاختيارات' })).getByRole('button', { name: word }));

describe('complete the ayah', () => {
  it('each round offers the answer and two other game words, never the same word twice', () => {
    for (let i = 0; i < items.length; i++) {
      const opts = optionsFor(items, i, 7);
      expect(opts).toHaveLength(3);
      expect(new Set(opts).size).toBe(3);
      expect(opts).toContain(items[i]!.text);
    }
  });

  it('shows the verified verse with the word hidden; a wrong pick may be retried', () => {
    const done = vi.fn();
    render(<CompleteAyah ayahs={ayahs} items={items} seed={3} onComplete={done} />);
    expect(screen.getByTestId('complete-verse').textContent).toBe('أحد اثنان ____');
    const wrong = optionsFor(items, 0, 3).find((w) => w !== 'ثلاثة')!;
    choose(wrong);
    expect(screen.getByRole('status').textContent).toMatch(/حاول مرة أخرى/);
    choose('ثلاثة');
    expect(screen.getByRole('status').textContent).toMatch(/أحسنت/);
    expect(screen.getByTestId('complete-verse').textContent).toBe('أحد اثنان ثلاثة');
    expect(done).not.toHaveBeenCalled();
  });

  it('is complete only after every word is found, once', () => {
    const done = vi.fn();
    render(<CompleteAyah ayahs={ayahs} items={items} seed={3} onComplete={done} />);
    for (const [i, item] of items.entries()) {
      choose(item.text);
      if (i < items.length - 1) fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    }
    expect(done).toHaveBeenCalledTimes(1);
    choose(items[2]!.text);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
