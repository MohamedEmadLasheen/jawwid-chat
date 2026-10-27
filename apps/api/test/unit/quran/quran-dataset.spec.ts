/**
 * The shared Quran dataset (PD-29 amendment, materials quality P0-2; the
 * contract is docs/product/quran-dataset-contract.md). The owner's rule: the
 * text is checked against a fixed fingerprint at EVERY load, Tajweed is shown
 * only once approved, and text, audio and Tajweed can never fall out of step.
 *
 * These are the pure checks; the service and the loader both use them.
 */
import { SURAHS } from '../../../src/materials/quran-surahs';
import { QuranIntegrityError, sha256Hex, verifyDataset } from '../../../src/quran/quran-integrity';
import { audioKey, parseAudioKey } from '../../../src/quran/audio-key';
import { servableMarks, type TajweedMark, type TajweedReview } from '../../../src/quran/tajweed';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PINNED_QURAN_DATASETS } from '../../../src/quran/pinned';
import { pinnedFor, syntheticRows } from './fixtures';

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(QuranIntegrityError);
    return (e as QuranIntegrityError).reason;
  }
  throw new Error('expected a refusal');
}

describe('the Quran text is verified against its pinned fingerprint', () => {
  const rows = syntheticRows();
  const pinned = pinnedFor(rows);

  it('accepts the exact text: 6,236 ayat, every surah complete, the digest matching', () => {
    expect(rows).toHaveLength(6236);
    const verified = verifyDataset(rows, pinned);
    expect(verified.size).toBe(6236);
    expect(verified.get('85:22')).toBe(sha256Hex('نص 85:22'));
  });

  it('refuses a tampered text, even with its own hash recomputed to match', () => {
    // A changed letter whose row hash was updated with it: only the pinned digest catches it.
    const tampered = rows.map((r) => (r.surah === 101 && r.ayah === 4 ? { ...r, text: r.text + 'ـ', sha256: sha256Hex(r.text + 'ـ') } : r));
    expect(refusal(() => verifyDataset(tampered, pinned))).toBe('digest');
  });

  it('refuses a text whose stored hash does not match the text', () => {
    const tampered = rows.map((r) => (r.surah === 1 && r.ayah === 1 ? { ...r, text: 'x' } : r));
    expect(refusal(() => verifyDataset(tampered, pinned))).toBe('ayah-hash');
  });

  it('refuses a count mismatch: a missing ayah, a split ayah, an ayah past the end, a duplicate', () => {
    const missing = rows.filter((r) => !(r.surah === 89 && r.ayah === 23));
    expect(refusal(() => verifyDataset(missing, pinned))).toBe('count');

    const split = [...rows, { surah: 89, ayah: 31, text: 'extra', sha256: sha256Hex('extra') }];
    expect(refusal(() => verifyDataset(split, pinned))).toBe('count');

    const shifted = rows.map((r) => (r.surah === 114 && r.ayah === 6 ? { ...r, ayah: 7 } : r));
    expect(refusal(() => verifyDataset(shifted, pinned))).toBe('numbering');

    const duplicate = rows.map((r) => (r.surah === 112 && r.ayah === 4 ? { ...r, ayah: 3 } : r));
    expect(refusal(() => verifyDataset(duplicate, pinned))).toBe('numbering');
  });

  it('refuses an empty ayah', () => {
    const empty = rows.map((r) => (r.surah === 108 && r.ayah === 1 ? { ...r, text: '', sha256: sha256Hex('') } : r));
    expect(refusal(() => verifyDataset(empty, pinned))).toBe('empty');
  });

  it('does not depend on the order rows arrive in', () => {
    expect(verifyDataset([...rows].reverse(), pinned).size).toBe(6236);
  });
});

describe('every ayah has exactly one audio key, and it names that ayah', () => {
  it('encodes surah and ayah, and decodes back to the same pair, for all 6,236 ayat', () => {
    const keys = new Set<string>();
    for (const s of SURAHS) {
      for (let a = 1; a <= s.ayahCount; a++) {
        const key = audioKey('alafasy-128', s.number, a);
        keys.add(key);
        expect(parseAudioKey(key)).toEqual({ reciter: 'alafasy-128', surah: s.number, ayah: a });
      }
    }
    expect(keys.size).toBe(6236);
    // The same formula as the SQL generated column (migration 20261027170000).
    expect(audioKey('alafasy-128', 85, 3)).toBe('quran/audio/alafasy-128/085003.mp3');
    expect(audioKey('alafasy-128', 1, 7)).toBe('quran/audio/alafasy-128/001007.mp3');
  });

  it('refuses an ayah that does not exist and a malformed reciter', () => {
    expect(() => audioKey('alafasy-128', 89, 31)).toThrow();
    expect(() => audioKey('alafasy-128', 115, 1)).toThrow();
    expect(() => audioKey('../etc', 1, 1)).toThrow();
    expect(parseAudioKey('quran/audio/alafasy-128/089031.mp3')).toBeNull();
  });
});

describe('Tajweed: only an approved mark of a signed-off surah is ever served', () => {
  const mark = (over: Partial<TajweedMark> = {}): TajweedMark => ({
    datasetId: 'synthetic-1', surah: 101, ayah: 6, start: 4, end: 7, rule: 'ikhfa',
    source: 'qul', sourceVersion: 'v1', state: 'approved', ...over,
  });
  const review: TajweedReview = { datasetId: 'synthetic-1', surah: 101, source: 'qul', sourceVersion: 'v1' };
  const texts = new Map([['101:6', 'فَأَمَّا مَن ثَقُلَتْ مَوَازِينُهُ']]);

  it('serves an approved mark whose surah is signed off for the same source version', () => {
    expect(servableMarks([mark()], [review], texts)).toHaveLength(1);
  });

  it('never serves a pending or rejected mark', () => {
    expect(servableMarks([mark({ state: 'pending' }), mark({ state: 'rejected' })], [review], texts)).toEqual([]);
  });

  it('never serves an approved mark without the surah sign-off, or signed off for another version or source', () => {
    expect(servableMarks([mark()], [], texts)).toEqual([]);
    expect(servableMarks([mark()], [{ ...review, sourceVersion: 'v2' }], texts)).toEqual([]);
    expect(servableMarks([mark()], [{ ...review, source: 'other' }], texts)).toEqual([]);
    expect(servableMarks([mark({ datasetId: 'other' })], [review], texts)).toEqual([]);
  });

  it('never serves a mark outside its ayah\'s text (code points, end exclusive)', () => {
    const len = [...texts.get('101:6')!].length;
    expect(servableMarks([mark({ start: 0, end: len })], [review], texts)).toHaveLength(1);
    expect(servableMarks([mark({ start: 0, end: len + 1 })], [review], texts)).toEqual([]);
    expect(servableMarks([mark({ start: 5, end: 5 })], [review], texts)).toEqual([]);
    expect(servableMarks([mark({ ayah: 7 })], [review], texts)).toEqual([]);
  });
});

describe('the pinned Tanzil dataset (data/quran/tanzil-uthmani-1.1.txt)', () => {
  it('verifies in TypeScript exactly as the loader verifies it: same file hash, same digest', () => {
    const pinned = PINNED_QURAN_DATASETS.get('tanzil-uthmani-1.1')!;
    const raw = readFileSync(join(__dirname, '../../../../../data/quran/tanzil-uthmani-1.1.txt'));
    expect(require('node:crypto').createHash('sha256').update(raw).digest('hex')).toBe(pinned.fileSha256);
    const rows = raw.toString('utf8').split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const [s, a, ...rest] = line.split('|');
        const text = rest.join('|');
        return { surah: Number(s), ayah: Number(a), text, sha256: sha256Hex(text) };
      });
    const verified = verifyDataset(rows, pinned);
    expect(verified.size).toBe(6236);
    // Never compare against hand-typed Arabic: identical-looking text can differ in code points.
    expect(rows[0]).toMatchObject({ surah: 1, ayah: 1 });
    expect(rows[rows.length - 1]).toMatchObject({ surah: 114, ayah: 6 });
  });
});

