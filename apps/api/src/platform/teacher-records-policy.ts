import { decidePd012PageAccess, type Pd012Access } from './pd012-policy';
import { teacherFilePageAccess, type TeacherFileAccess } from './teacher-file-policy';
import type { PageBasis } from './teacher-scope';

/**
 * PD-52 (docs/product/pd052-teacher-records-pages-plan.md §5, §6): which of
 * the two teacher-records pages the Admin Web offers, and which actions.
 *
 *   page A  Attendance & Complaints   leave, lateness, excuses and absences, complaints
 *   page B  Grants & Testimonials     grants (PD-11 bonuses), testimonials
 *
 * Two layers, both required, exactly as on every PD-40 route:
 *   1. the BASIS -- the service rule. The super admin, the Teachers department
 *      (PD-35 scope) and Operations (the teachers of their families) work the
 *      PD-26 page today; the pages inherit it unchanged (decidePd012PageAccess,
 *      teacherFilePageAccess).
 *   2. the KEY -- the PD-40 permission. For one release the old
 *      teacher_supervision.* keys count too (plan §6, "@Requires.any").
 *
 * Advisory: every route decides again. DB-free, so the matrix is unit-testable.
 */
export interface TeacherRecordsAccess {
  basis: PageBasis | null;
  attendance: { view: boolean; record: boolean; decide: boolean };
  grants: { view: boolean; record: boolean };
  /** A teacher's leave allowance, used days and balance (PD-26: never for Operations). */
  leaveBalance: boolean;
  /** A grant's amount (PD-18 payroll). */
  amounts: boolean;
  /** The link to the Teacher File (the Teachers department's). */
  teacherFile: boolean;
}

export const NO_TEACHER_RECORDS_ACCESS: TeacherRecordsAccess = Object.freeze({
  basis: null,
  attendance: Object.freeze({ view: false, record: false, decide: false }),
  grants: Object.freeze({ view: false, record: false }),
  leaveBalance: false,
  amounts: false,
  teacherFile: false,
});

export interface TeacherRecordsInput {
  basis: PageBasis | null;
  /** decidePd012StaffAccess for the caller (before the basis widens it). */
  pd012: Pd012Access;
  /** decideTeacherFileAccess for the caller (before the basis narrows it). */
  file: TeacherFileAccess;
  /** The caller's PD-40 keys (chat.staff_access_profile). */
  keys: ReadonlySet<string>;
}

export function decideTeacherRecordsAccess(input: TeacherRecordsInput): TeacherRecordsAccess {
  const { basis, keys } = input;
  if (basis === null) return NO_TEACHER_RECORDS_ACCESS;
  const pd012 = decidePd012PageAccess(input.pd012, basis);
  const file = teacherFilePageAccess(input.file, basis);
  const holds = (...any: string[]) => any.some((k) => keys.has(k));
  const onPage = pd012.canSupervise;
  const writes = onPage && file.canWriteSupervision;
  const attendanceView = onPage && holds('teacher_supervision.view', 'teacher_attendance.view');
  const grantsView = onPage && holds('teacher_supervision.view', 'teacher_grants.view');
  return {
    basis,
    attendance: {
      view: attendanceView,
      record: attendanceView && writes && holds('teacher_supervision.record', 'teacher_attendance.record'),
      decide: attendanceView && writes && holds('teacher_supervision.record', 'teacher_attendance.decide'),
    },
    grants: {
      view: grantsView,
      record: grantsView && writes && holds('teacher_supervision.record', 'teacher_grants.record'),
    },
    leaveBalance: attendanceView && basis !== 'operations',
    amounts: grantsView && file.canViewFinance && holds('teacher_files.finance'),
    teacherFile: file.canView && holds('teacher_files.view'),
  };
}
