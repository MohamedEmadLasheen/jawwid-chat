/**
 * Stars (#15): one per section of a lesson, earned once. Revisiting a section,
 * re-rendering or repeating an answer never adds another (the old lessons let
 * stars be farmed). Kept in memory for now; per-child storage comes with the
 * completion events (plan P1-1/P1-3).
 */
export type SectionId = 'listen' | 'verses' | 'meanings' | 'complete' | 'order' | 'quiz' | 'benefits';

/** Every lesson: the Quran sections, built from the verified text alone. */
export const QURAN_SECTIONS: readonly SectionId[] = ['listen', 'verses', 'order'];

/** A lesson with reviewed content (src/content/) adds the rest, in this order. */
export const CONTENT_SECTIONS: readonly SectionId[] = ['listen', 'verses', 'meanings', 'complete', 'order', 'quiz', 'benefits'];

/** One lesson's stars; S is its section ids (the Quran lessons' by default, the letters lesson's its own). */
export class StarLedger<S extends string = SectionId> {
  private readonly earned = new Set<S>();

  constructor(private readonly sections: readonly S[] = QURAN_SECTIONS as readonly string[] as readonly S[]) {}

  /** True only the first time a section of this lesson is completed. */
  award(section: S): boolean {
    if (!this.sections.includes(section) || this.earned.has(section)) return false;
    this.earned.add(section);
    return true;
  }

  has(section: S): boolean {
    return this.earned.has(section);
  }

  get total(): number {
    return this.earned.size;
  }

  get max(): number {
    return this.sections.length;
  }
}
