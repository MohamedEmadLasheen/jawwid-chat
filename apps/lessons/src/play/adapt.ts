import type { Band } from '../content/quran-content';

/**
 * PD-49 adaptation (docs/product/pd049-children-quran-experience-plan.md §B):
 * the age band shapes the mechanics, the surah's length tier shapes the
 * chunking. Pure.
 */
export type Tier = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export const TIERS: readonly Tier[] = ['L1', 'L2', 'L3', 'L4', 'L5'];

/** L1 1-8 ayat, L2 9-20, L3 21-50, L4 51-120, L5 more (plan §B.1). */
export function tierOf(ayahCount: number): Tier {
  if (ayahCount <= 8) return 'L1';
  if (ayahCount <= 20) return 'L2';
  if (ayahCount <= 50) return 'L3';
  if (ayahCount <= 120) return 'L4';
  return 'L5';
}

/** What changes inside a game with the band (plan §B.3). */
export interface Knobs {
  /** Choices in a question. */
  options: number;
  /** Rounds in a game. */
  rounds: number;
  /** Repetitions in an echo. */
  echoes: number;
  /** Wrong taps before the answer is shown (and praised): a 3-5 child never "fails". */
  triesBeforeShown: number;
  /** Activities in one sitting. */
  activities: number;
  /** Never for 3-8; an opt-in challenge only for 9-12 (not built yet). */
  timers: boolean;
  /**
   * Where a wrong choice comes from (plan §B.3): far from the answer (3-5), the same surah but
   * not next to it (6-8), or its neighbours (9-12). Always a real, whole unit of the verified text.
   */
  distractors: 'far' | 'apart' | 'near';
  /** A list of what was missed, to review at the end of a game (9-12: "score kept, a review list"). */
  reviewList: boolean;
}

export const KNOBS: Readonly<Record<Band, Knobs>> = {
  '3-5': { options: 2, rounds: 3, echoes: 3, triesBeforeShown: 2, activities: 3, timers: false, distractors: 'far', reviewList: false },
  '6-8': { options: 3, rounds: 5, echoes: 5, triesBeforeShown: 1, activities: 5, timers: false, distractors: 'apart', reviewList: false },
  '9-12': { options: 4, rounds: 8, echoes: 5, triesBeforeShown: 1, activities: 6, timers: false, distractors: 'near', reviewList: true },
};

/** Ayat played at a time: a 3-5 child gets 1-3, longer surahs smaller pieces (plan §B.2). */
export function segmentSize(band: Band, tier: Tier): number {
  if (band === '3-5') return tier === 'L1' ? 3 : 2;
  if (band === '6-8') return tier === 'L1' || tier === 'L2' ? 8 : 4;
  return tier === 'L1' || tier === 'L2' ? 20 : 8;
}

/** The surah cut into [from, to] segments for this band. */
export function segmentsFor(band: Band, ayahCount: number): [number, number][] {
  const size = segmentSize(band, tierOf(ayahCount));
  const out: [number, number][] = [];
  for (let from = 1; from <= ayahCount; from += size) out.push([from, Math.min(ayahCount, from + size - 1)]);
  return out;
}
