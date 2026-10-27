import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SurahLesson } from './SurahLesson';
import { App } from '../App';
import { snapshot } from '../test/fixtures';
import type { Ayah } from '../quran/dataset';

describe('a surah lesson', () => {
  it('every surah gets the same section header, the Basmala on its own line, and no audio yet', async () => {
    const { fetcher } = await snapshot(85, 22, { basmala: true });
    render(<SurahLesson surah={85} fetcher={fetcher} />);
    expect(await screen.findByRole('heading', { name: 'سورة البروج' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'أقسام الدرس' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['الاستماع', 'الآيات', 'رتّب الآيات']);
    expect(screen.getByText('BASMALA').className).toBe('basmala');
    expect(screen.getAllByRole('listitem')[0]!.textContent).toMatch(/^verse 85:1/);
    expect(screen.getByRole('note').textContent).toMatch(/التلاوة غير متاحة بعد/);
  });

  it('a star per section, once', async () => {
    const { fetcher } = await snapshot(85, 22, { basmala: true });
    render(<SurahLesson surah={85} fetcher={fetcher} />);
    const finish = await screen.findByRole('button', { name: 'أنهيت الاستماع' });
    fireEvent.click(finish);
    fireEvent.click(finish);
    expect(screen.getByLabelText('النجوم').textContent).toBe('★☆☆');
  });

  it('shows nothing of a surah whose text does not verify', async () => {
    const { files, fetcher } = await snapshot(85, 22, { basmala: true });
    (files['/data/quran/surah-085.json'] as { ayahs: Ayah[] }).ayahs[2]!.text = 'changed';
    render(<SurahLesson surah={85} fetcher={fetcher} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/تعذّر التحقق/);
    expect(screen.queryByText(/verse 85/)).toBeNull();
  });
});

describe('routes', () => {
  it('keeps the lessons site\'s paths and refuses anything else', () => {
    render(<App pathname="/lessons/quran/surah-0" />);
    expect(screen.getByRole('alert').textContent).toMatch(/غير موجود/);
  });
});
