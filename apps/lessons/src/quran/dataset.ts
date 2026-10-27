import pin from '../../quran-pin.json';
import { digestOf, sha256Hex } from './sha256';

/**
 * The Quran text, read only from the snapshot that CI builds out of the one
 * verified dataset (scripts/lessons/build-quran-snapshot.py, which runs the
 * loader's verification first). The engine checks it again before showing a
 * letter -- and FAILS CLOSED: a snapshot that is not the pinned dataset, a
 * surah with a missing or extra ayah, or an ayah whose text does not hash to
 * its recorded value is refused, and nothing of it is rendered.
 * Contract: docs/product/quran-dataset-contract.md.
 */
export interface SurahInfo {
  number: number;
  nameAr: string;
  nameEn: string;
  ayahCount: number;
  rangeSha256: string;
}

export interface Manifest {
  datasetId: string;
  fileSha256: string;
  attribution: string;
  sourceUrl: string;
  surahs: SurahInfo[];
}

export interface Ayah {
  ayah: number;
  /** The Basmala prefix of ayah 1 (112 surahs), shown before it; never part of the verse. */
  basmala: string | null;
  /** The verse, verbatim. */
  text: string;
  /** SHA-256 of `text`. */
  sha256: string;
}

export interface Surah {
  info: SurahInfo;
  ayahs: Ayah[];
  attribution: string;
  sourceUrl: string;
}

export class QuranRefused extends Error {}

export type Fetcher = (path: string) => Promise<unknown>;

export const SNAPSHOT_BASE = '/data/quran';

export const fetchJson: Fetcher = async (path) => {
  const res = await fetch(path, { credentials: 'omit', cache: 'no-cache' });
  if (!res.ok) throw new QuranRefused(`${path}: ${res.status}`);
  return res.json();
};

function isManifest(x: unknown): x is Manifest {
  const m = x as Manifest;
  return !!m && typeof m.datasetId === 'string' && typeof m.fileSha256 === 'string' && Array.isArray(m.surahs);
}

export async function loadManifest(fetcher: Fetcher = fetchJson): Promise<Manifest> {
  const m = await fetcher(`${SNAPSHOT_BASE}/manifest.json`);
  if (!isManifest(m)) throw new QuranRefused('the snapshot manifest is malformed');
  if (m.datasetId !== pin.datasetId || m.fileSha256 !== pin.fileSha256) {
    throw new QuranRefused(`the snapshot is ${m.datasetId} (${m.fileSha256}), not the pinned ${pin.datasetId}`);
  }
  if (m.surahs.length !== 114 || m.surahs.some((s, i) => s.number !== i + 1)) throw new QuranRefused('the manifest does not list surahs 1..114');
  return m;
}

/** One surah, verified: numbered 1..n, every text hashing to its sha256, the range digest the manifest's. */
export async function loadSurah(number: number, fetcher: Fetcher = fetchJson): Promise<Surah> {
  const manifest = await loadManifest(fetcher);
  const info = manifest.surahs[number - 1];
  if (!info) throw new QuranRefused(`no surah ${number}`);
  const body = (await fetcher(`${SNAPSHOT_BASE}/surah-${String(number).padStart(3, '0')}.json`)) as {
    datasetId?: unknown;
    surah?: unknown;
    ayahs?: unknown;
  };
  if (body?.datasetId !== manifest.datasetId || body.surah !== number || !Array.isArray(body.ayahs)) {
    throw new QuranRefused(`surah ${number}: the file is not this dataset's`);
  }
  const ayahs = body.ayahs as Ayah[];
  if (ayahs.length !== info.ayahCount) throw new QuranRefused(`surah ${number}: ${ayahs.length} ayat, expected ${info.ayahCount}`);
  for (let i = 0; i < ayahs.length; i++) {
    const a = ayahs[i]!;
    if (a.ayah !== i + 1 || typeof a.text !== 'string' || !a.text) throw new QuranRefused(`surah ${number}: ayah ${i + 1} is missing`);
    if (a.basmala !== null && !(a.ayah === 1 && number !== 1 && number !== 9)) throw new QuranRefused(`${number}:${a.ayah} carries a Basmala`);
    if ((await sha256Hex(a.text)) !== a.sha256) throw new QuranRefused(`${number}:${a.ayah} does not match its hash`);
  }
  if ((await digestOf(ayahs.map((a) => a.sha256))) !== info.rangeSha256) throw new QuranRefused(`surah ${number}: the range digest differs`);
  return { info, ayahs, attribution: manifest.attribution, sourceUrl: manifest.sourceUrl };
}
