import { describe, expect, it } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SurahLesson } from './SurahLesson';
import { App } from '../App';
import { BASMALA, snapshot } from '../test/fixtures';
import type { AudioFactory, Playable } from '../audio/audio-controller';
import { resolveContent, type LessonContent } from '../content/lesson-content';
import { contentFor } from '../content';
import { loadSurah, type Fetcher, type QuranAnchor } from '../quran/dataset';
// The real verified snapshot, built by CI before the tests (scripts/lessons/build-quran-snapshot.py).
import realManifest from '../../public/data/quran/manifest.json';
import realSurah from '../../public/data/quran/surah-085.json';
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

  it('a LONG surah (all 114 now): Verses and Listen show 20 ayat a page, and ordering plays the page shown', async () => {
    const { fetcher, anchor } = await snapshot(2, 60, { basmala: true });
    render(<SurahLesson surah={2} fetcher={fetcher} anchor={anchor} content={null} />);
    await screen.findByRole('navigation', { name: 'صفحات السورة' });
    const range = () => within(screen.getByRole('navigation', { name: 'صفحات السورة' })).getByRole('status').textContent;
    const verses = () => screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(range()).toBe('الآيات ١–٢٠ من ٦٠');
    expect(verses()).toHaveLength(20);
    expect(verses()[0]).toMatch(/^verse 2:1/);
    expect(screen.getByText(BASMALA)).toBeTruthy(); // above ayah 1, on page 1
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    expect(range()).toBe('الآيات ٢١–٤٠ من ٦٠');
    expect(verses()[0]).toMatch(/^verse 2:21/);
    expect(screen.queryByText(BASMALA)).toBeNull();
    // Ordering plays the page shown, in rounds of 5: ayat 21-25 first, never 1-5.
    fireEvent.click(screen.getByRole('button', { name: 'رتّب الآيات' }));
    expect(screen.getByText(/الجولة ١ من ٤/)).toBeTruthy();
    const asked = [...document.querySelectorAll('.card')].map((c) => Number(c.getAttribute('data-ayah'))).sort((a, b) => a - b);
    expect(asked).toEqual([21, 22, 23, 24, 25]);
    expect((screen.getByRole('button', { name: 'التالي' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    expect((screen.getByRole('button', { name: 'التالي' }) as HTMLButtonElement).disabled).toBe(true); // the last page
  });

  it('a surah of up to 50 ayat has no pages: every ayah at once, as before', async () => {
    const { fetcher, anchor } = await snapshot(78, 40, { basmala: true });
    render(<SurahLesson surah={78} fetcher={fetcher} anchor={anchor} content={null} />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('navigation', { name: 'صفحات السورة' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(40);
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

// Stand-in verses (not Quran text) and content for them.
const TEXTS = ['أحد اثنان ثلاثة', 'أربعة خمسة', 'ستة سبعة ثمانية تسعة'];
const CONTENT: LessonContent = {
  surah: 85,
  datasetId: 'tanzil-uthmani-1.1',
  review: { status: 'approved', by: 'Teachers department', note: '' },
  provenance: {},
  intro: { text: 'مقدمة الدرس', review: null },
  tafsir: [
    { ayah: 1, text: 'شرح الأولى', review: null },
    { ayah: 2, text: 'شرح فيه شك', review: 'unsure' },
    { ayah: 3, text: null, review: 'missing' },
  ],
  words: [{ ayah: 1, word: 3, meaning: 'معنى الكلمة', review: null }],
  complete: [{ ayah: 1, word: 3 }, { ayah: 2, word: 2 }, { ayah: 3, word: 4 }],
  quiz: [{ id: 'q1', category: 'hifz', question: 'ما أول آية؟', options: [{ ayah: 1 }, { ayah: 2 }], answer: 0, review: null }],
  lessons: [{ text: 'درس مستفاد', review: null }],
  reflection: { question: 'سؤال التأمل', ideas: ['فكرة'], review: null },
  didYouKnow: [{ text: 'هل تعلم هذا', review: null }],
};

describe('a lesson with reviewed content', () => {
  const sections = () => within(screen.getByRole('navigation', { name: 'أقسام الدرس' })).getAllByRole('button').map((b) => b.textContent);

  it('PENDING review shows nothing beyond the verified Quran: no prose, no content sections', async () => {
    const { fetcher, anchor } = await snapshot(85, 3, { basmala: true, texts: TEXTS });
    const pending = { ...CONTENT, review: { status: 'pending' as const, by: null, note: '' } };
    render(<SurahLesson surah={85} fetcher={fetcher} anchor={anchor} content={pending} />);
    await screen.findByRole('heading', { name: 'سورة البروج' });
    expect(sections()).toEqual(['الاستماع', 'الآيات', 'رتّب الآيات']);
    expect(screen.getByText(/محتوى الدرس قيد المراجعة/)).toBeTruthy();
    expect(screen.queryByText('مقدمة الدرس')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'الآيات' }));
    fireEvent.click(screen.getAllByRole('listitem')[0]!.querySelector('button')!);
    expect(screen.queryByTestId('tafsir')).toBeNull();
    expect(screen.queryByText('شرح الأولى')).toBeNull();
  });

  it('the real Al-Buruj file resolves on the real verified text, but is pending, so only the Quran is shown', async () => {
    const fetcher: Fetcher = async (path) =>
      structuredClone(path.endsWith('manifest.json') ? realManifest : path.endsWith('surah-085.json') ? realSurah : null);
    const anchor: QuranAnchor = {
      datasetId: realManifest.datasetId,
      fileSha256: realManifest.fileSha256,
      rangeSha256: realManifest.surahs.map((x) => x.rangeSha256),
    };
    const s = await loadSurah(85, fetcher, anchor);
    expect(resolveContent(contentFor(85), s)).toMatchObject({ approved: false, held: 18 });
    render(<SurahLesson surah={85} fetcher={fetcher} anchor={anchor} />);
    expect(await screen.findAllByRole('listitem')).toHaveLength(22);
    expect(sections()).toEqual(['الاستماع', 'الآيات', 'رتّب الآيات']);
    expect(screen.getByText(/محتوى الدرس قيد المراجعة/)).toBeTruthy();
  });

  it('APPROVED: adds its sections and its prose, shows the tafsir under the selected ayah, and still never a flagged line', async () => {
    const { fetcher, anchor } = await snapshot(85, 3, { basmala: true, texts: TEXTS });
    render(<SurahLesson surah={85} fetcher={fetcher} anchor={anchor} content={CONTENT} shuffleSeed={1} />);
    await screen.findByRole('heading', { name: 'سورة البروج' });
    expect(sections()).toEqual(['الاستماع', 'الآيات', 'المعاني', 'أكمل الآية', 'رتّب الآيات', 'الاختبار', 'الفوائد']);
    expect(screen.getByText('مقدمة الدرس')).toBeTruthy();
    expect(screen.getByLabelText('النجوم').textContent).toBe('☆'.repeat(7));
    fireEvent.click(screen.getByRole('button', { name: 'الآيات' }));
    fireEvent.click(screen.getAllByRole('listitem')[0]!.querySelector('button')!);
    expect(screen.getByTestId('tafsir').textContent).toBe('شرح الأولى');
    fireEvent.click(screen.getAllByRole('listitem')[1]!.querySelector('button')!);
    expect(screen.getByTestId('tafsir').textContent).toMatch(/قيد المراجعة/);
    expect(screen.queryByText('شرح فيه شك')).toBeNull();
  });

  it('the meanings show each word cut from the verified verse', async () => {
    const { fetcher, anchor } = await snapshot(85, 3, { basmala: true, texts: TEXTS });
    render(<SurahLesson surah={85} fetcher={fetcher} anchor={anchor} content={CONTENT} shuffleSeed={1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'المعاني' }));
    const row = screen.getByRole('listitem');
    expect(row.textContent).toMatch(/ثلاثة/);
    expect(row.textContent).toMatch(/معنى الكلمة/);
    fireEvent.click(screen.getByRole('button', { name: 'أنهيت المعاني' }));
    expect(screen.getByLabelText('النجوم').textContent).toBe('★' + '☆'.repeat(6));
  });

  it('refuses content whose positions do not resolve: the Quran sections only, and says so', async () => {
    const { fetcher, anchor } = await snapshot(85, 3, { basmala: true, texts: TEXTS });
    const bad = { ...CONTENT, words: [{ ayah: 3, word: 9, meaning: 'x', review: null }] };
    render(<SurahLesson surah={85} fetcher={fetcher} anchor={anchor} content={bad} />);
    await screen.findByRole('heading', { name: 'سورة البروج' });
    expect(sections()).toEqual(['الاستماع', 'الآيات', 'رتّب الآيات']);
    expect(screen.getByText(/محتوى الدرس قيد المراجعة/)).toBeTruthy();
    expect(screen.queryByText('مقدمة الدرس')).toBeNull();
  });

  it('a surah with no content gets the three Quran sections and no note', async () => {
    const { fetcher, anchor } = await snapshot(86, 3, { basmala: true, texts: TEXTS });
    render(<SurahLesson surah={86} fetcher={fetcher} anchor={anchor} content={null} />);
    await screen.findByRole('heading');
    expect(sections()).toEqual(['الاستماع', 'الآيات', 'رتّب الآيات']);
    expect(screen.queryByText(/محتوى الدرس قيد المراجعة/)).toBeNull();
  });
});
