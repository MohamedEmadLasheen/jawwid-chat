/**
 * PD-29: the lessons site and the frame allowlist are configuration, and the
 * three presentation rules follow from them: an allowlisted link is framed
 * (keeping its own origin), any other https link opens in the browser, and an
 * uploaded package (ours) is always isolated -- never same-origin. The 83-row
 * seed manifest is valid against the same rules the import applies.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { linkPresentation, MaterialsConfigError, readMaterialsConfig } from '../../../src/materials/materials-config';
import { checkSitePath, parseCsv, parseItemRow } from '../../../src/materials/manifest';
import { playCsp } from '../../../src/materials/play.controller';

describe('PD-29 materials configuration', () => {
  it('reads the site base (path kept, slash trimmed) and adds its origin to the frame allowlist', () => {
    const c = readMaterialsConfig({ MATERIALS_SITE_BASE_URL: 'https://lessons.example.test/base/', MATERIALS_FRAME_ORIGINS: 'https://h5p.example.test, https://Other.example.test:8443' });
    expect(c.siteBase).toBe('https://lessons.example.test/base');
    expect([...c.frameOrigins].sort()).toEqual(['https://h5p.example.test', 'https://lessons.example.test', 'https://other.example.test:8443']);
  });

  it('unset means no site and an empty allowlist', () => {
    const c = readMaterialsConfig({});
    expect(c.siteBase).toBeNull();
    expect(c.frameOrigins.size).toBe(0);
  });

  it.each([
    [{ MATERIALS_SITE_BASE_URL: 'http://lessons.example.test' }],
    [{ MATERIALS_SITE_BASE_URL: 'https://u:p@lessons.example.test' }],
    [{ MATERIALS_SITE_BASE_URL: 'https://lessons.example.test/?x=1' }],
    [{ MATERIALS_SITE_BASE_URL: 'not a url' }],
    [{ MATERIALS_FRAME_ORIGINS: 'http://plain.example.test' }],
    [{ MATERIALS_FRAME_ORIGINS: 'https://*.example.test' }],
    [{ MATERIALS_FRAME_ORIGINS: 'https:' }],
    [{ MATERIALS_FRAME_ORIGINS: 'https://example.test/path' }],
  ])('refuses %j at startup', (env) => {
    expect(() => readMaterialsConfig(env)).toThrow(MaterialsConfigError);
  });

  it('rule 1: a link on the allowlist is framed; rule 2: any other https link opens in the browser', () => {
    const c = readMaterialsConfig({ MATERIALS_SITE_BASE_URL: 'https://lessons.example.test', MATERIALS_FRAME_ORIGINS: 'https://h5p.example.test' });
    expect(linkPresentation('https://lessons.example.test/lessons/quran/surah-78', c)).toBe('frame-site');
    expect(linkPresentation('https://h5p.example.test/embed/1', c)).toBe('frame-site');
    expect(linkPresentation('https://evil.example.test/x', c)).toBe('browser');
    expect(linkPresentation('https://lessons.example.test.evil.test/x', c)).toBe('browser');
    expect(linkPresentation('https://lessons.example.test:444/x', c)).toBe('browser');
    expect(linkPresentation('garbage', c)).toBe('browser');
  });

  it('rule 3: an uploaded package (our origin) is served sandboxed without same-origin, and may not navigate away', () => {
    const csp = playCsp([]);
    expect(csp).toMatch(/^sandbox allow-scripts allow-forms;/);
    expect(csp).not.toMatch(/allow-same-origin|allow-popups|allow-top-navigation|allow-modals/);
    expect(csp).toContain("navigate-to 'self'");
  });
});

describe('PD-29 site paths and the 83-lesson seed', () => {
  it('a site path is an absolute path on the site, nothing else', () => {
    expect(checkSitePath('/lessons/quran/surah-78')).toBeNull();
    for (const bad of ['lessons/x', '//evil.test/x', '/a/../b', 'https://x.test/a', '/a b', '/a?b=1', '/a#b']) expect(checkSitePath(bad)).not.toBeNull();
    expect(parseItemRow({ title_ar: 'x', subject: 'quran', path: '/a', url: 'https://x.test' }).errors.join()).toContain('one source');
    expect(parseItemRow({ title_ar: 'x', subject: 'quran', path: '/a', kind: 'video' }).errors.join()).toContain('activity_link');
  });

  it('the shipped manifest: 159 valid rows (every surah), ref = path, every age, drafts, Quran rows name their surah', () => {
    const csv = readFileSync(join(__dirname, '../../../../../docs/product/pd029-seed/jawwid-lessons-manifest.csv'), 'utf8');
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(159);
    const parsed = rows.map((r) => parseItemRow(r));
    expect(parsed.flatMap((p) => p.errors)).toEqual([]);
    expect(new Set(parsed.map((p) => p.fields.externalRef)).size).toBe(159);
    for (const { fields } of parsed) {
      expect(fields.externalRef).toBe(fields.sitePath);
      expect(fields.sitePath).toMatch(/^\/lessons\/(quran\/surah|arabic\/lesson|islamic\/lesson)-\d+$/);
      expect(fields.url).toBeNull();
      expect(fields.ageGroups).toEqual([]);
      expect(fields.status).toBe('draft');
      if (fields.subject === 'quran') expect(fields.surah).toBe(Number(fields.sitePath!.split('-').pop()));
    }
    const count = (s: string) => parsed.filter((p) => p.fields.subject === s).length;
    expect([count('quran'), count('arabic'), count('islamic_studies')]).toEqual([114, 10, 35]);
    // Every surah, once each: 1 to 114.
    const surahs = parsed.filter((p) => p.fields.subject === 'quran').map((p) => p.fields.surah).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(surahs).toEqual(Array.from({ length: 114 }, (_, i) => i + 1));
    // No base URL is written into the seed: the site is configuration.
    expect(csv).not.toMatch(/https?:\/\//);
  });
});
