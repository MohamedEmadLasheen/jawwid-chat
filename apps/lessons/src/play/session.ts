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
 *   - stages in order: listen, then repeat, then recognise, then count;
 *   - never the same mechanic twice in a row;
 *   - as many activities as the band's sitting allows (3 for 3-5), fewer
 *     when fewer mechanics qualify -- never padding with a repeat.
 */
export interface Activity {
  mechanic: string;
  from: number;
  to: number;
}

const STAGE: Readonly<Record<Skill, number>> = { listening: 0, recitation: 1, recognition: 2, structure: 3 };

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
  // The last mechanic of the previous sitting does not open this one.
  if (pool.length > 1 && pool[0]!.id === o.last) pool.push(pool.shift()!);
  const [from, to] = o.segment;
  return pool.slice(0, KNOBS[o.band].activities).map((m) => ({ mechanic: m.id, from, to }));
}
