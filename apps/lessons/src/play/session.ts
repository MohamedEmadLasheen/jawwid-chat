import type { Band } from '../content/quran-content';
import { rng } from '../games/shuffle';
import { KNOBS, tierOf } from './adapt';
import type { Mechanic, Skill } from './mechanics';

/**
 * One sitting for one child on one segment of a surah (plan §C.3): a short
 * playlist built from the mechanics that are signed, fit the band and the
 * surah's length tier, and can run (an audio mechanic needs recitation).
 * Deterministic from the seed, so it can be tested and reproduced.
 *
 *   - stages in order: listen, repeat, recognise, count, then order, then recall;
 *   - never the same mechanic twice in a row;
 *   - as many activities as the band's sitting allows (3 for 3-5), fewer
 *     when fewer mechanics qualify -- never padding with a repeat.
 */
export interface Activity {
  mechanic: string;
  from: number;
  to: number;
}

/** A 32-bit seed from its parts (FNV-1a over their joined text): the same parts, the same seed. */
export function seedOf(parts: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The sitting's seed (plan §C.3): from (surah, segment, band, levels, date), so a
 * child gets a new order each day, and a day's sitting can be reproduced.
 * `levels` is the teacher's per-skill setting; it is not built yet, so ''.
 */
export function sessionSeed(o: { surah: number; segment: number; band: Band; levels?: string; date: string }): number {
  return seedOf([o.surah, o.segment, o.band, o.levels ?? '', o.date]);
}

/** Today's date, local, as YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const STAGE: Readonly<Record<Skill, number>> = { listening: 0, recitation: 1, recognition: 2, structure: 3, order: 4, recall: 5 };

export function eligible(mechanics: readonly Mechanic[], o: { band: Band; ayahCount: number; audio: boolean; approved: ReadonlySet<string> }): Mechanic[] {
  const tier = tierOf(o.ayahCount);
  return mechanics.filter((m) => o.approved.has(m.id) && m.bands.includes(o.band) && m.tiers.includes(tier) && (o.audio || !m.needsAudio));
}

export function buildSession(
  mechanics: readonly Mechanic[],
  o: { band: Band; ayahCount: number; segment: [number, number]; audio: boolean; approved: ReadonlySet<string>; seed: number; last?: string },
): Activity[] {
  const next = rng(o.seed);
  // Within a stage, the order rotates with the seed; stages keep their order.
  const pool = eligible(mechanics, o)
    .map((m) => ({ m, k: STAGE[m.skill] * 10 + next() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.m);
  // The last mechanic of the previous segment's sitting does not open this one.
  if (pool.length > 1 && pool[0]!.id === o.last) pool.push(pool.shift()!);
  const [from, to] = o.segment;
  return pool.slice(0, KNOBS[o.band].activities).map((m) => ({ mechanic: m.id, from, to }));
}
