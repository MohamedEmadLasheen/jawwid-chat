/**
 * The shared Quran dataset (PD-29 amendment, materials quality P0-2; the
 * contract is docs/product/quran-dataset-contract.md). The owner's rule: the
 * text is checked against a fixed fingerprint at EVERY load, Tajweed is shown
 * only once approved, and text, audio and Tajweed can never fall out of step.
 *
 * These are the pure checks; the service and the loader both use them.
 */
import { SURAHS } from '../../../src/materials/quran-surahs';
import { BASMALA_SHA256, QuranIntegrityError, sha256Hex, splitBasmala, verifyDataset } from '../../../src/quran/quran-integrity';
import { audioKey, parseAudioKey } from '../../../src/quran/audio-key';
import { marksDigest, servableMarks, type TajweedMark, type TajweedReview } from '../../../src/quran/tajweed';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PINNED_QURAN_DATASETS } from '../../../src/quran/pinned';
import { BASMALA, BASMALA_SHADDA, pinnedFor, realRows, rowOf, syntheticRows } from './fixtures';

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
    expect(verified.get('85:22')!.verseSha256).toBe(sha256Hex('نص 85:22'));
  });

  it('refuses a tampered text, even with its own hash recomputed to match', () => {
    // A changed letter whose row hash was updated with it: only the pinned digest catches it.
    const tampered = rows.map((r) => (r.surah === 101 && r.ayah === 4 ? rowOf(101, 4, r.text + 'ـ') : r));
    expect(refusal(() => verifyDataset(tampered, pinned))).toBe('digest');
  });

  it('refuses a text whose stored hash does not match the text', () => {
    const tampered = rows.map((r) => (r.surah === 1 && r.ayah === 1 ? { ...r, text: 'x' } : r));
    expect(refusal(() => verifyDataset(tampered, pinned))).toBe('ayah-hash');
  });

  it('refuses a count mismatch: a missing ayah, a split ayah, an ayah past the end, a duplicate', () => {
    const missing = rows.filter((r) => !(r.surah === 89 && r.ayah === 23));
    expect(refusal(() => verifyDataset(missing, pinned))).toBe('count');

    const split = [...rows, rowOf(89, 31, 'extra')];
    expect(refusal(() => verifyDataset(split, pinned))).toBe('count');

    const shifted = rows.map((r) => (r.surah === 114 && r.ayah === 6 ? { ...r, ayah: 7 } : r));
    expect(refusal(() => verifyDataset(shifted, pinned))).toBe('numbering');

    const duplicate = rows.map((r) => (r.surah === 112 && r.ayah === 4 ? { ...r, ayah: 3 } : r));
    expect(refusal(() => verifyDataset(duplicate, pinned))).toBe('numbering');
  });

  it('refuses an empty ayah', () => {
    const empty = rows.map((r) => (r.surah === 108 && r.ayah === 2 ? { ...r, text: '', sha256: sha256Hex(''), verse: '' } : r));
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

describe('the Basmala is split from ayah 1 and never counted as the verse', () => {
  const real = realRows();
  const verified = verifyDataset(real, pinnedFor(real, 'tanzil-uthmani-1.1'));
  const cps = (t: string) => [...t].map((c) => c.codePointAt(0));

  it('accepts exactly two Basmala spellings, by hash', () => {
    expect(BASMALA_SHA256.has(sha256Hex(BASMALA))).toBe(true);
    expect(BASMALA_SHA256.has(sha256Hex(BASMALA_SHADDA))).toBe(true);
    expect(BASMALA_SHA256.size).toBe(2);
  });

  it('2:1 is served as the Basmala and the verse "الٓمٓ" (U+0627 U+0644 U+0653 U+0645 U+0653)', () => {
    const v = verified.get('2:1')!;
    expect(v.basmala).toBe(BASMALA);
    expect(cps(v.verse)).toEqual([0x627, 0x644, 0x653, 0x645, 0x653]);
    expect(v.verseSha256).toBe(sha256Hex(v.verse));
  });

  it('95:1 and 97:1 carry the bi-shadda spelling, split the same way', () => {
    for (const s of [95, 97]) {
      const v = verified.get(`${s}:1`)!;
      expect(v.basmala).toBe(BASMALA_SHADDA);
      expect(`${v.basmala} ${v.verse}`).toBe(real.find((r) => r.surah === s && r.ayah === 1)!.text);
    }
  });

  it('every one of the 112 other surahs has a Basmala on ayah 1; 1:1 IS the verse; 9:1 has none', () => {
    const withBasmala = [...verified.entries()].filter(([, v]) => v.basmala !== null).map(([k]) => k);
    expect(withBasmala).toHaveLength(112);
    expect(withBasmala.every((k) => k.endsWith(':1'))).toBe(true);
    expect(verified.get('1:1')).toMatchObject({ basmala: null, verse: BASMALA });
    expect(verified.get('9:1')!.basmala).toBeNull();
    expect(verified.get('27:30')!.basmala).toBeNull(); // the Basmala inside an ayah is part of the verse
  });

  it('refuses a corrupted prefix, a missing one, and a Basmala on 9:1 -- even with re-hashed rows', () => {
    const corrupt = (surah: number, text: string) => {
      const rows = real.map((r) => (r.surah === surah && r.ayah === 1 ? { ...r, text, sha256: sha256Hex(text), basmala: undefined, verse: undefined } : r));
      return () => verifyDataset(rows, pinnedFor(rows, 'x'));
    };
    const twoOne = real.find((r) => r.surah === 2 && r.ayah === 1)!.text;
    expect(refusal(corrupt(2, twoOne.slice(0, 2) + twoOne.slice(3)))).toBe('basmala'); // one mark dropped from the Basmala
    expect(refusal(corrupt(2, twoOne.split(' ').slice(4).join(' ')))).toBe('basmala'); // no Basmala at all
    const nineOne = real.find((r) => r.surah === 9 && r.ayah === 1)!.text;
    expect(refusal(corrupt(9, `${BASMALA} ${nineOne}`))).toBe('basmala');
    expect(() => splitBasmala(2, 1, `${BASMALA}  x`)).toThrow(QuranIntegrityError); // two spaces: not the exact form
  });

  it('refuses a stored split that is not the text\'s', () => {
    const rows = real.map((r) => (r.surah === 2 && r.ayah === 1 ? { ...r, basmala: null, verse: r.text } : r));
    expect(refusal(() => verifyDataset(rows, pinnedFor(rows, 'x')))).toBe('basmala');
  });
});

describe('Tajweed: only marks named by the latest sign-off, approved and not withdrawn, are served', () => {
  const verse = 'فَأَمَّا مَن ثَقُلَتْ مَوَازِينُهُ';
  const verses = new Map([['101:6', verse], ['101:7', 'فَهُوَ فِى عِيشَةٍ رَّاضِيَةٍ']]);
  const mark = (id: string, over: Partial<TajweedMark> = {}): TajweedMark => ({
    id, datasetId: 'synthetic-1', surah: 101, ayah: 6, start: 4, end: 7, rule: 'ikhfa',
    source: 'qul', sourceVersion: 'v1', state: 'approved', ...over,
  });
  const review = (marks: TajweedMark[], over: Partial<TajweedReview> = {}): TajweedReview => ({
    datasetId: 'synthetic-1', surah: 101, source: 'qul', sourceVersion: 'v1',
    markIds: marks.map((m) => m.id), marksDigest: marksDigest(marks), reviewedAt: '2026-10-27T10:00:00Z', ...over,
  });
  const none = new Set<string>();

  it('serves the marks a sign-off names', () => {
    const a = mark('a');
    expect(servableMarks([a], [review([a])], none, verses)).toEqual([a]);
  });

  it('never serves a pending or rejected mark, even if a sign-off names it', () => {
    const p = mark('p', { state: 'pending' });
    const r = mark('r', { state: 'rejected' });
    expect(servableMarks([p, r], [review([p, r])], none, verses)).toEqual([]);
  });

  it('does not serve a mark approved AFTER the sign-off until a new sign-off names it', () => {
    const a = mark('a');
    const late = mark('late', { ayah: 7, start: 0, end: 3 });
    expect(servableMarks([a, late], [review([a])], none, verses)).toEqual([a]);
    const resigned = review([a, late], { reviewedAt: '2026-10-28T10:00:00Z' });
    expect(servableMarks([a, late], [review([a]), resigned], none, verses)).toEqual([a, late]);
  });

  it('only the LATEST sign-off of a surah and source version counts', () => {
    const a = mark('a');
    const b = mark('b', { ayah: 7, start: 0, end: 3 });
    const older = review([a, b], { reviewedAt: '2026-10-27T10:00:00Z' });
    const newer = review([b], { reviewedAt: '2026-10-29T10:00:00Z' });
    expect(servableMarks([a, b], [older, newer], none, verses)).toEqual([b]);
  });

  it('serves nothing of a sign-off whose digest no longer matches the marks it names', () => {
    const a = mark('a');
    const signed = review([a]);
    expect(servableMarks([{ ...a, end: 8 }], [signed], none, verses)).toEqual([]);
    expect(servableMarks([], [signed], none, verses)).toEqual([]); // a named mark that cannot be read
  });

  it('never serves a withdrawn mark; the rest of the sign-off stays', () => {
    const a = mark('a');
    const b = mark('b', { ayah: 7, start: 0, end: 3 });
    expect(servableMarks([a, b], [review([a, b])], new Set(['a']), verses)).toEqual([b]);
  });

  it('never serves a mark of another dataset, source or version under this sign-off', () => {
    for (const over of [{ datasetId: 'other' }, { source: 'other' }, { sourceVersion: 'v2' }]) {
      const m = mark('m', over);
      expect(servableMarks([m], [review([mark('m')])], none, verses)).toEqual([]);
    }
  });

  it('never serves a mark outside its verse (code points, end exclusive)', () => {
    const len = [...verse].length;
    const ok = mark('ok', { start: 0, end: len });
    const past = mark('past', { start: 0, end: len + 1 });
    const empty = mark('empty', { start: 5, end: 5 });
    const absent = mark('absent', { ayah: 8 });
    expect(servableMarks([ok, past, empty, absent], [review([ok, past, empty, absent])], none, verses)).toEqual([ok]);
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

