/**
 * QuranTextService: the text is verified against its pinned fingerprints when
 * the API starts, and each ayah again when it is served. Anything that does not
 * verify is refused (503), never served "as is". Audio is attached only through
 * the one ayah -> key mapping; Tajweed only when approved and signed off.
 */
import { CommError, CommErrorCode } from '../../../src/platform/errors';
import { QuranTextService, type QuranStore, type StoredDataset } from '../../../src/quran/quran-text.service';
import { sha256Hex, type AyahRow, type PinnedDataset } from '../../../src/quran/quran-integrity';
import { audioKey } from '../../../src/quran/audio-key';
import type { TajweedMark, TajweedReview } from '../../../src/quran/tajweed';
import { pinnedFor, syntheticRows } from './fixtures';

class FakeStore implements QuranStore {
  configured: string | null = 'synthetic-1';
  rows: AyahRow[] = syntheticRows();
  stored: StoredDataset | null;
  audioSourceValue: { reciter: string; baseUrl: string } | null = null;
  audioRows: Array<{ surah: number; ayah: number; objectKey: string; sha256: string }> = [];
  marks: TajweedMark[] = [];
  reviews: TajweedReview[] = [];

  constructor(readonly pinned: PinnedDataset) {
    this.stored = { id: pinned.id, sha256: pinned.fileSha256, ayahsDigest: pinned.ayahsDigest, attribution: pinned.attribution, sourceUrl: pinned.sourceUrl };
  }
  async configuredDatasetId() { return this.configured; }
  async dataset(id: string) { return this.stored && this.stored.id === id ? this.stored : null; }
  async allAyahs() { return this.rows; }
  async ayahs(_id: string, surah: number, from: number, to: number) {
    return this.rows.filter((r) => r.surah === surah && r.ayah >= from && r.ayah <= to);
  }
  async audioSource() { return this.audioSourceValue; }
  async audio(_reciter: string, surah: number, from: number, to: number) {
    return this.audioRows.filter((r) => r.surah === surah && r.ayah >= from && r.ayah <= to);
  }
  async tajweed() { return { marks: this.marks, reviews: this.reviews }; }
}

async function setup(adjust?: (store: FakeStore) => void) {
  const pinned = pinnedFor(syntheticRows());
  const store = new FakeStore(pinned);
  adjust?.(store);
  const service = new QuranTextService(store, new Map([[pinned.id, pinned]]));
  await service.onApplicationBootstrap();
  return { service, store, pinned };
}

async function refusedWith(p: Promise<unknown>): Promise<CommError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CommError);
    return e as CommError;
  }
  throw new Error('expected a refusal');
}

describe('QuranTextService', () => {
  it('serves a verified range with the dataset, its attribution and a range fingerprint', async () => {
    const { service, pinned } = await setup();
    const res = await service.ayahs({ surah: '85', from: '1', to: '3' });
    expect(res.dataset).toEqual({ id: pinned.id, sha256: pinned.fileSha256, attribution: 'test', sourceUrl: pinned.sourceUrl });
    expect(res.surah).toMatchObject({ number: 85, ayahCount: 22 });
    expect(res.ayahs.map((a) => a.ayah)).toEqual([1, 2, 3]);
    expect(res.ayahs[0]).toMatchObject({ text: 'نص 85:1', sha256: sha256Hex('نص 85:1'), audio: null });
    expect(res.rangeSha256).toBe(sha256Hex(res.ayahs.map((a) => a.sha256).join('\n')));
  });

  it('refuses everything (503) when the stored dataset is not the pinned one', async () => {
    const { service } = await setup((s) => { s.stored = { ...s.stored!, sha256: 'e'.repeat(64) }; });
    const e = await refusedWith(service.ayahs({ surah: '1', from: '1', to: '7' }));
    expect(e.code).toBe(CommErrorCode.QURAN_UNAVAILABLE);
    expect(e.status).toBe(503);
  });

  it('refuses everything when a row was tampered with before the API started', async () => {
    const { service } = await setup((s) => {
      s.rows = s.rows.map((r) => (r.surah === 101 && r.ayah === 4 ? { ...r, text: 'x', sha256: sha256Hex('x') } : r));
    });
    expect((await refusedWith(service.ayahs({ surah: '114', from: '1', to: '6' }))).status).toBe(503);
  });

  it('refuses a row tampered with AFTER start-up, and stops serving until it verifies again', async () => {
    const { service, store } = await setup();
    await expect(service.ayahs({ surah: '101', from: '1', to: '5' })).resolves.toBeDefined();
    store.rows = store.rows.map((r) => (r.surah === 101 && r.ayah === 4 ? { ...r, text: 'x', sha256: sha256Hex('x') } : r));
    expect((await refusedWith(service.ayahs({ surah: '101', from: '1', to: '5' }))).status).toBe(503);
    // Fail closed: even an untouched surah is refused now.
    expect((await refusedWith(service.ayahs({ surah: '1', from: '1', to: '7' }))).status).toBe(503);
  });

  it('refuses a dataset that is not configured, not pinned or not loaded', async () => {
    for (const adjust of [
      (s: FakeStore) => { s.configured = null; },
      (s: FakeStore) => { s.configured = 'someone-elses'; },
      (s: FakeStore) => { s.stored = null; },
    ]) {
      const { service } = await setup(adjust);
      expect((await refusedWith(service.ayahs({ surah: '1', from: '1', to: '1' }))).status).toBe(503);
    }
  });

  it('validates the range: a real surah, 1 <= from <= to <= its ayah count, at most 50 ayat', async () => {
    const { service } = await setup();
    for (const q of [
      { surah: '0', from: '1', to: '1' }, { surah: '115', from: '1', to: '1' }, { surah: '89', from: '1', to: '31' },
      { surah: '2', from: '1', to: '51' }, { surah: '2', from: '5', to: '4' }, { surah: 'x', from: '1', to: '1' },
    ]) {
      const e = await refusedWith(service.ayahs(q));
      expect(e.code).toBe(CommErrorCode.QURAN_INVALID);
      expect(e.status).toBe(422);
    }
    expect((await service.ayahs({ surah: '2', from: '1', to: '50' })).ayahs).toHaveLength(50);
    expect((await service.ayahs({ surah: '112' })).ayahs).toHaveLength(4);
  });

  it('attaches audio only through the ayah -> key mapping, and only when a source is configured', async () => {
    const key = audioKey('alafasy-128', 113, 2);
    const { service, store } = await setup((s) => {
      s.audioSourceValue = { reciter: 'alafasy-128', baseUrl: 'https://media.example.test' };
      s.audioRows = [
        { surah: 113, ayah: 1, objectKey: audioKey('alafasy-128', 113, 1), sha256: 'a'.repeat(64) },
        { surah: 113, ayah: 2, objectKey: key, sha256: 'b'.repeat(64) },
        // A row whose key names another ayah is never served for this one.
        { surah: 113, ayah: 3, objectKey: audioKey('alafasy-128', 78, 5), sha256: 'c'.repeat(64) },
      ];
    });
    const res = await service.ayahs({ surah: '113', from: '1', to: '5' });
    expect(res.ayahs[1]!.audio).toEqual({ reciter: 'alafasy-128', key, url: `https://media.example.test/${key}`, sha256: 'b'.repeat(64) });
    expect(res.ayahs[2]!.audio).toBeNull();
    expect(res.ayahs[4]!.audio).toBeNull();
    store.audioSourceValue = null;
    expect((await service.ayahs({ surah: '113', from: '1', to: '2' })).ayahs.every((a) => a.audio === null)).toBe(true);
  });

  it('serves no Tajweed mark that is not approved and signed off', async () => {
    const mark: TajweedMark = { datasetId: 'synthetic-1', surah: 101, ayah: 1, start: 0, end: 2, rule: 'madd_tabii', source: 'qul', sourceVersion: 'v1', state: 'pending' };
    const { service, store } = await setup((s) => { s.marks = [mark]; s.reviews = [{ datasetId: 'synthetic-1', surah: 101, source: 'qul', sourceVersion: 'v1' }]; });
    expect((await service.tajweed({ surah: '101', from: '1', to: '11' })).marks).toEqual([]);
    store.marks = [{ ...mark, state: 'approved' }];
    expect((await service.tajweed({ surah: '101', from: '1', to: '11' })).marks).toEqual([
      { ayah: 1, start: 0, end: 2, rule: 'madd_tabii', source: 'qul', sourceVersion: 'v1' },
    ]);
    store.reviews = [];
    expect((await service.tajweed({ surah: '101', from: '1', to: '11' })).marks).toEqual([]);
  });
});
