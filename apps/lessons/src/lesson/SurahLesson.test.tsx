import { describe, expect, it } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SurahLesson } from './SurahLesson';
import { App } from '../App';
import { BASMALA, snapshot } from '../test/fixtures';
import type { AudioFactory, Playable } from '../audio/audio-controller';
import type { Ayah } from '../quran/dataset';

describe('a surah lesson', () => {
  it('every surah gets the same section header, the Basmala on its own line, and no audio yet', async () => {
    const { fetcher, anchor } = await snapshot(85, 22, { basmala: true });
    render(<SurahLesson surah={85} fetcher={fetcher} anchor={anchor} />);
    expect(await screen.findByRole('heading', { name: 'سورة البروج' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'أقسام الدرس' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['الاستماع', 'الآيات', 'رتّب الآيات']);
    expect(screen.getByText(BASMALA).className).toBe('basmala');
    expect(screen.getAllByRole('listitem')[0]!.textContent).toMatch(/^verse 85:1/);
    expect(screen.getByRole('note').textContent).toMatch(/التلاوة غير متاحة بعد/);
  });

  it('the listening star cannot be earned while recitation is off', async () => {
    const { fetcher, anchor } = await snapshot(85, 22, { basmala: true });
    render(<SurahLesson surah={85} fetcher={fetcher} anchor={anchor} />);
    const finish = (await screen.findByRole('button', { name: 'أنهيت الاستماع' })) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    fireEvent.click(finish);
    expect(screen.getByLabelText('النجوم').textContent).toBe('☆☆☆');
  });

  it('a star per section, once: the listening star after an ayah was actually played', async () => {
    const { fetcher, anchor } = await snapshot(85, 22, { basmala: true });
    const played: string[] = [];
    const factory: AudioFactory = (url) => {
      const p: Playable = { play: async () => { played.push(url); }, pause: () => {}, currentTime: 0, onended: null };
      return p;
    };
    const source = (s: number, a: number) => `/audio/${s}/${a}.mp3`;
    // StrictMode mounts, unmounts and mounts again: the live controller must still play.
    render(<StrictMode><SurahLesson surah={85} fetcher={fetcher} anchor={anchor} audioSource={source} audioFactory={factory} /></StrictMode>);
    const finish = (await screen.findByRole('button', { name: 'أنهيت الاستماع' })) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getAllByRole('listitem')[0]!.querySelector('button')!); });
    expect(played).toEqual(['/audio/85/1.mp3']);
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish);
    fireEvent.click(finish);
    expect(screen.getByLabelText('النجوم').textContent).toBe('★☆☆');
  });

  it('shows nothing of a surah whose text does not verify', async () => {
    const { files, fetcher, anchor } = await snapshot(85, 22, { basmala: true });
    (files['/data/quran/surah-085.json'] as { ayahs: Ayah[] }).ayahs[2]!.text = 'changed';
    render(<SurahLesson surah={85} fetcher={fetcher} anchor={anchor} />);
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
