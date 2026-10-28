/**
 * QuranTextService: the text is verified against its pinned fingerprints when
 * the API starts, and each ayah again when it is served. Anything that does not
 * verify is refused (503), never served "as is". Audio is attached only through
 * the one ayah -> key mapping; Tajweed only when approved and signed off.
 */
import { CommError, CommErrorCode } from '../../../src/platform/errors';
import { QuranTextService, REVERIFY_COOLDOWN_MS, type QuranStore, type StoredDataset } from '../../../src/quran/quran-text.service';
import { sha256Hex, type AyahRow, type PinnedDataset } from '../../../src/quran/quran-integrity';
import { audioKey } from '../../../src/quran/audio-key';
import { marksDigest, type TajweedMark, type TajweedReview } from '../../../src/quran/tajweed';
import type { AudioAudience } from '../../../src/quran/audio-gate';
import type { AudioSourceSpec } from '../../../src/quran/audio-sources';
import type { ObjectStorage } from '../../../src/communication/attachments/object-storage';
import { BASMALA, pinnedFor, rowOf, syntheticRows } from './fixtures';

class FakeStore implements QuranStore {
  configured: string | null = 'synthetic-1';
  rows: AyahRow[] = syntheticRows();
  stored: StoredDataset | null;
  audioSourceValue: { reciter: string } | null = null;
  audience: AudioAudience = 'none';
  testStaffIds: string[] = [];
  audioRows: Array<{ surah: number; ayah: number; objectKey: string; sha256: string }> = [];
  marks: TajweedMark[] = [];
  reviews: TajweedReview[] = [];
  withdrawn: string[] = [];
  datasetCalls = 0;
  failDataset = false;

  constructor(readonly pinned: PinnedDataset) {
    this.stored = { id: pinned.id, sha256: pinned.fileSha256, ayahsDigest: pinned.ayahsDigest, attribution: pinned.attribution, sourceUrl: pinned.sourceUrl };
  }
  async configuredDatasetId() { return this.configured; }
  async dataset(id: string) {
    this.datasetCalls++;
    if (this.failDataset) throw new Error('connection refused');
    return this.stored && this.stored.id === id ? this.stored : null;
  }
  async allAyahs() { return this.rows; }
  async ayahs(_id: string, surah: number, from: number, to: number) {
    return this.rows.filter((r) => r.surah === surah && r.ayah >= from && r.ayah <= to);
  }
  async audioSource() { return this.audioSourceValue; }
  async audioGate() { return { audience: this.audience, testStaffIds: this.testStaffIds }; }
  async audio(_reciter: string, surah: number, from: number, to: number) {
    return this.audioRows.filter((r) => r.surah === surah && r.ayah >= from && r.ayah <= to);
  }
  async tajweed() { return { marks: this.marks, reviews: this.reviews, withdrawn: this.withdrawn }; }
}

const STAFF = { kind: 'staff', actorId: 'owner', staffRole: 'super_admin' } as const;
const PARENT = { kind: 'contact', actorId: 'parent' } as const;
const RECITER = 'test-reciter';
const LICENCE = { confirmedBy: 'owner', confirmedAt: '2026-11-01', reference: 'test' };
const source = (licence: AudioSourceSpec['licence']): AudioSourceSpec => ({ reciter: RECITER, name: 'Test', attribution: 'test', licence, archives: [] });
/** Signed, short-lived, uncacheable read URLs: licensed audio is never at a permanent public address. */
const signing = {
  signedReadUrl: async (key: string, ttl: number, opts?: { cacheControl?: string }) =>
    `https://media.example.test/${key}?ttl=${ttl}&cc=${encodeURIComponent(opts?.cacheControl ?? '')}&sig=x`,
} as unknown as ObjectStorage;

async function setup(adjust?: (store: FakeStore) => void, licence: AudioSourceSpec['licence'] = null) {
  const pinned = pinnedFor(syntheticRows());
  const store = new FakeStore(pinned);
  adjust?.(store);
  const service = new QuranTextService(store, new Map([[pinned.id, pinned]]), signing, new Map([[RECITER, source(licence)]]));
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
    // Ayah 1 is served as the Basmala and the verse; the hash is the verse's.
    expect(res.ayahs[0]).toMatchObject({ basmala: BASMALA, text: 'نص 85:1', sha256: sha256Hex('نص 85:1'), audio: null });
    expect(res.ayahs[1]).toMatchObject({ basmala: null, text: 'نص 85:2' });
    // The range reference is over the verses, never the Basmala prefix.
    expect(res.rangeSha256).toBe(sha256Hex(['نص 85:1', 'نص 85:2', 'نص 85:3'].map((t) => sha256Hex(t)).join('\n')));
  });

  it('refuses everything (503) when the stored dataset is not the pinned one', async () => {
    const { service } = await setup((s) => { s.stored = { ...s.stored!, sha256: 'e'.repeat(64) }; });
    const e = await refusedWith(service.ayahs({ surah: '1', from: '1', to: '7' }));
    expect(e.code).toBe(CommErrorCode.QURAN_UNAVAILABLE);
    expect(e.status).toBe(503);
  });

  it('refuses everything when a row was tampered with before the API started', async () => {
    const { service } = await setup((s) => {
      s.rows = s.rows.map((r) => (r.surah === 101 && r.ayah === 4 ? rowOf(101, 4, 'x') : r));
    });
    expect((await refusedWith(service.ayahs({ surah: '114', from: '1', to: '6' }))).status).toBe(503);
  });

  it('refuses a row tampered with AFTER start-up, and stops serving until it verifies again', async () => {
    const { service, store } = await setup();
    await expect(service.ayahs({ surah: '101', from: '1', to: '5' })).resolves.toBeDefined();
    store.rows = store.rows.map((r) => (r.surah === 101 && r.ayah === 4 ? rowOf(101, 4, 'x') : r));
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

  it('attaches audio only through the ayah -> key mapping, as a signed URL, when the gate lets this account have it', async () => {
    const key = audioKey(RECITER, 113, 2);
    const { service, store } = await setup((s) => {
      s.audience = 'staff_test';
      s.audioSourceValue = { reciter: RECITER };
      s.audioRows = [
        { surah: 113, ayah: 1, objectKey: audioKey(RECITER, 113, 1), sha256: 'a'.repeat(64) },
        { surah: 113, ayah: 2, objectKey: key, sha256: 'b'.repeat(64) },
        // A row whose key names another ayah is never served for this one.
        { surah: 113, ayah: 3, objectKey: audioKey(RECITER, 78, 5), sha256: 'c'.repeat(64) },
      ];
    });
    const res = await service.ayahs({ surah: '113', from: '1', to: '5' }, STAFF);
    expect(res.ayahs[1]!.audio).toEqual({ reciter: RECITER, key, url: `https://media.example.test/${key}?ttl=3600&cc=${encodeURIComponent('private, no-store')}&sig=x`, sha256: 'b'.repeat(64) });
    expect(res.ayahs[2]!.audio).toBeNull();
    expect(res.ayahs[4]!.audio).toBeNull();
    // A parent or a student: no audio under staff_test.
    expect((await service.ayahs({ surah: '113', from: '1', to: '2' }, PARENT)).ayahs.every((a) => a.audio === null)).toBe(true);
    store.audioSourceValue = null;
    expect((await service.ayahs({ surah: '113', from: '1', to: '2' }, STAFF)).ayahs.every((a) => a.audio === null)).toBe(true);
  });

  it('the release gate: none (the default) gives nobody audio; all gives students audio ONLY with the licence recorded', async () => {
    const rows = (s: FakeStore) => {
      s.audioSourceValue = { reciter: RECITER };
      s.audioRows = [{ surah: 113, ayah: 1, objectKey: audioKey(RECITER, 113, 1), sha256: 'a'.repeat(64) }];
    };
    const audioFor = async (service: QuranTextService, who: { kind: string; actorId: string; staffRole?: string }) =>
      (await service.ayahs({ surah: '113', from: '1', to: '1' }, who)).ayahs[0]!.audio;
    const none = await setup(rows);
    expect(await audioFor(none.service, STAFF)).toBeNull();
    expect(await audioFor(none.service, PARENT)).toBeNull();
    const unlicensed = await setup((s) => { rows(s); s.audience = 'all'; });
    expect(await audioFor(unlicensed.service, STAFF)).not.toBeNull();
    expect(await audioFor(unlicensed.service, PARENT)).toBeNull();
    const licensed = await setup((s) => { rows(s); s.audience = 'all'; }, LICENCE);
    expect(await audioFor(licensed.service, PARENT)).not.toBeNull();
    // A reciter with no source spec in code gets no audio at all, whatever the config says.
    const unknown = await setup((s) => { rows(s); s.audience = 'all'; s.audioSourceValue = { reciter: 'someone-else' }; }, LICENCE);
    expect(await audioFor(unknown.service, STAFF)).toBeNull();
    // No account (an internal caller): no audio.
    expect((await licensed.service.ayahs({ surah: '113', from: '1', to: '1' })).ayahs[0]!.audio).toBeNull();
  });

  it('refuses a row whose stored Basmala split was changed after start-up', async () => {
    const { service, store } = await setup();
    store.rows = store.rows.map((r) => (r.surah === 2 && r.ayah === 1 ? { ...r, basmala: null, verse: r.text } : r));
    expect((await refusedWith(service.ayahs({ surah: '2', from: '1', to: '2' }))).status).toBe(503);
  });

  it('applies the cooldown after a CRASHED verification too: no re-read on every request', async () => {
    const { service, store } = await setup((s) => { s.failDataset = true; });
    const after = store.datasetCalls;
    expect((await refusedWith(service.ayahs({ surah: '1' }))).status).toBe(503);
    expect((await refusedWith(service.ayahs({ surah: '1' }))).status).toBe(503);
    expect(store.datasetCalls - after).toBeLessThanOrEqual(1);
    // After the cooldown, a healthy store verifies again.
    store.failDataset = false;
    jest.useFakeTimers({ now: Date.now() + REVERIFY_COOLDOWN_MS + 1, doNotFake: ['nextTick', 'setImmediate'] });
    try {
      expect((await service.ayahs({ surah: '1' })).ayahs).toHaveLength(7);
    } finally {
      jest.useRealTimers();
    }
  });

  it('serves no Tajweed mark that is not approved, signed off and still in force', async () => {
    const mark: TajweedMark = { id: 'm1', datasetId: 'synthetic-1', surah: 101, ayah: 2, start: 0, end: 2, rule: 'madd_tabii', source: 'qul', sourceVersion: 'v1', state: 'pending' };
    const signOff = (marks: TajweedMark[]): TajweedReview => ({
      datasetId: 'synthetic-1', surah: 101, source: 'qul', sourceVersion: 'v1', markIds: marks.map((m) => m.id), marksDigest: marksDigest(marks), reviewedAt: '2026-10-27T10:00:00Z',
    });
    const { service, store } = await setup((s) => { s.marks = [mark]; s.reviews = [signOff([mark])]; });
    expect((await service.tajweed({ surah: '101', from: '1', to: '11' })).marks).toEqual([]);
    store.marks = [{ ...mark, state: 'approved' }];
    store.reviews = [signOff([{ ...mark, state: 'approved' }])];
    expect((await service.tajweed({ surah: '101', from: '1', to: '11' })).marks).toEqual([
      { ayah: 2, start: 0, end: 2, rule: 'madd_tabii', source: 'qul', sourceVersion: 'v1' },
    ]);
    store.withdrawn = ['m1'];
    expect((await service.tajweed({ surah: '101', from: '1', to: '11' })).marks).toEqual([]);
    store.withdrawn = [];
    store.reviews = [];
    expect((await service.tajweed({ surah: '101', from: '1', to: '11' })).marks).toEqual([]);
  });
});
