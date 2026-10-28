/**
 * The rasm skeleton: the ONE fold for telling whether a string carries Quran
 * text. A port of scripts/lessons/rasm.py (shared by PD-29's and PD-49's
 * typed-Quran checks and PD-48's refusal to voice Quran); rasm.vectors.json,
 * generated from the Python, holds the two equal.
 *
 * Tanzil's Uthmani text and standard spelling differ mostly in alef and hamza
 * forms, the Uthmani waw standing for an alef, and small marks, so both sides
 * fold to the letter skeleton: no marks, no alef or hamza of any form, alef
 * maqsura as ya, ta marbuta as ha. It is NOT the verbatim fold positions use.
 */
const MARKS = new Set<number>([...Array.from({ length: 0x660 - 0x64b }, (_, i) => 0x64b + i), 0x670, 0x640, ...Array.from({ length: 0x6ee - 0x6d6 }, (_, i) => 0x6d6 + i)]);
const ALEFS = new Set<number>([0x627, 0x623, 0x625, 0x622, 0x671, 0x621, 0x624, 0x626]);
const UNIFY = new Map<number, number>([
  [0x649, 0x64a],
  [0x629, 0x647],
]);
const WAW_DAGGER = String.fromCodePoint(0x648, 0x670);

export function rasm(text: string): string {
  const t = text.normalize('NFC').split(WAW_DAGGER).join('');
  let out = '';
  for (const ch of t) {
    let o = ch.codePointAt(0)!;
    if (MARKS.has(o) || ALEFS.has(o)) continue;
    o = UNIFY.get(o) ?? o;
    out += o >= 0x621 && o <= 0x64a ? String.fromCodePoint(o) : ' ';
  }
  return out.split(/\s+/).filter(Boolean).join(' ');
}
