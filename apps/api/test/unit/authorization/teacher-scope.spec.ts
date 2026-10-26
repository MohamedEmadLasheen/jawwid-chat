/**
 * PD-35: the strict teacher-supervisor scope switch and the one narrowing
 * predicate every Teachers-department surface shares. The scope itself is SQL
 * (chat.staff_teacher_scope), proven in test/integration/teacher-supervisor-pd035.spec.ts.
 */
import { ALL_TEACHERS, scopeCovers, teacherSupervisorStrictScope } from '@platform/teacher-scope';

describe('TEACHER_SUPERVISOR_STRICT_SCOPE', () => {
  const before = process.env.TEACHER_SUPERVISOR_STRICT_SCOPE;
  afterEach(() => {
    if (before === undefined) delete process.env.TEACHER_SUPERVISOR_STRICT_SCOPE;
    else process.env.TEACHER_SUPERVISOR_STRICT_SCOPE = before;
  });

  it('is off unless it says so: unset, empty and anything else are department-wide', () => {
    for (const v of [undefined, '', 'false', '0', 'no', 'off', 'strict']) {
      if (v === undefined) delete process.env.TEACHER_SUPERVISOR_STRICT_SCOPE;
      else process.env.TEACHER_SUPERVISOR_STRICT_SCOPE = v;
      expect(teacherSupervisorStrictScope()).toBe(false);
    }
  });

  it('is on for true / 1 / yes / on, any case, around spaces', () => {
    for (const v of ['true', 'TRUE', ' 1 ', 'yes', 'On']) {
      process.env.TEACHER_SUPERVISOR_STRICT_SCOPE = v;
      expect(teacherSupervisorStrictScope()).toBe(true);
    }
  });
});

describe('scopeCovers', () => {
  it('everything for a department-wide scope; only the listed teachers otherwise; never no teacher', () => {
    expect(scopeCovers(ALL_TEACHERS, 't-1')).toBe(true);
    const mine = { all: false as const, teacherIds: new Set(['t-1']) };
    expect(scopeCovers(mine, 't-1')).toBe(true);
    expect(scopeCovers(mine, 't-2')).toBe(false);
    expect(scopeCovers(mine, null)).toBe(false);
    expect(scopeCovers(mine, undefined)).toBe(false);
  });
});
