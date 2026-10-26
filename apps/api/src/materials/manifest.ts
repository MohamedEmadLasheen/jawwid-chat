import { surahOf } from './quran-surahs';
import { AGE_GROUPS, ITEM_STATUSES, KINDS, STRANDS, SUBJECTS, type ItemStatus, type Kind } from './vocab';

/**
 * PD-29: one library item as a person or a manifest writes it, and the rules
 * it must meet. Shared by the single-item form and the bulk import, so a row
 * the import accepts is exactly an item the form would accept.
 *
 * A row names ONE source: `path` (a lesson of the configured lessons site --
 * its path only, joined to MATERIALS_SITE_BASE_URL when opened), `url` (any
 * https link) or `file` (a file name in the same import, or an upload token on
 * the form). On an update a row may name none: the item keeps its source.
 */
export interface ItemFields {
  externalRef: string | null;
  titleAr: string | null;
  titleEn: string | null;
  subject: string;
  strand: string | null;
  kind: Kind | null;
  ageGroups: string[];
  surah: number | null;
  description: string | null;
  url: string | null;
  sitePath: string | null;
  file: string | null;
  status: ItemStatus | null;
  /** PD-29 amendment: an explicit position; on an import a new item otherwise takes its row number. */
  sortOrder: number | null;
}

export const MAX_IMPORT_ROWS = 1000;

/** The manifest's column names, in the order the template lists them. */
export const MANIFEST_COLUMNS = [
  'ref', 'title_ar', 'title_en', 'subject', 'strand', 'kind', 'age_groups', 'surah', 'description', 'path', 'url', 'file', 'status', 'sort_order',
] as const;

const ALIASES: Record<string, string> = {
  ref: 'ref', external_ref: 'ref', externalref: 'ref', id: 'ref',
  title_ar: 'title_ar', titlear: 'title_ar', title: 'title_ar',
  title_en: 'title_en', titleen: 'title_en',
  subject: 'subject', strand: 'strand', kind: 'kind', type: 'kind',
  age_groups: 'age_groups', agegroups: 'age_groups', age_group: 'age_groups', ages: 'age_groups',
  surah: 'surah', description: 'description', url: 'url', link: 'url',
  path: 'path', site_path: 'path', sitepath: 'path', lesson_path: 'path',
  file: 'file', file_name: 'file', filename: 'file', status: 'status',
  sort_order: 'sort_order', sortorder: 'sort_order', order: 'sort_order', position: 'sort_order',
};

function norm(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Map a raw row's keys to the canonical column names; unknown keys are ignored. */
export function canonicalRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const c = ALIASES[norm(k)] ?? ALIASES[norm(k).replace(/_/g, '')];
    if (c && !(c in out)) out[c] = v;
  }
  return out;
}

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

/** An https URL without credentials, or the reason it is refused. */
export function checkHttpsUrl(raw: string): string | null {
  if (raw.length > 2000) return 'at most 2000 characters';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'not a URL';
  }
  if (u.protocol !== 'https:') return 'must start with https://';
  if (!u.hostname) return 'has no host';
  if (u.username || u.password) return 'must not carry a user name or password';
  return null;
}

/** A site path (`/lessons/quran/surah-78`), or the reason it is refused. */
export function checkSitePath(raw: string): string | null {
  if (raw.length > 500) return 'at most 500 characters';
  if (!/^\/[A-Za-z0-9._~/-]*$/.test(raw) || raw.startsWith('//') || /(^|\/)\.\.(\/|$)/.test(raw)) {
    return 'a path on the lessons site, starting with / (letters, digits, - _ . ~ /)';
  }
  return null;
}

/**
 * Validate one row. Returns the fields and every error found (not just the
 * first), so the dry-run preview can say all of what is wrong with a row.
 */
export function parseItemRow(raw: Record<string, unknown>): { fields: ItemFields; errors: string[] } {
  const r = canonicalRow(raw);
  const errors: string[] = [];
  const externalRef = text(r.ref);
  if (externalRef && externalRef.length > 200) errors.push('ref: at most 200 characters');
  const titleAr = text(r.title_ar);
  const titleEn = text(r.title_en);
  if (!titleAr && !titleEn) errors.push('title_ar or title_en: a title is required');
  if ((titleAr?.length ?? 0) > 200 || (titleEn?.length ?? 0) > 200) errors.push('title: at most 200 characters');

  const subject = (text(r.subject) ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (!(SUBJECTS as readonly string[]).includes(subject)) errors.push(`subject: one of ${SUBJECTS.join(', ')}`);
  const strandRaw = text(r.strand);
  const strand = strandRaw ? strandRaw.toLowerCase().replace(/[\s-]+/g, '_') : null;
  if (strand && !(STRANDS as readonly string[]).includes(strand)) errors.push(`strand: one of ${STRANDS.join(', ')}`);
  if (strand && subject !== 'quran') errors.push('strand: only for Quran items');

  const kindRaw = text(r.kind);
  const kind = kindRaw ? (kindRaw.toLowerCase().replace(/[\s-]+/g, '_') as Kind) : null;
  if (kind && !(KINDS as readonly string[]).includes(kind)) errors.push(`kind: one of ${KINDS.join(', ')}`);

  let ageGroups: string[] = [];
  const agesRaw = r.age_groups;
  if (Array.isArray(agesRaw)) ageGroups = agesRaw.map((a) => String(a).trim()).filter(Boolean);
  else if (text(agesRaw)) ageGroups = String(agesRaw).split(/[|;,]/).map((a) => a.trim()).filter(Boolean);
  ageGroups = [...new Set(ageGroups.map((a) => (a === '18' || a === '18-' ? '18+' : a)))];
  const badAge = ageGroups.find((a) => !(AGE_GROUPS as readonly string[]).includes(a));
  if (badAge) errors.push(`age_groups: ${JSON.stringify(badAge)} is not one of ${AGE_GROUPS.join(', ')}`);

  let surah: number | null = null;
  const surahRaw = text(r.surah);
  if (surahRaw) {
    const n = Number(surahRaw);
    if (!surahOf(n)) errors.push('surah: a number from 1 to 114');
    else surah = n;
  }

  const description = text(r.description);
  if ((description?.length ?? 0) > 2000) errors.push('description: at most 2000 characters');

  const url = text(r.url);
  if (url) {
    const why = checkHttpsUrl(url);
    if (why) errors.push(`url: ${why}`);
  }
  const sitePath = text(r.path);
  if (sitePath) {
    const why = checkSitePath(sitePath);
    if (why) errors.push(`path: ${why}`);
    if (kind && kind !== 'activity_link') errors.push('kind: a lesson of the lessons site is an activity_link');
  }
  const file = text(r.file);
  if ([url, sitePath, file].filter(Boolean).length > 1) errors.push('path, url and file: a row names one source');
  if (url && kind === 'activity_package') errors.push('kind: an activity_package is an uploaded zip, not a link');

  const statusRaw = text(r.status);
  const status = statusRaw ? (statusRaw.toLowerCase() as ItemStatus) : null;
  if (status && !(ITEM_STATUSES as readonly string[]).includes(status)) errors.push(`status: one of ${ITEM_STATUSES.join(', ')}`);

  let sortOrder: number | null = null;
  const orderRaw = text(r.sort_order);
  if (orderRaw) {
    const n = Number(orderRaw);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) errors.push('sort_order: a whole number from 1');
    else sortOrder = n;
  }

  return {
    fields: { externalRef, titleAr, titleEn, subject, strand, kind, ageGroups, surah, description, url, sitePath, file, status, sortOrder },
    errors,
  };
}

/**
 * RFC 4180 CSV: quoted fields, doubled quotes, CR/LF/CRLF line ends, a UTF-8
 * BOM. The first record is the header. Blank lines are skipped.
 */
export function parseCsv(input: string): Array<Record<string, string>> {
  const s = input.startsWith('﻿') ? input.slice(1) : input;
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('an unterminated quoted field');
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const nonBlank = records.filter((r) => r.some((f) => f.trim() !== ''));
  if (nonBlank.length === 0) return [];
  const header = nonBlank[0]!.map((h) => h.trim());
  return nonBlank.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** The CSV template the Admin Web offers for download. */
export function manifestTemplate(): string {
  return [
    MANIFEST_COLUMNS.join(','),
    '/lessons/quran/surah-78,سورة النبأ,Surah An-Naba,quran,memorization,activity_link,,78,,/lessons/quran/surah-78,,,draft',
    'quran-juz30-naba-game,لعبة سورة النبأ,An-Naba game,quran,memorization,activity_package,4-6|7-9,78,,,,naba-game.zip,draft',
    'arabic-letters-song,أنشودة الحروف,Letters song,arabic,,video,4-6,,,,https://example.org/letters,,draft',
  ].join('\r\n') + '\r\n';
}
