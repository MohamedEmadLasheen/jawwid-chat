import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { OBJECT_STORAGE } from '../platform/tokens';
import { CommError, CommErrorCode } from '../platform/errors';
import { surahOf } from '../materials/quran-surahs';
import { audioKey } from './audio-key';
import {
  QuranIntegrityError,
  ayahKey,
  digestOf,
  sha256Hex,
  verifyDataset,
  type AyahRow,
  type PinnedDataset,
  type VerifiedAyah,
} from './quran-integrity';
import { servableMarks, type TajweedMark, type TajweedReview } from './tajweed';
import { audioAllowed, type AudioAudience } from './audio-gate';
import { AUDIO_SOURCES, type AudioSourceSpec } from './audio-sources';

export const QURAN_STORE = Symbol('QURAN_STORE');
export const QURAN_PINNED = Symbol('QURAN_PINNED');
export const QURAN_AUDIO_SOURCES = Symbol('QURAN_AUDIO_SOURCES');
/** How long a signed audio URL stays valid: one lesson's sitting. */
export const AUDIO_URL_TTL_SECONDS = 3600;

/** The dataset's row as loaded (chat.quran_dataset). */
export interface StoredDataset {
  id: string;
  sha256: string;
  ayahsDigest: string;
  attribution: string;
  sourceUrl: string;
}

/** Where the service reads from; PrismaQuranStore in production. */
export interface QuranStore {
  /** chat.config `quran.dataset`: the dataset id to serve, or null. */
  configuredDatasetId(): Promise<string | null>;
  dataset(id: string): Promise<StoredDataset | null>;
  allAyahs(id: string): Promise<AyahRow[]>;
  ayahs(id: string, surah: number, from: number, to: number): Promise<AyahRow[]>;
  /** chat.config `quran.audio`: { reciter }, or null while no audio is configured. */
  audioSource(): Promise<{ reciter: string } | null>;
  /** chat.config `quran.audio.enabled_for` -- the release gate's audience (audio-gate.ts); `none` unless set. */
  audioAudience(): Promise<AudioAudience>;
  audio(reciter: string, surah: number, from: number, to: number): Promise<Array<{ surah: number; ayah: number; objectKey: string; sha256: string }>>;
  /**
   * A surah's sign-offs, every mark they name or that is approved (whatever the
   * range: a sign-off's digest covers its whole set), and the withdrawn mark ids.
   */
  tajweed(id: string, surah: number): Promise<{ marks: TajweedMark[]; reviews: TajweedReview[]; withdrawn: string[] }>;
}

export const MAX_AYAHS_PER_REQUEST = 50;
/** After a failed verification, how long before a request may trigger another full read. */
export const REVERIFY_COOLDOWN_MS = 30_000;

type State =
  | { ok: true; id: string; pinned: PinnedDataset; verified: Map<string, VerifiedAyah> }
  | { ok: false; id: string | null; reason: string };

/**
 * The shared Quran text (PD-29 amendment, materials quality P0-2), read by
 * Materials and the PD-39 whiteboard alike (docs/product/quran-dataset-contract.md).
 *
 * FAIL CLOSED. The whole dataset is verified against the fingerprints pinned
 * in code (pinned.ts) when the API starts and whenever the configured dataset
 * changes; every ayah is checked again when it is served -- its text's hash
 * must equal the hash verified at start-up. Anything that does not verify
 * makes the service refuse every request (503 COMM.QURAN_UNAVAILABLE) until a
 * fresh verification succeeds; a verse is never shown "as is". Any failed or
 * crashed verification is retried at most every REVERIFY_COOLDOWN_MS.
 *
 * Each ayah is served as { basmala, text }: `text` is the verse without the
 * Basmala prefix, and its hash (`sha256`) is what Tajweed offsets, audio and the
 * whiteboard's rangeSha256 refer to.
 */
@Injectable()
export class QuranTextService implements OnApplicationBootstrap {
  private readonly log = new Logger(QuranTextService.name);
  private state: State = { ok: false, id: null, reason: 'not verified yet' };
  private lastAttempt = 0;
  /** The configured id the last attempt was for (whatever its outcome). */
  private lastAttemptFor: string | null | undefined = undefined;

  constructor(
    @Inject(QURAN_STORE) private readonly store: QuranStore,
    @Inject(QURAN_PINNED) private readonly pins: ReadonlyMap<string, PinnedDataset>,
    /** Signs each audio URL; without it no audio is attached. */
    @Optional() @Inject(OBJECT_STORAGE) private readonly storage: Pick<ObjectStorage, 'signedReadUrl'> | null = null,
    @Optional() @Inject(QURAN_AUDIO_SOURCES) private readonly sources: ReadonlyMap<string, AudioSourceSpec> = AUDIO_SOURCES,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Never blocks start-up: a failure leaves the Quran routes refusing, nothing else.
    await this.attempt();
  }

  /** Re-read and re-verify the configured dataset from scratch. */
  async verify(): Promise<boolean> {
    this.lastAttempt = Date.now();
    const id = await this.store.configuredDatasetId();
    this.lastAttemptFor = id;
    if (!id) return this.fail(null, 'no dataset configured (chat.config quran.dataset)');
    const pinned = this.pins.get(id);
    if (!pinned) return this.fail(id, 'the configured dataset is not pinned in code');
    const stored = await this.store.dataset(id);
    if (!stored) return this.fail(id, 'the configured dataset is not loaded');
    if (stored.sha256 !== pinned.fileSha256 || stored.ayahsDigest !== pinned.ayahsDigest) {
      return this.fail(id, 'the loaded dataset is not the pinned one');
    }
    try {
      const verified = verifyDataset(await this.store.allAyahs(id), pinned);
      this.state = { ok: true, id, pinned, verified };
      this.log.log(`quran dataset ${id} verified (${verified.size} ayat)`);
      return true;
    } catch (e) {
      if (e instanceof QuranIntegrityError) return this.fail(id, e.message);
      throw e;
    }
  }

  /**
   * A verified range. `actor` is the signed-in caller: audio is attached only
   * when the release gate (audio-gate.ts) lets THIS account have it, only for a
   * reciter pinned in audio-sources.ts, and only as a short-lived signed URL.
   */
  async ayahs(query: Record<string, unknown>, actor?: { kind: string }) {
    const { surah, from, to } = range(query);
    const ok = await this.ready();
    const rows = await this.store.ayahs(ok.id, surah.number, from, to);
    this.checkServed(ok, rows, surah.number, from, to);
    const audio = new Map<number, { reciter: string; key: string; url: string; sha256: string }>();
    const source = actor && this.storage ? await this.store.audioSource() : null;
    const spec = source ? this.sources.get(source.reciter) : undefined;
    if (source && spec && audioAllowed(await this.store.audioAudience(), spec.licence, actor!)) {
      for (const a of await this.store.audio(source.reciter, surah.number, from, to)) {
        // The stored key must be the one key of THIS ayah; anything else is not served.
        const key = audioKey(source.reciter, a.surah, a.ayah);
        if (a.surah === surah.number && a.objectKey === key) {
          audio.set(a.ayah, { reciter: source.reciter, key, url: await this.storage!.signedReadUrl(key, AUDIO_URL_TTL_SECONDS), sha256: a.sha256 });
        }
      }
    }
    const ayahs = [];
    for (let n = from; n <= to; n++) {
      const v = ok.verified.get(ayahKey(surah.number, n))!;
      ayahs.push({ ayah: n, basmala: v.basmala, text: v.verse, sha256: v.verseSha256, audio: audio.get(n) ?? null });
    }
    return {
      dataset: { id: ok.pinned.id, sha256: ok.pinned.fileSha256, attribution: ok.pinned.attribution, sourceUrl: ok.pinned.sourceUrl },
      surah: { number: surah.number, nameAr: surah.nameAr, nameEn: surah.nameEn, ayahCount: surah.ayahCount },
      ayahs,
      rangeSha256: digestOf(ayahs.map((a) => a.sha256)),
    };
  }

  async tajweed(query: Record<string, unknown>) {
    const { surah, from, to } = range(query);
    const ok = await this.ready();
    this.checkServed(ok, await this.store.ayahs(ok.id, surah.number, from, to), surah.number, from, to);
    const verses = new Map<string, string>();
    for (let n = from; n <= to; n++) verses.set(ayahKey(surah.number, n), ok.verified.get(ayahKey(surah.number, n))!.verse);
    const { marks, reviews, withdrawn } = await this.store.tajweed(ok.id, surah.number);
    const own = reviews.filter((r) => r.datasetId === ok.id && r.surah === surah.number);
    return {
      dataset: { id: ok.pinned.id, sha256: ok.pinned.fileSha256 },
      surah: surah.number,
      marks: servableMarks(marks, own, new Set(withdrawn), verses).map((m) => ({
        ayah: m.ayah, start: m.start, end: m.end, rule: m.rule, source: m.source, sourceVersion: m.sourceVersion,
      })),
    };
  }

  /** The verified state, re-verifying when the configured dataset changed or a failure may have cleared. */
  private async ready(): Promise<Extract<State, { ok: true }>> {
    const configured = await this.store.configuredDatasetId();
    // A changed configuration is verified at once; any failure (a refusal OR a crash) is
    // retried at most every REVERIFY_COOLDOWN_MS, so a broken dataset or database cannot be
    // made to re-read 6,236 rows per request.
    const changed = configured !== this.lastAttemptFor;
    const due = Date.now() - this.lastAttempt >= REVERIFY_COOLDOWN_MS;
    if (changed || (!this.state.ok && due)) await this.attempt(configured);
    if (!this.state.ok) {
      throw new CommError(CommErrorCode.QURAN_UNAVAILABLE, 'the Quran text could not be verified', 503);
    }
    return this.state;
  }

  /** One verification attempt that never throws: a crash counts as a failure, with the cooldown. */
  private async attempt(configured?: string | null): Promise<void> {
    try {
      await this.verify();
    } catch (e) {
      this.lastAttempt = Date.now();
      if (configured !== undefined) this.lastAttemptFor = configured;
      this.fail(configured ?? null, `verification crashed: ${String(e)}`);
    }
  }

  /** Every served row must be present, hash to the value verified at start-up, and carry the verified split. */
  private checkServed(ok: Extract<State, { ok: true }>, rows: AyahRow[], surah: number, from: number, to: number) {
    const texts = new Map<string, string>();
    for (const r of rows) {
      const key = ayahKey(r.surah, r.ayah);
      const expected = ok.verified.get(key);
      if (
        !expected || r.surah !== surah || sha256Hex(r.text) !== expected.verbatimSha256 || r.sha256 !== expected.verbatimSha256
        || (r.basmala ?? null) !== expected.basmala || r.verse !== expected.verse
      ) {
        this.fail(ok.id, `served ayah ${key} no longer matches the verified text`);
        throw new CommError(CommErrorCode.QURAN_UNAVAILABLE, 'the Quran text could not be verified', 503);
      }
      texts.set(key, r.text);
    }
    if (texts.size !== to - from + 1) {
      this.fail(ok.id, `surah ${surah} ${from}-${to}: ${texts.size} rows read`);
      throw new CommError(CommErrorCode.QURAN_UNAVAILABLE, 'the Quran text could not be verified', 503);
    }
    return texts;
  }

  private fail(id: string | null, reason: string): false {
    this.state = { ok: false, id, reason };
    this.log.error(`quran dataset refused: ${reason}`);
    return false;
  }
}

function int(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\d{1,4}$/.test(v)) return Number(v);
  return null;
}

/** ?surah=N&from=A&to=B -- from and to default to the whole surah, capped at 50 ayat. */
function range(query: Record<string, unknown>) {
  const n = int(query.surah);
  const surah = n === null ? null : surahOf(n);
  if (!surah) throw new CommError(CommErrorCode.QURAN_INVALID, 'surah: a number from 1 to 114', 422);
  const from = query.from === undefined ? 1 : int(query.from);
  const to = query.to === undefined ? Math.min(surah.ayahCount, (from ?? 1) + MAX_AYAHS_PER_REQUEST - 1) : int(query.to);
  if (from === null || to === null || from < 1 || to < from || to > surah.ayahCount) {
    throw new CommError(CommErrorCode.QURAN_INVALID, `from/to: 1 <= from <= to <= ${surah.ayahCount}`, 422);
  }
  if (to - from + 1 > MAX_AYAHS_PER_REQUEST) {
    throw new CommError(CommErrorCode.QURAN_INVALID, `at most ${MAX_AYAHS_PER_REQUEST} ayat per request`, 422);
  }
  return { surah, from, to };
}
