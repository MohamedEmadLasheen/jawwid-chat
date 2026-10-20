/**
 * PD-12 §3 (closed 2026-10-18): the discipline ladder, as pure functions.
 *
 *   step 1  warning
 *   step 2  first deduction
 *   step 3  second deduction
 *   step 4  temporary suspension
 *   step 5+ permanent suspension
 *
 * A violation's step is its rank among the teacher's COUNTED violations of the
 * same calendar month (the academy's): excused ones are kept but not counted,
 * and the count starts again on the first of every month. The system only
 * suggests; a person confirms, excuses, or chooses another step with a reason.
 */
export const Decision = {
  WARNING: 'warning',
  DEDUCTION_1: 'deduction_1',
  DEDUCTION_2: 'deduction_2',
  TEMPORARY_SUSPENSION: 'temporary_suspension',
  PERMANENT_SUSPENSION: 'permanent_suspension',
  EXCUSED: 'excused',
} as const;
export type Decision = (typeof Decision)[keyof typeof Decision];

export const LADDER: readonly Decision[] = [
  Decision.WARNING,
  Decision.DEDUCTION_1,
  Decision.DEDUCTION_2,
  Decision.TEMPORARY_SUSPENSION,
  Decision.PERMANENT_SUSPENSION,
];

export const DECISIONS: ReadonlySet<string> = new Set(Object.values(Decision));

/** The decision a step suggests. Anything past the fourth is permanent. */
export function decisionForStep(step: number): Decision {
  return LADDER[Math.min(Math.max(step, 1), LADDER.length) - 1];
}

export interface CountedViolation {
  id: string;
  /** The ladder is each teacher's own: violations of different teachers never rank together. */
  teacherId: string;
  occurredAt: Date;
  /** The month it counts in, YYYY-MM-01. */
  month: string;
  decision: string | null;
}

/**
 * The step each violation stands at: 1 + the counted (not excused) violations
 * of the SAME TEACHER in the same month before it, ordered by when they happened
 * (then by id, so two at the same moment are still ordered). Capped at 5.
 */
export function stepsOf(violations: readonly CountedViolation[]): Map<string, number> {
  const out = new Map<string, number>();
  const byTeacherMonth = new Map<string, CountedViolation[]>();
  for (const v of violations) {
    const key = `${v.teacherId}|${v.month}`;
    byTeacherMonth.set(key, [...(byTeacherMonth.get(key) ?? []), v]);
  }
  for (const list of byTeacherMonth.values()) {
    const ordered = [...list].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
    let counted = 0;
    for (const v of ordered) {
      out.set(v.id, Math.min(counted + 1, LADDER.length));
      if (v.decision !== Decision.EXCUSED) counted += 1;
    }
  }
  return out;
}

/** Choosing anything but the suggested step (or excusing) needs a reason. */
export function needsReason(decision: Decision, suggestedStep: number): boolean {
  return decision === Decision.EXCUSED || decision !== decisionForStep(suggestedStep);
}

export function isSuspension(decision: string): boolean {
  return decision === Decision.TEMPORARY_SUSPENSION || decision === Decision.PERMANENT_SUSPENSION;
}
