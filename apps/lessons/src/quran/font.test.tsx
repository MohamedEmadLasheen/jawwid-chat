import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuranFontGate, loadQuranFont, type Fonts } from './font';

const face = (family: string, status = 'loaded') => ({ family, status });
/** A font set whose load() answers `answers` in turn. */
const fonts = (...answers: Array<Array<{ family: string; status: string }> | Error>): Fonts => ({
  ready: Promise.resolve(),
  load: async () => {
    const a = answers.shift() ?? [];
    if (a instanceof Error) throw a;
    return a;
  },
});

describe('the Quran font: Amiri Quran or no verse at all', () => {
  it('is ready only when the browser reports Amiri Quran itself loaded', async () => {
    expect(await loadQuranFont(fonts([face('"Amiri Quran"')]))).toBe(true);
    expect(await loadQuranFont(fonts([face('Amiri Quran')]))).toBe(true);
    // The stylesheet arrived late: the second ask finds it.
    expect(await loadQuranFont(fonts([], [face('Amiri Quran')]))).toBe(true);
    // Not loaded, another face, an error, no font set: never.
    expect(await loadQuranFont(fonts([face('Amiri Quran', 'error')], []))).toBe(false);
    expect(await loadQuranFont(fonts([face('Amiri')], [face('serif')]))).toBe(false);
    expect(await loadQuranFont(fonts(new Error('network')))).toBe(false);
    expect(await loadQuranFont(undefined)).toBe(false);
  });

  it('shows nothing of the page until the font has loaded', async () => {
    let resolve!: (ok: boolean) => void;
    const pending = new Promise<boolean>((r) => (resolve = r));
    render(
      <QuranFontGate load={() => pending}>
        <p>آية</p>
      </QuranFontGate>,
    );
    expect(screen.getByRole('status').textContent).toBe('جارٍ تحميل خطّ المصحف…');
    expect(screen.queryByText('آية')).toBeNull();
    resolve(true);
    expect(await screen.findByText('آية')).toBeTruthy();
  });

  it('if the font cannot load: no verse, never a blank screen -- a calm message and a retry', async () => {
    const retry = vi.fn();
    render(
      <QuranFontGate load={async () => false} retry={retry}>
        <p>آية</p>
      </QuranFontGate>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe('تعذّر تحميل خطّ المصحف.');
    expect(screen.queryByText('آية')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
