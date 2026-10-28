/**
 * PD-45 PR-1: the pinned country and subdivision dataset
 * (docs/product/pd045-parent-location-plan.md §3.1).
 *
 *   data/geo/cldr-49.json          the CLDR 49 inputs and their SHA-256
 *   data/geo/overlay.json          the reviewed Arabic names, labels, order
 *   data/geo/overlay-review.json   release gate R-45a: the human sign-off
 *   apps/api/src/geo/dataset.json  what scripts/geo/build-dataset.py made
 *
 * Pure: reads files, no database.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
const sha256 = (p: string) => createHash('sha256').update(readFileSync(join(REPO, p))).digest('hex');

interface Names { en: string; ar: string }
interface Subdivision extends Names { code: string }
interface Country extends Names { code: string; label: Names | null; subdivisions: Subdivision[] }
interface Dataset {
  version: string;
  source: { cldr: string; tag: string; files: Record<string, string> };
  overlaySha256: string;
  defaultLabel: Names;
  pinned: string[];
  fallbacks: string[];
  countries: Country[];
}
interface Overlay {
  labels: Record<string, Names>;
  defaultLabel: Names;
  pinned: string[];
  countries: Record<string, Partial<Names>>;
  subdivisions: Record<string, Partial<Names>>;
}

const dataset = JSON.parse(read('apps/api/src/geo/dataset.json')) as Dataset;
const overlay = JSON.parse(read('data/geo/overlay.json')) as Overlay;
const manifest = JSON.parse(read('data/geo/cldr-49.json')) as { version: string; tag: string; files: Record<string, string> };
const byCode = new Map(dataset.countries.map((c) => [c.code, c]));

/** The eight markets whose Arabic names are reviewed (R-45a), in the decided order (Q3). */
const CORE = ['EG', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO'] as const;
const CORE_COUNTS: Record<(typeof CORE)[number], number> = { EG: 27, SA: 13, AE: 7, KW: 6, QA: 8, BH: 4, OM: 11, JO: 12 };

describe('PD-45 geo dataset: the CLDR pin', () => {
  it('is CLDR 49, and records the SHA-256 of every input exactly as the manifest pins it', () => {
    expect(manifest.version).toBe('49');
    expect(manifest.tag).toBe('release-49');
    expect(dataset.source.cldr).toBe('49');
    expect(dataset.source.tag).toBe('release-49');
    expect(Object.keys(manifest.files).sort()).toEqual([
      'LICENSE',
      'common/main/ar.xml',
      'common/main/en.xml',
      'common/subdivisions/ar.xml',
      'common/subdivisions/en.xml',
      'common/supplemental/subdivisions.xml',
      'common/validity/region.xml',
      'common/validity/subdivision.xml',
    ]);
    for (const h of Object.values(manifest.files)) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(dataset.source.files).toEqual(manifest.files);
  });

  it('was built from the overlay as it is now', () => {
    expect(dataset.overlaySha256).toBe(sha256('data/geo/overlay.json'));
  });

  it('ships CLDR\'s notice verbatim with the data: the data files are Unicode-3.0', () => {
    // The notice's first part restricts only the LDML specification (UTS #35),
    // which is not shipped; "all other content", the data, is Unicode License v3.
    const notice = read('apps/api/src/geo/LICENSE-CLDR.txt');
    expect(notice).toMatch(/All other content in this repo is released under UNICODE LICENSE V3/);
    expect(notice).toMatch(/SPDX-License-Identifier: Unicode-3\.0/);
    expect(createHash('sha256').update(notice).digest('hex')).toBe(manifest.files.LICENSE);
  });
});

describe('PD-45 geo dataset: the codes', () => {
  it('lists each ISO 3166-1 country once, in code order, plus XK as CLDR does', () => {
    const codes = dataset.countries.map((c) => c.code);
    expect(codes).toEqual([...new Set(codes)].sort());
    for (const c of codes) expect(c).toMatch(/^[A-Z]{2}$/);
    for (const c of [...CORE, 'US', 'CA', 'GB', 'FR', 'DE', 'TR', 'PS', 'XK']) expect(byCode.has(c)).toBe(true);
    expect(codes.length).toBeGreaterThanOrEqual(245);
  });

  it('leaves out codes that are not countries: reserved, macro-regions, private use and unknown', () => {
    for (const c of ['AC', 'CP', 'DG', 'EA', 'IC', 'TA', 'EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB', 'UK']) {
      expect(byCode.has(c)).toBe(false);
    }
  });

  it('gives first-level ISO 3166-2 subdivisions, each under its own country, once', () => {
    const seen = new Set<string>();
    for (const c of dataset.countries) {
      const codes = c.subdivisions.map((s) => s.code);
      expect(codes).toEqual([...codes].sort());
      for (const s of codes) {
        expect(s).toMatch(/^[A-Z]{2}-[A-Z0-9]{1,3}$/);
        expect(s.slice(0, 2)).toBe(c.code);
        expect(seen.has(s)).toBe(false);
        seen.add(s);
      }
    }
    expect(seen.size).toBeGreaterThan(3000);
  });

  it('has every governorate, region and emirate of the core markets', () => {
    for (const c of CORE) expect(byCode.get(c)!.subdivisions).toHaveLength(CORE_COUNTS[c]);
    expect(byCode.get('EG')!.subdivisions.map((s) => s.code)).toEqual(expect.arrayContaining(['EG-C', 'EG-GZ', 'EG-ALX']));
    expect(byCode.get('AE')!.subdivisions.map((s) => s.code)).toEqual(['AE-AJ', 'AE-AZ', 'AE-DU', 'AE-FU', 'AE-RK', 'AE-SH', 'AE-UQ']);
    expect(byCode.get('SA')!.subdivisions.map((s) => s.code)).toContain('SA-14');
  });

  it('never says first level for the second: the UK is its four nations, not its counties', () => {
    expect(byCode.get('GB')!.subdivisions.map((s) => s.code)).toEqual(['GB-ENG', 'GB-NIR', 'GB-SCT', 'GB-WLS']);
  });
});

describe('PD-45 geo dataset: the names', () => {
  it('names every country and subdivision in Arabic and English', () => {
    for (const c of dataset.countries) {
      expect(c.en.trim()).not.toBe('');
      expect(c.ar.trim()).not.toBe('');
      for (const s of c.subdivisions) {
        expect(s.en.trim()).not.toBe('');
        expect(s.ar.trim()).not.toBe('');
      }
    }
  });

  it('lists every name that fell back to the other language or to the code, never silently', () => {
    for (const f of dataset.fallbacks) expect(f).toMatch(/^[A-Z]{2}(-[A-Z0-9]{1,3})?:(ar|en)<-(en|ar|code)$/);
    for (const c of CORE) {
      for (const s of byCode.get(c)!.subdivisions) expect(dataset.fallbacks.filter((f) => f.startsWith(`${s.code}:`))).toEqual([]);
    }
  });

  it('takes the 88 core-market Arabic names from the reviewed overlay, and only those', () => {
    const core = CORE.flatMap((c) => byCode.get(c)!.subdivisions.map((s) => s.code)).sort();
    expect(core).toHaveLength(88);
    expect(Object.keys(overlay.subdivisions).sort()).toEqual(core);
    for (const [code, names] of Object.entries(overlay.subdivisions)) {
      const s = byCode.get(code.slice(0, 2))!.subdivisions.find((x) => x.code === code)!;
      expect(names.ar).toBeTruthy();
      expect(s.ar).toBe(names.ar);
      if (names.en) expect(s.en).toBe(names.en);
    }
  });

  it('drops the type word from a core-market name, because the field label carries it', () => {
    for (const c of CORE) {
      for (const s of byCode.get(c)!.subdivisions) {
        expect(s.ar).not.toMatch(/^(محافظة|منطقة|إمارة|امارة|بلدية)\s/);
        expect(s.ar).toBe(s.ar.trim());
      }
    }
    expect(byCode.get('EG')!.subdivisions.find((s) => s.code === 'EG-C')!.ar).toBe('القاهرة');
    expect(byCode.get('EG')!.subdivisions.find((s) => s.code === 'EG-GZ')!.ar).toBe('الجيزة');
    expect(byCode.get('AE')!.subdivisions.find((s) => s.code === 'AE-DU')!.ar).toBe('دبي');
  });

  it('names Egypt and the Gulf in Arabic as their own people do, overriding CLDR only through the overlay', () => {
    expect(byCode.get('EG')!.ar).toBe('مصر');
    expect(byCode.get('SA')!.ar).toBe('السعودية');
    expect(byCode.get('AE')!.ar).toBe('الإمارات العربية المتحدة');
    for (const [code, names] of Object.entries(overlay.countries)) {
      if (names.ar) expect(byCode.get(code)!.ar).toBe(names.ar);
      if (names.en) expect(byCode.get(code)!.en).toBe(names.en);
    }
  });

  it('never carries a CLDR inheritance marker as a name', () => {
    expect(JSON.stringify(dataset)).not.toMatch(/↑↑↑/);
  });
});

describe('PD-45 geo dataset: labels and order', () => {
  it('labels the subdivision field per country (§3.1.1), with "Region" for the rest', () => {
    const label = (c: string) => byCode.get(c)!.label;
    expect(label('EG')).toEqual({ en: 'Governorate', ar: 'المحافظة' });
    expect(label('AE')).toEqual({ en: 'Emirate', ar: 'الإمارة' });
    expect(label('SA')).toEqual({ en: 'Province', ar: 'المنطقة' });
    for (const c of ['KW', 'BH', 'OM', 'JO']) expect(label(c)).toEqual({ en: 'Governorate', ar: 'المحافظة' });
    expect(label('QA')).toEqual({ en: 'Municipality', ar: 'البلدية' });
    expect(label('US')).toEqual({ en: 'State', ar: 'الولاية' });
    expect(label('CA')).toEqual({ en: 'Province / territory', ar: 'المقاطعة / الإقليم' });
    expect(label('FR')).toBeNull();
    expect(dataset.defaultLabel).toEqual({ en: 'Region', ar: 'المنطقة' });
  });

  it('pins Egypt first, then the Gulf, then Jordan (owner Q3)', () => {
    expect(dataset.pinned).toEqual([...CORE]);
    expect(overlay.pinned).toEqual([...CORE]);
  });
});

describe('PD-45 release gate R-45a: a human signs off the Arabic overlay', () => {
  const reviewPath = 'data/geo/overlay-review.json';

  it('is recorded, by role and never by name, against the exact overlay it covers', () => {
    expect(existsSync(join(REPO, reviewPath))).toBe(true);
    const review = JSON.parse(read(reviewPath)) as {
      gate: string; status: 'pending' | 'approved'; scope: string; reviewerRole: string | null; reviewedOn: string | null; overlaySha256: string | null;
    };
    expect(review.gate).toBe('R-45a');
    expect(review.scope).toMatch(/88/);
    expect(['pending', 'approved']).toContain(review.status);
    expect(Object.keys(review).sort()).toEqual(['gate', 'overlaySha256', 'reviewedOn', 'reviewerRole', 'scope', 'status']);
    if (review.status === 'approved') {
      expect(review.overlaySha256).toBe(sha256('data/geo/overlay.json'));
      expect(review.reviewerRole).toMatch(/\S/);
      expect(review.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
