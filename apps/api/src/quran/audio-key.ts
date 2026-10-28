import { surahOf } from '../materials/quran-surahs';

/**
 * The one mapping from an ayah to its audio (docs/product/quran-dataset-contract.md,
 * "Audio"). One file per ayah, so text and audio cannot drift apart: the key is
 * derived from (reciter, surah, ayah) and nothing else. chat.quran_ayah_audio
 * computes the same key as a GENERATED column, so a stored key can never name
 * another ayah; the service checks the two agree before serving one.
 *
 *   quran/audio/<reciter>/<SSS><AAA>.mp3      e.g. quran/audio/alafasy-128/085003.mp3
 */
const RECITER = /^[a-z0-9][a-z0-9-]{1,39}$/;
const KEY = /^quran\/audio\/([a-z0-9][a-z0-9-]{1,39})\/(\d{3})(\d{3})\.mp3$/;

export function isReciterCode(code: string): boolean {
  return RECITER.test(code);
}

export function audioKey(reciter: string, surah: number, ayah: number): string {
  if (!RECITER.test(reciter)) throw new Error(`not a reciter code: ${JSON.stringify(reciter)}`);
  const s = surahOf(surah);
  if (!s || !Number.isInteger(ayah) || ayah < 1 || ayah > s.ayahCount) throw new Error(`no ayah ${surah}:${ayah}`);
  return `quran/audio/${reciter}/${String(surah).padStart(3, '0')}${String(ayah).padStart(3, '0')}.mp3`;
}

/** The ayah a key names, or null for anything that is not exactly one real ayah's key. */
export function parseAudioKey(key: string): { reciter: string; surah: number; ayah: number } | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const surah = Number(m[2]);
  const ayah = Number(m[3]);
  const s = surahOf(surah);
  if (!s || ayah < 1 || ayah > s.ayahCount) return null;
  return { reciter: m[1]!, surah, ayah };
}
