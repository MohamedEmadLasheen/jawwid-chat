import { describe, expect, it } from 'vitest';
import pin from '../../quran-pin.json';
import { loadSurah, type Surah } from '../quran/dataset';
import { snapshot } from '../test/fixtures';
import realSources from './sources.json';
import vectors from './item-hash.vectors.json';
import shared from './quran-content.cases.json';
import {
  approvalSha256,
  canonicalJson,
  canonicalSha256,
  isPinned,
  passesAsbabRule,
  requiredSteps,
  resolveQuranContent,
  type Approvals,
  type Step,
  type Work,
} from './quran-content';

// Stand-in verses (not Quran), shared with the Python checker's selftest.
async function surah(): Promise<Surah> {
  const s = await snapshot(112, shared.verses.length, { texts: shared.verses, basmala: true });
  return loadSurah(112, s.fetcher, s.anchor);
}

const PINNED = { printer: 'p', place: 'q', year: '1300', pages: 'vol/page', why: 'no modern apparatus' };
const work = (id: string, role: Work['role'], kinds: Work['kinds'], edition: unknown = PINNED): Work => ({ id, role, kinds, edition });
const WORKS: Work[] = [
  work('saadi', 'primary', ['intro', 'tafsir', 'tafsir_x', 'word', 'lesson', 'reflection', 'story', 'theme']),
  work('sijistani-nuzha', 'primary', ['word']),
  work('baghawi', 'cross-check', ['tafsir', 'word']),
  work('bukhari', 'report', ['asbab', 'story']),
  work('tirmidhi', 'report', ['asbab']),
  work('wahidi-asbab', 'pointer', ['asbab']),
  work('muzaini-muharrar', 'verdict', ['asbab']),
  work('wadii-sahih-musnad', 'verdict', ['asbab']),
];

type Content = { items: Array<Record<string, unknown> & { id: string }>; [k: string]: unknown };
const content = (): Content => JSON.parse(JSON.stringify(shared.base).replace('{{pin}}', pin.datasetId));
const item = (c: Content, id: string) => c.items.find((i) => i.id === id)!;

/** Apply one shared case to the base content (the same operations as the Python selftest). */
function applyCase(c: Content, k: (typeof shared.cases)[number]): Content {
  if (k.op === 'none') return c;
  const path = k.path as (string | number)[];
  let at: Record<string | number, unknown> = c;
  for (const p of path.slice(0, -1)) at = at[p] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  if (k.op === 'set') at[last] = structuredClone(k.value);
  else if (k.op === 'delete') delete at[last];
  else if (k.op === 'append') (at[last] as unknown[]).push(structuredClone(k.value));
  return c;
}

async function approve(c: Content, steps: Step[] = ['check', 'teacher', 'scholar'], items = c.items): Promise<Approvals> {
  return {
    surah: 112,
    lessonKey: 'quran-112',
    approvals: await Promise.all(items.map(async (i) => ({ id: i.id, approvalSha256: await approvalSha256(pin.datasetId, 'quran-112', i), steps }))),
  };
}

describe('the hashes', () => {
  it('canonical JSON hashes match the vectors the Python checker also verifies, byte for byte', async () => {
    for (const v of vectors) expect(await canonicalSha256(v.item)).toBe(v.sha256);
    expect(canonicalJson({ b: [{ d: 1, c: 2 }], a: 'x' })).toBe('{"a":"x","b":[{"c":2,"d":1}]}');
  });

  it('an approval binds the item to its dataset and lesson: re-pinned or copied, it is stale', async () => {
    const i = { id: 'word-001' };
    const h = await approvalSha256(pin.datasetId, 'quran-112', i);
    expect(await approvalSha256('other-dataset', 'quran-112', i)).not.toBe(h);
    expect(await approvalSha256(pin.datasetId, 'quran-113', i)).not.toBe(h);
    expect(h).toBe(await canonicalSha256({ datasetId: pin.datasetId, item: i, lessonKey: 'quran-112' }));
  });
});

describe('the shared content cases (quran-content.cases.json, also run by the Python checker)', () => {
  const cases = shared.cases.filter((k) => !('pyOnly' in k));
  it.each(cases.map((k) => [k.name, k] as const))('%s', async (_name, k) => {
    const c = applyCase(content(), k);
    const r = await resolveQuranContent(c, await surah(), null, WORKS);
    if (k.expect === 'ok') expect(r).not.toBeNull();
    else expect(r).toBeNull();
  });
});

describe('the asbab display rule (plan A.3)', () => {
  const muharrar = { work: 'muzaini-muharrar', ref: '1', reason: 'is' as const };
  it('shows a report al-Muharrar calls the reason, in al-Bukhari, with nothing against it', () => {
    expect(passesAsbabRule({ work: 'bukhari', ref: '1' }, [muharrar])).toBe(true);
  });
  it("outside the two Sahihs, needs a judge (al-Muzaini, al-Wadi'i or Ibn Hajar) to grade the chain sound", () => {
    expect(passesAsbabRule({ work: 'tirmidhi', ref: '1' }, [muharrar])).toBe(false);
    expect(passesAsbabRule({ work: 'tirmidhi', ref: '1' }, [{ ...muharrar, chain: 'hasan' }])).toBe(true);
    expect(passesAsbabRule({ work: 'tirmidhi', ref: '1' }, [muharrar, { work: 'ibn-hajar-fath', ref: '8/1', chain: 'sahih' }])).toBe(true);
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

describe('a pinned edition', () => {
  it('is exactly {printer, place, year, pages, why}, each non-empty: truthiness is not enough', () => {
    expect(isPinned(PINNED)).toBe(true);
    expect(isPinned(null)).toBe(false);
    expect(isPinned(true)).toBe(false);
    expect(isPinned('Bulaq')).toBe(false);
    expect(isPinned({ printer: 'p' })).toBe(false);
    expect(isPinned({ ...PINNED, why: ' ' })).toBe(false);
    expect(isPinned({ ...PINNED, extra: 'x' })).toBe(false);
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

  it('shows approved items, with quotations as structured runs of verified words', async () => {
    const c = content();
    const r = await resolveQuranContent(c, await surah(), await approve(c), WORKS);
    expect(r?.held).toBe(0);
    const byId = new Map(r!.items.map((i) => [i.id, i]));
    expect(byId.get('tafsir-001')?.text).toEqual([
      { kind: 'prose', text: 'شرح ' },
      { kind: 'quran', ayah: 1, from: 2, to: 2, text: 'باء' },
      { kind: 'prose', text: ' هنا' },
    ]);
    expect(byId.get('word-001')?.words).toEqual({ kind: 'quran', ayah: 3, from: 2, to: 3, text: 'ذال راء' });
    const hifz = byId.get('quiz-002')!;
    expect(hifz.text).toEqual([{ kind: 'prose', text: 'أَكْمِلِ الْآيَةَ' }]); // the fixed question, never authored prose
    expect(hifz.quiz).toEqual({
      category: 'hifz',
      options: [[{ kind: 'quran', ayah: 2, from: 3, to: 3, text: 'خاء' }], [{ kind: 'quran', ayah: 1, from: 1, to: 1, text: 'ألف' }]],
      answer: 0,
      prompt: { kind: 'quran', ayah: 2, from: 1, to: 2, text: 'جيم حاء' },
    });
    expect(r?.segments[0]?.theme).toBe('theme-001');
  });

  it('holds an item whose approval is stale, lacks a step, or cites an unpinned (or malformed) edition', async () => {
    const c = content();
    const a = await approve(c);
    const at = (id: string) => a.approvals.find((x) => x.id === id)!;
    at('tafsir-001').approvalSha256 = '0'.repeat(64); // changed after approval
    at('word-001').steps = ['check']; // the teacher has not signed
    const works = WORKS.map((w) => (w.id === 'muzaini-muharrar' ? { ...w, edition: { printer: 'p' } } : w));
    const shown = (await resolveQuranContent(c, await surah(), a, works))!.items.map((i) => i.id);
    expect(shown).not.toContain('tafsir-001');
    expect(shown).not.toContain('word-001');
    expect(shown).not.toContain('asbab-001'); // its verdict work's edition is not a full pin
    expect(shown).not.toContain('quiz-001'); // it rests on word-001, which is held
    expect(shown).not.toContain('quiz-003'); // ...and this one rests on quiz-001: held to a fixpoint
    expect(shown).toContain('quiz-002');
  });

  it('holds an asbab item that fails the display rule, even fully approved', async () => {
    const c = content();
    (item(c, 'asbab-001').verdicts as unknown[]).push({ work: 'wadii-sahih-musnad', ref: '3', chain: 'mursal' });
    const r = await resolveQuranContent(c, await surah(), await approve(c), WORKS);
    expect(r!.items.map((i) => i.id)).not.toContain('asbab-001');
  });

  it('with the real registry (no edition pinned yet), nothing that cites a source can show', async () => {
    const c = content();
    const r = await resolveQuranContent(c, await surah(), await approve(c), realSources.works as Work[]);
    // Only the hifz quiz: a fixed question over verified positions cites no work.
    expect(r!.items.map((i) => i.id)).toEqual(['quiz-002']);
  });

  it('refuses the whole file, never rejecting, on malformed approvals', async () => {
    const c = content();
    const s = await surah();
    const good = await approve(c);
    for (const bad of [
      { ...good, approvals: [null] },
      { ...good, approvals: [{ id: 'word-001' }] },
      { ...good, approvals: [good.approvals[0], good.approvals[0]] },
      { ...good, lessonKey: 'quran-113' },
      { ...good, approvals: 'x' },
    ]) {
      await expect(resolveQuranContent(c, s, bad as unknown as Approvals, WORKS)).resolves.toBeNull();
    }
  });
});
