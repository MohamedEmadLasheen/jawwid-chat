/**
 * PD-12 S2, the pure ladder: which step a violation stands at, and when a
 * person must give a reason.
 */
import { decisionForStep, needsReason, stepsOf } from '../../../src/discipline/ladder';

const v = (id: string, day: string, decision: string | null = null, month = day.slice(0, 8) + '01', teacherId = 't1') => ({
  id,
  teacherId,
  occurredAt: new Date(`${day}T10:00:00Z`),
  month,
  decision,
});

describe('the discipline ladder', () => {
  it('maps steps to decisions; five and beyond is permanent', () => {
    expect([1, 2, 3, 4, 5, 6, 0].map(decisionForStep)).toEqual([
      'warning', 'deduction_1', 'deduction_2', 'temporary_suspension', 'permanent_suspension', 'permanent_suspension', 'warning',
    ]);
  });

  it('ranks by time inside a month, and starts again each month', () => {
    const steps = stepsOf([v('c', '2026-10-20'), v('a', '2026-10-02'), v('b', '2026-10-09'), v('d', '2026-11-01')]);
    expect(Object.fromEntries(steps)).toEqual({ a: 1, b: 2, c: 3, d: 1 });
  });

  it('each teacher has their own ladder: another teacher\'s violations never move a step', () => {
    // Found on the QA stack 2026-10-19: one apology for a second teacher showed as
    // "step 4, temporary suspension" because the list ranked the month across teachers.
    const steps = stepsOf([
      v('a1', '2026-10-02', null, undefined, 'omar'),
      v('a2', '2026-10-05', null, undefined, 'omar'),
      v('a3', '2026-10-09', null, undefined, 'omar'),
      v('b1', '2026-10-20', null, undefined, 'youssef'),
      v('b2', '2026-10-21', null, undefined, 'youssef'),
    ]);
    expect(Object.fromEntries(steps)).toEqual({ a1: 1, a2: 2, a3: 3, b1: 1, b2: 2 });
  });

  it('an excused violation keeps its own step but does not move the ones after it', () => {
    const steps = stepsOf([v('a', '2026-10-02', 'excused'), v('b', '2026-10-09', 'warning'), v('c', '2026-10-20')]);
    expect(Object.fromEntries(steps)).toEqual({ a: 1, b: 1, c: 2 });
  });

  it('two at the same moment are still ordered, and the step caps at five', () => {
    const same = ['f', 'e', 'd', 'c', 'b', 'a'].map((id) => v(id, '2026-10-02'));
    expect(Object.fromEntries(stepsOf(same))).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 5 });
  });

  it('only the suggested step goes without a reason; excusing always needs one', () => {
    expect(needsReason('warning', 1)).toBe(false);
    expect(needsReason('deduction_1', 1)).toBe(true);
    expect(needsReason('permanent_suspension', 7)).toBe(false);
    expect(needsReason('excused', 1)).toBe(true);
  });
});
