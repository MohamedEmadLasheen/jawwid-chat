import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { Actor } from './types';
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
/** PD-26's bases, and (PD-52 PR-5) Sales. */
export type RecordsBasis = PageBasis | 'sales';

export interface TeacherRecordsAccess {
  basis: RecordsBasis | null;
  attendance: { view: boolean; record: boolean; decide: boolean };
  grants: { view: boolean; record: boolean };
  /** A teacher's leave allowance, used days and balance (PD-26: never for Operations). */
  leaveBalance: boolean;
  /** A grant's amount (PD-18 payroll). */
  amounts: boolean;
  /** The link to the Teacher File (the Teachers department's). */
  opensFile: boolean;
}

export const NO_TEACHER_RECORDS_ACCESS: TeacherRecordsAccess = Object.freeze({
  basis: null,
  attendance: Object.freeze({ view: false, record: false, decide: false }),
  grants: Object.freeze({ view: false, record: false }),
  leaveBalance: false,
  amounts: false,
  opensFile: false,
});

export interface TeacherRecordsInput {
  basis: RecordsBasis | null;
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
  const holdsKey = (...any: string[]) => any.some((k) => keys.has(k));
  if (basis === 'sales') {
    // Plan §5.4 / owner §11 b: Sales sees and records (trial lateness,
    // complaints, testimonials, grants without an amount) and never decides; no
    // balance, amount or Teacher File. Only the new keys count: Sales never
    // held teacher_supervision.*.
    const attendanceView = holdsKey('teacher_attendance.view');
    const grantsView = holdsKey('teacher_grants.view');
    return {
      basis,
      attendance: { view: attendanceView, record: attendanceView && holdsKey('teacher_attendance.record'), decide: false },
      grants: { view: grantsView, record: grantsView && holdsKey('teacher_grants.record') },
      leaveBalance: false,
      amounts: false,
      opensFile: false,
    };
  }
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
    opensFile: file.canView && holds('teacher_files.view'),
  };
}

/**
 * The key a write on the pages needs, by what it writes (review of #369). The
 * route admits any of the page's keys; the service then holds each write to
 * its own, the old teacher_supervision.record still counting for one release:
 *
 *   complaint, follow-up, and the Teacher File's own entries   teacher_attendance.record
 *   a complaint's resolution                                   teacher_attendance.decide
 */
export function entryKeyAllows(kind: string, keys: ReadonlySet<string>): boolean {
  if (keys.has('teacher_supervision.record')) return true;
  return kind === 'complaint_resolution' ? keys.has('teacher_attendance.decide') : keys.has('teacher_attendance.record');
}

/**
 * Parent feedback (PD-32) on the two pages: praise is page B's, a complaint
 * or suggestion page A's (plan §5.2, §5.3). Taking or replying to praise needs
 * teacher_grants.record; to anything else teacher_attendance.decide. Reading
 * needs the view key of the page the category is on.
 */
export function feedbackKeyAllows(category: string, act: 'read' | 'write', keys: ReadonlySet<string>): boolean {
  if (keys.has(act === 'read' ? 'teacher_supervision.view' : 'teacher_supervision.record')) return true;
  if (category === 'praise') return keys.has(act === 'read' ? 'teacher_grants.view' : 'teacher_grants.record');
  return keys.has(act === 'read' ? 'teacher_attendance.view' : 'teacher_attendance.decide');
}

/**
 * PD-52 PR-5: is this account Sales, as chat.sales_basis decides it? The role
 * is re-checked against the department relation, as decidePageBases does, so
 * a stale row grants nothing. The super admin is never "Sales".
 */
export function decideSalesBasis(actor: Actor, salesRole: 'manager' | 'member' | null): 'manager' | 'member' | null {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return null;
  if (salesRole === 'manager' && actor.staffRole === StaffRole.MANAGER) return 'manager';
  if (salesRole === 'member' && (actor.staffRole === StaffRole.ADMIN || actor.staffRole === StaffRole.COVERAGE)) return 'member';
  return null;
}
