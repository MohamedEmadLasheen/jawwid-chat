import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SURAHS } from '../../../src/materials/quran-surahs';
import { digestOf, sha256Hex, splitBasmala, type AyahRow, type PinnedDataset } from '../../../src/quran/quran-integrity';

/** The vendored, pinned Tanzil file. Arabic in tests comes from here, never typed. */
export const TANZIL_FILE = join(__dirname, '../../../../../data/quran/tanzil-uthmani-1.1.txt');

/** Every ayah of the real file, as the loader parses it (verbatim text). */
export function realLines(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(TANZIL_FILE, 'utf8').split('\n')) {
    const l = line.replace(/\r$/, '');
    if (!l || l.startsWith('#')) continue;
    const [s, a, ...rest] = l.split('|');
    out.set(`${s}:${a}`, rest.join('|'));
  }
  return out;
}

const lines = realLines();
/** 1:1 -- the plain Basmala, prefixed to 110 surahs' first ayah. */
export const BASMALA = lines.get('1:1')!;
/** The bi-shadda spelling prefixed to 95:1 and 97:1 (its first four words). */
export const BASMALA_SHADDA = lines.get('95:1')!.split(' ').slice(0, 4).join(' ');

/** A row as the database stores it: verbatim text, its hash, and its Basmala split. */
export function rowOf(surah: number, ayah: number, text: string): AyahRow {
  const split = splitBasmala(surah, ayah, text);
  return { surah, ayah, text, sha256: sha256Hex(text), basmala: split.basmala, verse: split.verse };
}

/**
 * A stand-in for the real text with the real ayah counts: one distinct line per
 * ayah, and the real Basmala prefixes on ayah 1 (none on 1:1 or 9:1).
 */
export function syntheticRows(): AyahRow[] {
  const rows: AyahRow[] = [];
  for (const s of SURAHS) {
    for (let a = 1; a <= s.ayahCount; a++) {
      let text = `نص ${s.number}:${a}`;
      if (a === 1 && s.number !== 1 && s.number !== 9) text = `${s.number === 95 || s.number === 97 ? BASMALA_SHADDA : BASMALA} ${text}`;
      rows.push(rowOf(s.number, a, text));
    }
  }
  return rows;
}

/** The real file's rows. */
export function realRows(): AyahRow[] {
  return [...lines].map(([key, text]) => {
    const [s, a] = key.split(':').map(Number);
    return rowOf(s!, a!, text);
  });
}

export function pinnedFor(rows: readonly AyahRow[], id = 'synthetic-1'): PinnedDataset {
  const ordered = [...rows].sort((x, y) => x.surah - y.surah || x.ayah - y.ayah);
  return {
    id,
    fileSha256: 'f'.repeat(64),
    ayahsDigest: digestOf(ordered.map((r) => r.sha256)),
    attribution: 'test',
    sourceUrl: 'https://example.test/quran',
  };
}
