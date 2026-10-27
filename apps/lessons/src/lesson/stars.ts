/**
 * Stars (#15): one per section of a lesson, earned once. Revisiting a section,
 * re-rendering or repeating an answer never adds another (the old lessons let
 * stars be farmed). Kept in memory for now; per-child storage comes with the
 * completion events (plan P1-1/P1-3).
 */
export type SectionId = 'listen' | 'verses' | 'order';

export const SECTIONS: readonly SectionId[] = ['listen', 'verses', 'order'];

export class StarLedger {
  private readonly earned = new Set<SectionId>();

  /** True only the first time a section is completed. */
  award(section: SectionId): boolean {
    if (this.earned.has(section)) return false;
    this.earned.add(section);
    return true;
  }

  has(section: SectionId): boolean {
    return this.earned.has(section);
  }

  get total(): number {
    return this.earned.size;
  }

  get max(): number {
    return SECTIONS.length;
  }
}
