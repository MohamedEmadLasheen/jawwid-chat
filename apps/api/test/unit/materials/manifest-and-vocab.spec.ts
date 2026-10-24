/**
 * PD-29: the import manifest, the item rules shared with the form, the age
 * bands, the real-bytes check, and the report's practice / memorization input.
 */
import { checkHttpsUrl, manifestTemplate, parseCsv, parseItemRow } from '../../../src/materials/manifest';
import { ageGroupOf, bytesMatchMime, kindOfMime } from '../../../src/materials/vocab';
import { parseReportMaterials } from '../../../src/materials/report-materials';
import { SURAHS, surahOf } from '../../../src/materials/quran-surahs';
import { renderCardBody } from '../../../src/lessons/lesson-card';
import { CommError } from '../../../src/platform/errors';

describe('PD-29 manifest', () => {
  it('parses RFC 4180 CSV: quotes, doubled quotes, commas and new lines inside quotes, CRLF, a BOM, blank lines', () => {
    const csv = '\ufeffref,title_ar,description\r\na1,"لعبة, النبأ","line one\nline ""two"""\r\n\r\na2,عنوان,\n';
    expect(parseCsv(csv)).toEqual([
      { ref: 'a1', title_ar: 'لعبة, النبأ', description: 'line one\nline "two"' },
      { ref: 'a2', title_ar: 'عنوان', description: '' },
    ]);
    expect(() => parseCsv('a,b\n"open')).toThrow(/unterminated/);
  });

  it('the downloadable template parses back into valid rows', () => {
    const rows = parseCsv(manifestTemplate());
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ path: '/lessons/quran/surah-78', ref: '/lessons/quran/surah-78' });
    for (const r of rows) expect(parseItemRow(r).errors).toEqual([]);
  });

  it('accepts the form\'s camelCase and the manifest\'s columns alike', () => {
    const { fields, errors } = parseItemRow({ externalRef: 'x', titleAr: 'ع', subject: 'Islamic Studies', ageGroups: ['7-9'], url: 'https://example.org/a' });
    expect(errors).toEqual([]);
    expect(fields).toMatchObject({ externalRef: 'x', subject: 'islamic_studies', ageGroups: ['7-9'], url: 'https://example.org/a' });
    expect(parseItemRow({ ref: 'y', title_en: 'T', subject: 'quran', age_groups: '4-6|7-9; 18', file: 'a.zip' }).fields.ageGroups).toEqual(['4-6', '7-9', '18+']);
  });

  it('reports every error in a row, not only the first', () => {
    const { errors } = parseItemRow({ subject: 'maths', strand: 'tafsir', age_groups: '1-3', surah: '115', url: 'http://x.test', file: 'f.mp3', status: 'live' });
    expect(errors.join('\n')).toEqual(expect.stringContaining('title'));
    for (const part of ['subject', 'age_groups', 'surah', 'url: must start with https://', 'one source', 'status']) {
      expect(errors.some((e) => e.includes(part))).toBe(true);
    }
  });

  it('refuses a strand outside Quran and a link that claims to be a package', () => {
    expect(parseItemRow({ title_ar: 'x', subject: 'arabic', strand: 'tafsir', url: 'https://a.test' }).errors).toContain('strand: only for Quran items');
    expect(parseItemRow({ title_ar: 'x', subject: 'arabic', kind: 'activity_package', url: 'https://a.test' }).errors.join()).toContain('uploaded zip');
  });

  it('https links only, never with credentials', () => {
    expect(checkHttpsUrl('https://example.org/a?b=1')).toBeNull();
    expect(checkHttpsUrl('javascript:alert(1)')).toMatch(/https/);
    expect(checkHttpsUrl('https://user:pw@example.org')).toMatch(/password/);
    expect(checkHttpsUrl('nope')).toBe('not a URL');
  });
});

describe('PD-29 vocabulary', () => {
  it('age bands', () => {
    expect([null, 3, 4, 6, 7, 9, 10, 12, 13, 17, 18, 40].map(ageGroupOf)).toEqual(
      [null, '4-6', '4-6', '4-6', '7-9', '7-9', '10-12', '10-12', '13-17', '13-17', '18+', '18+']);
  });

  it('checks real bytes, so an HTML page renamed .mp3 is refused', () => {
    expect(bytesMatchMime(Buffer.from('ID3\x04\x00'), 'audio/mpeg')).toBe(true);
    expect(bytesMatchMime(Buffer.from('<html><script>'), 'audio/mpeg')).toBe(false);
    expect(bytesMatchMime(Buffer.from('%PDF-1.7'), 'application/pdf')).toBe(true);
    expect(bytesMatchMime(Buffer.from([0x50, 0x4b, 3, 4]), 'application/zip')).toBe(true);
    expect(bytesMatchMime(Buffer.from('\x00\x00\x00\x18ftypmp42'), 'video/mp4')).toBe(true);
    expect(bytesMatchMime(Buffer.from('anything'), 'text/html')).toBe(false);
    expect(kindOfMime('video/mp4')).toBe('video');
    expect(kindOfMime('text/html')).toBeNull();
  });

  it('the surah table: 114 surahs, 6236 ayahs, juz\' in order', () => {
    expect(SURAHS).toHaveLength(114);
    expect(SURAHS.reduce((n, s) => n + s.ayahCount, 0)).toBe(6236);
    expect(surahOf(1)).toMatchObject({ nameEn: 'Al-Fatihah', ayahCount: 7, juz: 1 });
    expect(surahOf(2)).toMatchObject({ juz: 1, juzEnd: 3 });
    expect(surahOf(67)).toMatchObject({ nameAr: 'الملك', juz: 29 });
    expect(surahOf(0)).toBeNull();
    expect(surahOf(115)).toBeNull();
    for (let i = 1; i < SURAHS.length; i++) expect(SURAHS[i]!.juz).toBeGreaterThanOrEqual(SURAHS[i - 1]!.juz);
  });
});

describe('PD-29 report input', () => {
  const bad = (body: Record<string, unknown>) => {
    try {
      parseReportMaterials(body);
    } catch (e) {
      return (e as CommError).message;
    }
    throw new Error('expected a refusal');
  };

  it('an absent key is "unchanged"; ranges default to the whole surah', () => {
    expect(parseReportMaterials({})).toEqual({});
    expect(parseReportMaterials({ practice: [{ surah: 67 }] }).practice).toEqual([{ kind: 'ayah_range', surah: 67, ayahFrom: 1, ayahTo: 30 }]);
    expect(parseReportMaterials({ practice: [] }).practice).toEqual([]);
  });

  it('refuses ranges outside the surah, unknown surahs and statuses, duplicates and too many', () => {
    expect(bad({ practice: [{ surah: 67, ayahFrom: 5, ayahTo: 31 }] })).toContain('ayahs 1 to 30');
    expect(bad({ practice: [{ surah: 67, ayahFrom: 9, ayahTo: 3 }] })).toContain('from <= to');
    expect(bad({ practice: [{ surah: 200 }] })).toContain('1 to 114');
    expect(bad({ practice: [{ itemId: 'not-a-uuid' }] })).toContain('library item id');
    expect(bad({ practice: Array.from({ length: 11 }, (_, i) => ({ surah: i + 1 })) })).toContain('at most 10');
    expect(bad({ practice: [{ surah: 1 }, { surah: 1 }] })).toContain('twice');
    expect(bad({ memorization: [{ surah: 78, status: 'done' }] })).toContain('status');
    expect(bad({ memorization: [{ surah: 78, status: 'memorized' }, { surah: 78, status: 'in_progress' }] })).toContain('twice');
  });

  it('the report card says the practice in the family\'s language', () => {
    const body = renderCardBody('lesson_report', {
      learnerName: 'Child A', coveredTopics: ['revision'],
      practice: [{ kind: 'ayah_range', surah: 67, ayahFrom: 1, ayahTo: 10 }, { kind: 'ayah_range', surah: 1, ayahFrom: 1, ayahTo: 7 }, { kind: 'item', itemId: 'x', title: 'Naba game' }],
    }, 'en');
    expect(body).toContain('Practice this week: Al-Mulk 1–10, Al-Fatihah, Naba game');
    expect(renderCardBody('lesson_report', { learnerName: 'أ', coveredTopics: [], practice: [{ kind: 'ayah_range', surah: 67, ayahFrom: 1, ayahTo: 10 }] }, 'ar'))
      .toContain('تدريب هذا الأسبوع: سورة الملك 1–10');
    expect(renderCardBody('lesson_report', { learnerName: 'A', coveredTopics: ['revision'] }, 'en')).not.toContain('Practice');
  });
});
