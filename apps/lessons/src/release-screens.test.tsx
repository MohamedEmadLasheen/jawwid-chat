import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';
import { SurahLesson } from './lesson/SurahLesson';
import { ArabicLesson } from './arabic/ArabicLesson';
import { ReadingLesson } from './reading/ReadingLesson';
import { snapshot } from './test/fixtures';

/**
 * A family build ships a pending lesson only as {"withheld":true} (plus its kind;
 * src/content/release.ts). Each screen shows it as today's "under review", never
 * as a file that failed its checks, and lesson 5 still opens the reading screen.
 * What the family build ships for each lesson today, by lesson number:
 */
vi.mock('./arabic/index', () => ({
  arabicLessonFor: (n: number) => (n === 5 ? { withheld: true, kind: 'reading' } : [1, 3, 6, 7].includes(n) ? { withheld: true } : null),
}));
// Which screen App chose: each real screen, inside a marker.
vi.mock('./reading/ReadingLesson', async (importOriginal) => {
  const real = await importOriginal<typeof import('./reading/ReadingLesson')>();
  return { ReadingLesson: (p: { lesson: number }) => <div data-screen="reading"><real.ReadingLesson {...p} /></div> };
});
vi.mock('./arabic/ArabicLesson', async (importOriginal) => {
  const real = await importOriginal<typeof import('./arabic/ArabicLesson')>();
  return { ArabicLesson: (p: { lesson: number }) => <div data-screen="letters"><real.ArabicLesson {...p} /></div> };
});

const UNDER_REVIEW = 'هذا الدرس قيد المراجعة.';

describe('a withheld lesson in the family build', () => {
  it('lesson 5 (a reading lesson) still routes to the reading screen, which says "under review"', () => {
    const { container } = render(<App pathname="/lessons/arabic/lesson-5" />);
    expect(container.querySelector('[data-screen]')?.getAttribute('data-screen')).toBe('reading');
    expect(screen.getByRole('status').textContent).toBe(UNDER_REVIEW);
    expect(screen.queryByRole('alert')).toBeNull(); // never «تعذّر التحقق»
  });

  it('the letter lessons route to the letters screen, which says "under review"', () => {
    for (const n of [1, 3, 6, 7]) {
      const { container, unmount } = render(<App pathname={`/lessons/arabic/lesson-${n}`} />);
      expect(container.querySelector('[data-screen]')?.getAttribute('data-screen')).toBe('letters');
      expect(screen.getByRole('status').textContent).toBe(UNDER_REVIEW);
      expect(screen.queryByRole('alert')).toBeNull();
      unmount();
    }
  });

  it('each screen given the stub directly shows "under review"', () => {
    for (const el of [<ArabicLesson lesson={1} content={{ withheld: true }} />, <ReadingLesson lesson={5} content={{ withheld: true, kind: 'reading' }} />]) {
      const { unmount } = render(el);
      expect(screen.getByRole('status').textContent).toBe(UNDER_REVIEW);
      expect(screen.queryByRole('alert')).toBeNull();
      unmount();
    }
  });

  it('a surah lesson shows the verified Quran and "content under review", as for a pending file', async () => {
    const { fetcher, anchor } = await snapshot(85, 22, { basmala: true });
    render(<SurahLesson surah={85} fetcher={fetcher} anchor={anchor} content={{ withheld: true }} />);
    expect(await screen.findByRole('heading', { name: 'سورة البروج' })).toBeTruthy();
    expect(screen.getByText('محتوى الدرس قيد المراجعة، فعُرض نص السورة وحده.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(22);
  });
});
