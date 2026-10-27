/**
 * PD-26 amendment, Operations access (owner 2026-10-27), the parts that need no
 * database: who works the Teacher Supervision page and on what basis, and what
 * an Operations supervisor may do there. The routes and the database backstop
 * are in test/integration/pd026-operations-access.spec.ts (CI's G-19).
 */
import type { Actor } from '@platform/types';
import { ALL_TEACHERS, decidePageBases, decidePageBasis, pageRowVisible, type PageScope } from '@platform/teacher-scope';
import { decidePd012PageAccess } from '@platform/pd012-policy';
import { OPERATIONS_ENTRY_KINDS, teacherFilePageAccess } from '@platform/teacher-file-policy';

const ORG = '11111111-1111-1111-1111-111111111111';
function staff(role: string, over: Partial<Actor> = {}): Actor {
  return { actorId: 's', kind: 'staff', displayName: 's', locale: 'ar', isActive: true, staffRole: role as never, organizationId: ORG, ...over };
}

describe('who works the Teacher Supervision page', () => {
  it.each`
    role             | teachers     | operations   | basis
    ${'super_admin'} | ${null}      | ${null}      | ${'super_admin'}
    ${'manager'}     | ${'manager'} | ${null}      | ${'teachers'}
    ${'admin'}       | ${'member'}  | ${null}      | ${'teachers'}
    ${'coverage'}    | ${'member'}  | ${null}      | ${'teachers'}
    ${'manager'}     | ${null}      | ${'manager'} | ${'operations'}
    ${'admin'}       | ${null}      | ${'member'}  | ${'operations'}
    ${'coverage'}    | ${null}      | ${'member'}  | ${'operations'}
    ${'admin'}       | ${'member'}  | ${'member'}  | ${'teachers'}
    ${'admin'}       | ${null}      | ${'manager'} | ${null}
    ${'manager'}     | ${null}      | ${'member'}  | ${null}
    ${'admin'}       | ${null}      | ${null}      | ${null}
    ${'sales'}       | ${null}      | ${'member'}  | ${null}
  `('$role (teachers: $teachers, operations: $operations) -> $basis', ({ role, teachers, operations, basis }) => {
    expect(decidePageBasis(staff(role), teachers, operations)).toBe(basis);
  });

  it('never for a teacher, a parent, or an inactive staff member', () => {
    expect(decidePageBasis({ ...staff('admin'), kind: 'teacher' }, null, 'member')).toBeNull();
    expect(decidePageBasis({ ...staff('admin'), kind: 'contact' }, null, 'member')).toBeNull();
    expect(decidePageBasis(staff('admin', { isActive: false }), null, 'member')).toBeNull();
  });
});

describe('someone in both departments (review of #175, NIT-5)', () => {
  it('holds both bases: the Teachers department\'s rights, and the Operations teachers as well', () => {
    expect(decidePageBases(staff('admin'), 'member', 'member')).toEqual({ superAdmin: false, teachers: true, operations: true });
    expect(decidePageBasis(staff('admin'), 'member', 'member')).toBe('teachers');
    // A stale row on either side grants nothing on that side only.
    expect(decidePageBases(staff('admin'), 'manager', 'member')).toEqual({ superAdmin: false, teachers: false, operations: true });
    expect(decidePageBases(staff('super_admin'), null, 'member')).toEqual({ superAdmin: true, teachers: true, operations: false });
  });
});

describe('rows about one child (review of #175, P2-4)', () => {
  const ids = (...x: string[]) => ({ all: false as const, teacherIds: new Set(x) });
  // t-whole: reached through the Teachers department; t-ops: through Operations only.
  const page: PageScope = {
    teachers: ids('t-whole', 't-ops'),
    whole: ids('t-whole'),
    learnerIds: new Set(['mine']),
    familyIds: new Set(['fam-mine']),
  };

  it('a teacher outside the page shows nothing', () => {
    expect(pageRowVisible(page, 't-other', null)).toBe(false);
    expect(pageRowVisible(page, null, null)).toBe(false);
  });

  it('a whole teacher shows every row', () => {
    expect(pageRowVisible(page, 't-whole', { learnerId: 'theirs' })).toBe(true);
    expect(pageRowVisible(page, 't-whole', { learnerId: null })).toBe(true);
    expect(pageRowVisible(page, 't-whole', { familyId: 'fam-theirs' })).toBe(true);
  });

  it('an Operations-only teacher: teacher-level rows, and the caller\'s own children only', () => {
    expect(pageRowVisible(page, 't-ops', null)).toBe(true);
    expect(pageRowVisible(page, 't-ops', { learnerId: 'mine' })).toBe(true);
    expect(pageRowVisible(page, 't-ops', { learnerId: 'theirs' })).toBe(false);
    expect(pageRowVisible(page, 't-ops', { familyId: 'fam-mine' })).toBe(true);
    expect(pageRowVisible(page, 't-ops', { familyId: 'fam-theirs' })).toBe(false);
    // A trial's lesson is about a prospect, nobody's family yet.
    expect(pageRowVisible(page, 't-ops', { learnerId: null })).toBe(false);
  });

  it('department-wide (strict scope off) shows every row of every teacher', () => {
    const wide: PageScope = { teachers: ALL_TEACHERS, whole: ALL_TEACHERS, learnerIds: new Set(), familyIds: new Set() };
    expect(pageRowVisible(wide, 'anyone', { learnerId: 'theirs' })).toBe(true);
  });
});

describe('what an Operations supervisor may do there', () => {
  it('PD-12: supervises (leave, discipline) but never sets a leave allowance', () => {
    const none = { canSupervise: false, canSetAllowance: false };
    expect(decidePd012PageAccess(none, 'operations')).toEqual({ canSupervise: true, canSetAllowance: false });
    expect(decidePd012PageAccess(none, null)).toEqual(none);
    // The Teachers side is exactly what it was.
    const member = { canSupervise: true, canSetAllowance: false };
    const manager = { canSupervise: true, canSetAllowance: true };
    expect(decidePd012PageAccess(member, 'teachers')).toEqual(member);
    expect(decidePd012PageAccess(manager, 'teachers')).toEqual(manager);
  });

  it('Teacher File: writes on the page, never opens a file, never edits one, never sees money', () => {
    const refused = { canView: false, canEditPersonal: false, canWriteSupervision: false, canViewFinance: false };
    expect(teacherFilePageAccess(refused, 'operations')).toEqual({
      canView: false,
      canEditPersonal: false,
      canWriteSupervision: true,
      canViewFinance: false,
      onPage: true,
    });
    expect(teacherFilePageAccess(refused, null)).toEqual({ ...refused, onPage: false });
    // The Teachers department (and the super admin's finance) is unchanged.
    const teachers = { canView: true, canEditPersonal: false, canWriteSupervision: true, canViewFinance: false };
    expect(teacherFilePageAccess(teachers, 'teachers')).toEqual({ ...teachers, onPage: true });
    const root = { canView: true, canEditPersonal: true, canWriteSupervision: true, canViewFinance: true };
    expect(teacherFilePageAccess(root, 'super_admin')).toEqual({ ...root, onPage: true });
  });

  it('on a teacher\'s timeline: the page\'s complaints only, not the Teacher File\'s monthly comments or days off', () => {
    expect([...OPERATIONS_ENTRY_KINDS].sort()).toEqual(['complaint', 'complaint_followup', 'complaint_resolution']);
  });
});
