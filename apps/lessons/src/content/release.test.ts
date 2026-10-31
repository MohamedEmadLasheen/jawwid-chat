// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';
import configFor from '../../vite.config';
import { flaggedPaths, isWithheld, releaseContent, ReleaseRefused, RULES, ruleFor } from './release';
import { contentFor } from './index';
import { arabicLessonFor } from '../arabic/index';
import { ARABIC_LESSONS } from '../route';
// The files exactly as written (?raw: tests only; the build refuses a JSON import with a query).
import surah085 from './surah-085.json?raw';
import lesson001 from '../arabic/lesson-001.json?raw';
import lesson005 from '../arabic/lesson-005.json?raw';
import sources from './sources.json?raw';
import mechanics from '../play/mechanics.json?raw';
import playApprovals from './approvals/play.json?raw';
import approvalKeys from './approvals-keys.json?raw';
import quranPin from '../../quran-pin.json?raw';

const FILES: Record<string, string> = {
  'src/content/surah-085.json': surah085,
  'src/arabic/lesson-001.json': lesson001,
  'src/arabic/lesson-005.json': lesson005,
  'src/content/sources.json': sources,
  'src/play/mechanics.json': mechanics,
  'src/content/approvals/play.json': playApprovals,
  'src/content/approvals-keys.json': approvalKeys,
  'quran-pin.json': quranPin,
};
const read = (rel: string) => FILES[rel]!;
const sha = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A real lesson file, cleared and approved the way a teacher would: every held item resolved (review and was set to null). */
function approve(code: string): string {
  const clear = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(clear);
    if (!x || typeof x !== 'object') return x;
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, (k === 'review' || k === 'was') && typeof v !== 'object' ? null : clear(v)]));
  };
  const c = clear(JSON.parse(code)) as { review: { status: string; by: string | null } };
  c.review = { ...c.review, status: 'approved', by: 'Teachers department' };
  // Two-space indent and a final newline, unlike the source: the release must not care how the file is written.
  return JSON.stringify(c, null, 2) + '\n';
}

describe('releaseContent: what a family build ships of each JSON import', () => {
  it('an APPROVED lesson ships byte for byte: output === input, and the same SHA-256', async () => {
    for (const path of ['src/content/surah-085.json', 'src/arabic/lesson-001.json', 'src/arabic/lesson-005.json']) {
      const code = approve(read(path));
      expect(flaggedPaths(JSON.parse(code))).toEqual([]);
      const r = await releaseContent(path, code);
      expect(r.status).toBe('approved');
      expect(r.code).toBe(code);
      expect(r.shippedSha256).toBe(r.sourceSha256);
      expect(r.sourceSha256).toBe(await sha(code));
    }
  });

  it('a PENDING lesson ships only the stub, with its kind when it has one (lesson 5 is a reading lesson)', async () => {
    const surah = await releaseContent('src/content/surah-085.json', read('src/content/surah-085.json'));
    expect(surah.status).toBe('withheld');
    expect(surah.code).toBe('{"withheld":true}');
    expect(surah.shippedSha256).toBe(await sha('{"withheld":true}'));
    expect(surah.sourceSha256).toBe(await sha(read('src/content/surah-085.json')));
    expect((await releaseContent('src/arabic/lesson-001.json', read('src/arabic/lesson-001.json'))).code).toBe('{"withheld":true}');
    expect((await releaseContent('src/arabic/lesson-005.json', read('src/arabic/lesson-005.json'))).code).toBe('{"withheld":true,"kind":"reading"}');
    expect(isWithheld(JSON.parse(surah.code))).toBe(true);
  });

  it('every lesson the engine imports today is pending, so none of its text ships', async () => {
    const surahs = [1, ...Array.from({ length: 37 }, (_, i) => 78 + i)];
    const files = [
      ...surahs.map((n) => [`src/content/surah-${String(n).padStart(3, '0')}.json`, contentFor(n)] as const),
      ...ARABIC_LESSONS.map((n) => [`src/arabic/lesson-${String(n).padStart(3, '0')}.json`, arabicLessonFor(n)] as const),
    ];
    expect(files.filter(([, c]) => c !== null)).toHaveLength(38 + 5);
    for (const [path, content] of files) {
      const r = await releaseContent(path, JSON.stringify(content));
      expect([path, r.status]).toEqual([path, 'withheld']);
      expect(r.code.length).toBeLessThan(40);
    }
  });

  it('an approved file that still holds an item FAILS (a review note, or an old spelling in was)', async () => {
    const code = JSON.parse(approve(read('src/arabic/lesson-001.json')));
    code.units[0].words[0].review = 'ADDED TASHKEEL';
    await expect(releaseContent('src/arabic/lesson-001.json', JSON.stringify(code))).rejects.toThrow(/approved while 1 item\(s\) are still held \(units\[0\]\.words\[0\]\.review\)/);
    code.units[0].words[0].review = null;
    code.units[0].words[0].was = 'old';
    await expect(releaseContent('src/arabic/lesson-001.json', JSON.stringify(code))).rejects.toThrow(/still held \(units\[0\]\.words\[0\]\.was\)/);
    const surah = JSON.parse(approve(read('src/content/surah-085.json')));
    surah.quiz[0].review = 'check';
    await expect(releaseContent('src/content/surah-085.json', JSON.stringify(surah))).rejects.toThrow(ReleaseRefused);
  });

  it('an unknown content JSON FAILS, and so does a lesson with no known status or a later schema', async () => {
    await expect(releaseContent('src/content/sources.json', read('src/content/sources.json'))).rejects.toThrow(/not on the release allowlist/);
    await expect(releaseContent('src/islamic/lesson-008.json', '{"review":{"status":"approved"}}')).rejects.toThrow(/not on the release allowlist/);
    await expect(releaseContent('src/arabic/lesson-1.json', '{}')).rejects.toThrow(/not on the release allowlist/);
    await expect(releaseContent('src/arabic/lesson-002.json', '{"review":{"status":"draft"}}')).rejects.toThrow(/neither pending nor approved/);
    await expect(releaseContent('src/arabic/lesson-002.json', '{"lesson":2}')).rejects.toThrow(/neither pending nor approved/);
    await expect(releaseContent('src/content/surah-001.json', '{"schema":2,"items":[]}')).rejects.toThrow(/schema 2 has no release rule yet/);
    await expect(releaseContent('src/content/surah-001.json', '[1]')).rejects.toThrow(/not a JSON object/);
    await expect(releaseContent('src/content/surah-001.json', '{')).rejects.toThrow(/not valid JSON/);
  });

  it('files with no lesson text ship as they are; the preview build ships everything as written', async () => {
    for (const path of ['src/play/mechanics.json', 'src/content/approvals/play.json', 'src/content/approvals-keys.json', 'quran-pin.json']) {
      const r = await releaseContent(path, read(path));
      expect([path, r.status, r.code === read(path)]).toEqual([path, 'as-is', true]);
    }
    const pending = read('src/content/surah-085.json');
    const preview = await releaseContent('src/content/surah-085.json', pending, { preview: true });
    expect([preview.status, preview.code === pending]).toEqual(['preview', true]);
  });

  it('dropUnsignedMechanics (OFF by default) leaves out every mechanic no approval names with both signers', async () => {
    const code = read('src/play/mechanics.json');
    const ids = (JSON.parse(code).mechanics as { id: string }[]).map((m) => m.id);
    const none = await releaseContent('src/play/mechanics.json', code, { dropUnsignedMechanics: true, playApprovals: JSON.parse(read('src/content/approvals/play.json')) });
    expect(none.dropped).toEqual(ids);
    expect(JSON.parse(none.code).mechanics).toEqual([]);
    const one = { payload: { approvals: [{ id: ids[0], steps: ['teacher', 'scholar'] }, { id: ids[1], steps: ['teacher'] }] } };
    const kept = await releaseContent('src/play/mechanics.json', code, { dropUnsignedMechanics: true, playApprovals: one });
    expect((JSON.parse(kept.code).mechanics as { id: string }[]).map((m) => m.id)).toEqual([ids[0]]);
  });

  it('the stub is recognised only exactly', () => {
    expect(isWithheld({ withheld: true })).toBe(true);
    expect(isWithheld({ withheld: true, kind: 'reading' })).toBe(true);
    expect(isWithheld({ withheld: 'yes' })).toBe(false);
    expect(isWithheld({ withheld: true, units: [] })).toBe(false);
    expect(isWithheld({ withheld: true, kind: 3 })).toBe(false);
    expect(isWithheld(null)).toBe(false);
    expect(isWithheld([])).toBe(false);
  });

  it('every content JSON in the engine is on the allowlist, or only tests import it', () => {
    const imported = RULES.map((r) => r.kind);
    expect(new Set(imported)).toEqual(new Set(['surah', 'arabic', 'mechanics', 'approvals', 'keys', 'pin']));
    expect(ruleFor('src/content/surah-085.json')?.reviewed).toBe(true);
    expect(ruleFor('src/arabic/letters.fixture.json')).toBeNull();
    expect(ruleFor('public/data/quran/manifest.json')).toBeNull();
  });
});

describe('the lessons-release plugin in vite.config.ts', () => {
  // A root that need not exist: the plugin only computes paths relative to it. command 'serve', so
  // nothing is written to disk; the manifest it would write comes from api.manifest().
  const scratch = '/lessons-root';
  const join = (...parts: string[]) => parts.join('/');

  async function plugin(mode: string) {
    const config = await (configFor as (env: object) => { plugins: Plugin[] })({ mode, command: 'build', isSsrBuild: false, isPreview: false });
    const p = config.plugins.flat().find((x) => x && (x as Plugin).name === 'lessons-release') as Plugin;
    (p.configResolved as (c: object) => void)({ root: scratch, command: 'serve' });
    const ctx = { error: (m: string) => { throw new Error(m); } };
    const transform = (code: string, id: string) => (p.transform as (this: object, c: string, i: string) => Promise<{ code: string } | null>).call(ctx, code, id);
    const manifest = () => (p.api as { manifest: () => { v: number; mode: string; dropUnsignedMechanics: boolean; files: unknown[] } }).manifest();
    return { p, transform, manifest };
  }

  it('runs before Vite\'s JSON plugin, withholds pending files, leaves approved files untouched, and writes the manifest outside dist/', async () => {
    const { p, transform, manifest: written } = await plugin('production');
    expect(p.enforce).toBe('pre');
    const pending = read('src/arabic/lesson-005.json');
    expect(await transform(pending, join(scratch, 'src/arabic/lesson-005.json'))).toEqual({ code: '{"withheld":true,"kind":"reading"}', map: null });
    const approved = approve(read('src/content/surah-085.json'));
    expect(await transform(approved, join(scratch, 'src/content/surah-085.json'))).toBeNull(); // nothing changed: Vite gets the file as written
    expect(await transform('export const x = 1;', join(scratch, 'src/a.ts'))).toBeNull();
    expect(await transform('{"a":1}', join(scratch, 'node_modules/pkg/data.json'))).toBeNull();
    const manifest = written();
    expect(manifest).toMatchObject({ v: 1, mode: 'family', dropUnsignedMechanics: false });
    expect(manifest.files).toEqual([
      { path: 'src/arabic/lesson-005.json', kind: 'arabic', status: 'withheld', sourceSha256: await sha(pending), shippedSha256: await sha('{"withheld":true,"kind":"reading"}') },
      { path: 'src/content/surah-085.json', kind: 'surah', status: 'approved', sourceSha256: await sha(approved), shippedSha256: await sha(approved) },
    ]);
  });

  it('FAILS the build on a JSON import that is not on the allowlist, or one with a query (?raw, ?url)', async () => {
    const { transform } = await plugin('production');
    await expect(transform('{}', join(scratch, 'src/content/sources.json'))).rejects.toThrow(/not on the release allowlist/);
    await expect(transform('{}', join(scratch, 'src/new/lesson-001.json'))).rejects.toThrow(/not on the release allowlist/);
    await expect(transform('export default "x"', join(scratch, 'src/content/surah-085.json') + '?raw')).rejects.toThrow(/with a query is refused/);
    await expect(transform('export default "x"', join(scratch, 'src/content/surah-085.json') + '?url')).rejects.toThrow(/with a query is refused/);
    const pending = JSON.parse(read('src/arabic/lesson-001.json'));
    pending.review.status = 'approved';
    await expect(transform(JSON.stringify(pending), join(scratch, 'src/arabic/lesson-001.json'))).rejects.toThrow(/still held/);
  });

  it('the preview build (mode "preview") passes everything through', async () => {
    const { transform } = await plugin('preview');
    expect(await transform(read('src/content/surah-085.json'), join(scratch, 'src/content/surah-085.json'))).toBeNull();
  });
});
