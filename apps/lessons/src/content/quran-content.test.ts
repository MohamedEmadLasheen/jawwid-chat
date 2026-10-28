import { describe, expect, it } from 'vitest';
import pin from '../../quran-pin.json';
import { loadSurah, type Surah } from '../quran/dataset';
import { snapshot } from '../test/fixtures';
import realSources from './sources.json';
import vectors from './item-hash.vectors.json';
import {
  canonicalJson,
  itemSha256,
  passesAsbabRule,
  requiredSteps,
  resolveQuranContent,
  type Approvals,
  type Step,
  type Work,
} from './quran-content';

// Stand-in verses (not Quran), as in the checker's selftest.
const VERSES = ['ألف باء تاء ثاء', 'جيم حاء خاء', 'دال ذال راء زاي سين', 'شين صاد', 'قاف'];

async function surah(): Promise<Surah> {
  const s = await snapshot(112, VERSES.length, { texts: VERSES, basmala: true });
  return loadSurah(112, s.fetcher, s.anchor);
}

const PINNED = { printer: 'p', place: 'q', year: '1300', pages: 'vol/page', why: 'no modern apparatus' };
const work = (id: string, role: Work['role'], kinds: Work['kinds'], edition: unknown = PINNED): Work => ({ id, role, kinds, edition });
const WORKS: Work[] = [
  work('saadi', 'primary', ['intro', 'tafsir', 'tafsir_x', 'word', 'lesson', 'reflection', 'story', 'theme']),
  work('baghawi', 'cross-check', ['tafsir', 'word']),
  work('bukhari', 'report', ['asbab', 'story']),
  work('tirmidhi', 'report', ['asbab']),
  work('wahidi-asbab', 'pointer', ['asbab']),
  work('muzaini-muharrar', 'verdict', ['asbab']),
  work('wadii-sahih-musnad', 'verdict', ['asbab']),
];

function content() {
  return {
    schema: 2,
    surah: 112,
    datasetId: pin.datasetId,
    lessonKey: 'quran-112',
    retiredIds: ['lesson-009'],
    segments: [
      { id: 'seg-001', from: 1, to: 3, theme: 'theme-001' },
      { id: 'seg-002', from: 4, to: 5 },
    ],
    items: [
      { id: 'theme-001', kind: 'theme', bands: ['9-12'], text: 'موضوع', source: { work: 'saadi', ref: '112:1-3' } },
      { id: 'tafsir-001', kind: 'tafsir', bands: ['6-8', '9-12'], text: 'شرح {{w:1:2}} هنا', ayah: 1, source: { work: 'saadi', ref: '112:1' },
        crossCheck: { work: 'baghawi', ref: '112:1' } },
      { id: 'word-001', kind: 'word', bands: ['6-8'], text: 'معنى', ayah: 3, word: 2, to: 3, source: { work: 'saadi', ref: '112:3' } },
      { id: 'asbab-001', kind: 'asbab', bands: ['9-12'], text: 'سبب', ayat: [1, 2], source: { work: 'bukhari', ref: '1' },
        verdicts: [{ work: 'muzaini-muharrar', ref: '2/1', reason: 'is', chain: 'sahih' }] },
      { id: 'quiz-001', kind: 'quiz', bands: ['6-8'], text: 'ما معنى', category: 'meanings', word: { ayah: 3, word: 2, to: 3 },
        options: [{ text: 'معنى' }, { text: 'غيره' }], answer: 0, basis: ['word-001'] },
      { id: 'quiz-002', kind: 'quiz', bands: ['9-12'], text: 'أكمل', category: 'hifz', prompt: { ayah: 2, words: 2 },
        options: [{ ayah: 2, word: 3, to: 3 }, { ayah: 1 }], answer: 0, basis: [] },
    ],
  };
}

type Item = ReturnType<typeof content>['items'][number];

async function approve(items: Item[], steps: Step[] = ['check', 'teacher', 'scholar']): Promise<Approvals> {
  return { surah: 112, lessonKey: 'quran-112', approvals: await Promise.all(items.map(async (i) => ({ id: i.id, itemSha256: await itemSha256(i), steps }))) };
}

describe('the item hash', () => {
  it('matches the vectors the Python checker also verifies (canonical JSON, byte for byte)', async () => {
    for (const v of vectors) expect(await itemSha256(v.item)).toBe(v.sha256);
  });

  it('sorts keys at every level and ignores their order', () => {
    expect(canonicalJson({ b: [{ d: 1, c: 2 }], a: 'x' })).toBe('{"a":"x","b":[{"c":2,"d":1}]}');
  });
});

describe('the asbab display rule (plan A.3)', () => {
  const muharrar = { work: 'muzaini-muharrar', ref: '1', reason: 'is' as const };
  it('shows a report al-Muharrar calls the reason, in al-Bukhari, with nothing against it', () => {
    expect(passesAsbabRule({ work: 'bukhari', ref: '1' }, [muharrar])).toBe(true);
  });
  it('outside the two Sahihs, needs a judge to grade the chain sound', () => {
    expect(passesAsbabRule({ work: 'tirmidhi', ref: '1' }, [muharrar])).toBe(false);
    expect(passesAsbabRule({ work: 'tirmidhi', ref: '1' }, [{ ...muharrar, chain: 'hasan' }])).toBe(true);
  });
  it('shows nothing on any conflict: not the reason, or weak, mursal or fabricated anywhere', () => {
    const src = { work: 'bukhari', ref: '1' };
    expect(passesAsbabRule(src, [])).toBe(false);
    expect(passesAsbabRule(src, [{ work: 'wadii-sahih-musnad', ref: '1', chain: 'sahih' }])).toBe(false);
    expect(passesAsbabRule(src, [muharrar, { work: 'wadii-sahih-musnad', ref: '1', chain: 'mursal' }])).toBe(false);
    expect(passesAsbabRule(src, [muharrar, { work: 'wadii-sahih-musnad', ref: '1', reason: 'is-not' }])).toBe(false);
  });
});

describe('required review steps (plan F.2)', () => {
  it('the scholar signs everything but plain word meanings and hifz/meaning quizzes', () => {
    expect(requiredSteps({ kind: 'word' })).toEqual(['check', 'teacher']);
    expect(requiredSteps({ kind: 'word', aqeedah: true })).toContain('scholar');
    expect(requiredSteps({ kind: 'quiz', category: 'hifz' })).toEqual(['check', 'teacher']);
    expect(requiredSteps({ kind: 'quiz', category: 'tafsir' })).toContain('scholar');
    for (const kind of ['intro', 'tafsir', 'tafsir_x', 'lesson', 'reflection', 'story', 'theme', 'asbab'] as const) {
      expect(requiredSteps({ kind })).toContain('scholar');
    }
  });
});

describe('resolveQuranContent', () => {
  it('shows nothing without approvals: every item is held', async () => {
    const c = content();
    const r = await resolveQuranContent(c, await surah(), null, WORKS);
    expect(r?.items).toEqual([]);
    expect(r?.held).toBe(c.items.length);
    expect(r?.segments.map((s) => s.theme)).toEqual([null, null]);
  });

  it('shows approved items, with words drawn from the verified text', async () => {
    const c = content();
    const r = await resolveQuranContent(c, await surah(), await approve(c.items), WORKS);
    expect(r?.held).toBe(0);
    const byId = new Map(r!.items.map((i) => [i.id, i]));
    expect(byId.get('tafsir-001')?.text).toBe('شرح باء هنا');
    expect(byId.get('word-001')?.words).toBe('ذال راء');
    expect(byId.get('quiz-002')?.quiz).toEqual({ category: 'hifz', options: ['خاء', 'ألف باء تاء ثاء'], answer: 0, prompt: 'جيم حاء' });
    expect(r?.segments[0]?.theme).toBe('theme-001');
  });

  it('holds an item whose approval is stale, lacks a step, or cites an unpinned edition', async () => {
    const c = content();
    const a = await approve(c.items);
    a.approvals[1]!.itemSha256 = '0'.repeat(64); // tafsir-001: changed after approval
    a.approvals[2]!.steps = ['check']; // word-001: the teacher has not signed
    const unpinned = WORKS.map((w) => (w.id === 'muzaini-muharrar' ? { ...w, edition: null } : w));
    const r = await resolveQuranContent(c, await surah(), a, unpinned);
    const shown = r!.items.map((i) => i.id);
    expect(shown).not.toContain('tafsir-001');
    expect(shown).not.toContain('word-001');
    expect(shown).not.toContain('asbab-001'); // its verdict work has no pinned edition
    expect(shown).not.toContain('quiz-001'); // it rests on word-001, which is held
    expect(shown).toEqual(['theme-001', 'quiz-002']);
  });

  it('holds an asbab item that fails the display rule, even fully approved', async () => {
    const c = content();
    (c.items[3] as { verdicts: unknown[] }).verdicts.push({ work: 'wadii-sahih-musnad', ref: '3', chain: 'mursal' });
    const r = await resolveQuranContent(c, await surah(), await approve(c.items), WORKS);
    expect(r!.items.map((i) => i.id)).not.toContain('asbab-001');
  });

  it('with the real registry (no edition pinned yet), nothing that cites a source can show', async () => {
    const c = content();
    const r = await resolveQuranContent(c, await surah(), await approve(c.items), realSources.works as Work[]);
    // Only the hifz quiz: it cites no work (it is built from verified positions, like the verified-text games).
    expect(r!.items.map((i) => i.id)).toEqual(['quiz-002']);
  });

  it('refuses the whole file on one bad position, token, field, id or citation', async () => {
    const s = await surah();
    const bad: ((c: ReturnType<typeof content>) => void)[] = [
      (c) => ((c.items[1] as { ayah: number }).ayah = 6),
      (c) => ((c.items[1] as { text: string }).text = 'شرح {{w:4:3}}'),
      (c) => ((c.items[2] as { to: number }).to = 1),
      (c) => ((c.items[0] as Record<string, unknown>).quote = 'نص'),
      (c) => ((c.items[1] as { id: string }).id = 'word-002'),
      (c) => ((c.items[1] as { id: string }).id = 'theme-001'),
      (c) => (c.items[0]!.id = 'lesson-009'),
      (c) => ((c.items[1] as { source: unknown }).source = { work: 'muzaini-muharrar', ref: '1' }),
      (c) => ((c.items[3] as { source: unknown }).source = { work: 'wahidi-asbab', ref: '1' }),
      (c) => ((c.items[3] as { bands: string[] }).bands = ['6-8']),
      (c) => (c.segments[1]!.from = 5),
      (c) => ((c.items[0] as { text: string }).text = 'ا' + String.fromCodePoint(0x654)),
      (c) => ((c.items[4] as { basis: string[] }).basis = []),
      (c) => (c.lessonKey = 'quran-001'),
      (c) => (c.schema = 1),
    ];
    for (const mutate of bad) {
      const c = content();
      mutate(c);
      expect(await resolveQuranContent(c, s, null, WORKS)).toBeNull();
    }
  });
});
