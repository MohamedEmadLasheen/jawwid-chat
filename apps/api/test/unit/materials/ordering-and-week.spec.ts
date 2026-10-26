/**
 * PD-29 amendment (2026-10-26): one order for materials everywhere, and the
 * academy's week (Saturday to Friday, academy time zone) for "Opened this week".
 */
import { compareMaterials, sortMaterials, surahRank, type Orderable } from '../../../src/materials/ordering';
import { academyWeekStart } from '../../../src/materials/week';

const at = new Date('2026-10-01T00:00:00Z');
const item = (over: Partial<Orderable> & { id: string }): Orderable & { id: string } => ({
  subject: 'quran', surah: null, sortOrder: null, titleAr: over.id, titleEn: null, createdAt: at, ...over,
});

describe('PD-29 ordering', () => {
  it('Quran: Al-Fatihah first, then by surah descending (An-Nas, Al-Falaq, Al-Ikhlas ... An-Naba), no surah last', () => {
    const items = [78, 112, 1, 114, 113, 2].map((n) => item({ id: `s${n}`, surah: n }));
    items.push(item({ id: 'no-surah', sortOrder: 1 }));
    expect(sortMaterials(items).map((i) => i.id)).toEqual(['s1', 's114', 's113', 's112', 's78', 's2', 'no-surah']);
    expect([1, 114, 113, 78, 2].map(surahRank)).toEqual([0, 1, 2, 37, 113]);
  });

  it('two items of one surah follow the provided order', () => {
    const items = [item({ id: 'game', surah: 78, sortOrder: 5 }), item({ id: 'lesson', surah: 78, sortOrder: 2 })];
    expect(sortMaterials(items).map((i) => i.id)).toEqual(['lesson', 'game']);
  });

  it('other subjects: the order provided, unordered items last (by title); subjects Quran, Arabic, Islamic studies', () => {
    const items = [
      item({ id: 'is-1', subject: 'islamic_studies', sortOrder: 1 }),
      item({ id: 'ar-none', subject: 'arabic' }),
      item({ id: 'ar-3', subject: 'arabic', sortOrder: 3 }),
      item({ id: 'ar-1', subject: 'arabic', sortOrder: 1 }),
      item({ id: 'q-78', subject: 'quran', surah: 78 }),
    ];
    expect(sortMaterials(items).map((i) => i.id)).toEqual(['q-78', 'ar-1', 'ar-3', 'ar-none', 'is-1']);
    expect(compareMaterials(items[0]!, items[0]!)).toBe(0);
  });
});

describe('PD-29 academy week', () => {
  it('starts on Saturday 00:00 in the academy zone', () => {
    // Monday 26 Oct 2026, 12:00 UTC (15:00 Cairo) -> Saturday 24 Oct 00:00 Cairo (21:00 UTC Friday, UTC+3).
    expect(academyWeekStart(new Date('2026-10-26T12:00:00Z'), 'Africa/Cairo').toISOString()).toBe('2026-10-23T21:00:00.000Z');
    // Friday 30 Oct 23:30 Cairo is still the same week.
    expect(academyWeekStart(new Date('2026-10-30T20:30:00Z'), 'Africa/Cairo').toISOString()).toBe('2026-10-23T21:00:00.000Z');
    // Saturday 31 Oct 00:10 Cairo (after the clock change to UTC+2) begins the next week.
    expect(academyWeekStart(new Date('2026-10-30T22:10:00Z'), 'Africa/Cairo').toISOString()).toBe('2026-10-30T22:00:00.000Z');
    // A Saturday morning is its own week's first day.
    expect(academyWeekStart(new Date('2026-10-24T06:00:00Z'), 'Africa/Cairo').toISOString()).toBe('2026-10-23T21:00:00.000Z');
  });
});
