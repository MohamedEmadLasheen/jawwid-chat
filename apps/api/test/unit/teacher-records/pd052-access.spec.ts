/**
 * PD-52 PR-1: the teacher-records keys and the access answer.
 *
 *   - every route the Teacher Supervision page uses accepts the new key of its
 *     page beside the old one, so a role holding only the new keys reaches
 *     exactly what the old keys reached (plan §6, "@Requires.any");
 *   - the new keys open nothing else;
 *   - GET /teacher-records/access answers per basis AND key.
 *
 * Pure: no database, no Nest application.
 */
import { StaffRole } from '@communication/contracts/vocab';
import { decidePd012StaffAccess, type TeachersDepartmentRole } from '@platform/pd012-policy';
import { decideTeacherFileAccess } from '@platform/teacher-file-policy';
import { decideTeacherRecordsAccess, NO_TEACHER_RECORDS_ACCESS } from '@platform/teacher-records-policy';
import type { PageBasis } from '@platform/teacher-scope';
import { legacyBundle, legacyTierOf } from '@platform/permissions/legacy-bundles';
import type { Actor } from '@platform/types';
import { collectRoutes } from '../../support/route-inventory';
import { admin } from '../../support/fixtures';

const routes = collectRoutes();
const opened = (key: string) =>
  routes
    .filter((r) => r.access?.kind === 'requires' && r.access.anyOf.includes(key as never))
    .map((r) => `${r.method} ${r.path}`)
    .sort();

const ATTENDANCE_READS = [
  'GET /discipline/violations',
  'GET /teacher-files/:teacherId/leave',
  'GET /teacher-files/complaints',
  'GET /teacher-leave-overview',
  'GET /teacher-leave-requests',
  'GET /teachers/:id/discipline',
];
const SHARED_READS = ['GET /parent-feedback', 'GET /teacher-supervision/directory', 'GET /teacher-supervision/teachers/:teacherId/held-lessons'];

describe('PD-52: the new keys open what the old keys opened, page by page', () => {
  it('teacher_attendance.view opens page A\'s reads', () => {
    expect(opened('teacher_attendance.view')).toEqual([...ATTENDANCE_READS, ...SHARED_READS, 'GET /teacher-records/teachers/:id/summary'].sort());
  });

  it('teacher_grants.view opens page B\'s reads', () => {
    expect(opened('teacher_grants.view')).toEqual(
      ['GET /teacher-files/rewards', 'GET /teacher-records/testimonials', 'GET /teacher-records/teachers/:id/summary', ...SHARED_READS].sort(),
    );
  });

  it('teacher_attendance.record opens lateness, absences and complaint entries', () => {
    expect(opened('teacher_attendance.record')).toEqual([
      'GET /teacher-records/teachers/:id/students',
      'POST /lessons/:id/lateness',
      'POST /teacher-files/:teacherId/entries',
      'POST /teachers/:id/absences',
    ]);
  });

  it('teacher_attendance.decide opens the decisions: leave, the ladder, upholding, resolving, the parent\'s reply', () => {
    expect(opened('teacher_attendance.decide')).toEqual([
      'POST /discipline/complaints/:id/uphold',
      'POST /discipline/violations/:id/decide',
      'POST /parent-feedback/:id/reply',
      'POST /parent-feedback/:id/take',
      'POST /teacher-files/:teacherId/entries',
      'POST /teacher-leave-requests/:id/approve',
      'POST /teacher-leave-requests/:id/cancel',
      'POST /teacher-leave-requests/:id/decline',
      'POST /teacher-records/entries/:id/void',
    ]);
  });

  it('teacher_grants.record opens the grant without an amount and the reply to praise', () => {
    expect(opened('teacher_grants.record')).toEqual([
      'GET /teacher-records/teachers/:id/students',
      'POST /parent-feedback/:id/reply',
      'POST /parent-feedback/:id/take',
      'POST /teacher-records/entries/:id/void',
      'POST /teachers/:id/bonus',
      'POST /teachers/:id/testimonials',
    ]);
  });

  it('every route an old key opens accepts a new key too (so the old keys can go in PR-9)', () => {
    const NEW = ['teacher_attendance.view', 'teacher_attendance.record', 'teacher_attendance.decide', 'teacher_grants.view', 'teacher_grants.record'];
    const left = (old: string) =>
      routes
        .filter((r) => r.access?.kind === 'requires' && r.access.anyOf.includes(old as never))
        .filter((r) => r.access?.kind === 'requires' && !r.access.anyOf.some((k) => NEW.includes(k)))
        .map((r) => `${r.method} ${r.path}`);
    // GET /dashboard/teachers is the PD-44 dashboard's, migrated with its session in PR-9.
    expect(left('teacher_supervision.view')).toEqual(['GET /dashboard/teachers']);
    expect(left('teacher_supervision.record')).toEqual([]);
  });

  it('GET /teacher-records/access is an advisory probe any signed-in caller may ask', () => {
    const r = routes.find((x) => x.method === 'GET' && x.path === '/teacher-records/access');
    expect(r?.access).toEqual({ kind: 'self' });
  });
});

describe('PD-52: GET /teacher-records/access', () => {
  const ROLE: Record<string, TeachersDepartmentRole> = { teachers: 'member', none: null };
  const decide = (actor: Actor, basis: PageBasis | null, teachersRole: TeachersDepartmentRole, keys: Iterable<string>) =>
    decideTeacherRecordsAccess({
      basis,
      pd012: decidePd012StaffAccess(actor, teachersRole),
      file: decideTeacherFileAccess(actor, { organizationId: actor.organizationId!, teachersDepartmentRole: teachersRole }),
      keys: new Set(keys),
    });
  const bundle = (role: string, kind: 'operations' | 'teachers', position: 'manager' | 'member') =>
    legacyBundle(legacyTierOf(role), { kind, position });

  it('the super admin: both pages, every action, amounts, balance, the Teacher File', () => {
    const sa = admin('sa-1', StaffRole.SUPER_ADMIN);
    expect(decide(sa, 'super_admin', null, legacyBundle('super_admin', { kind: null, position: null }))).toEqual({
      basis: 'super_admin',
      attendance: { view: true, record: true, decide: true },
      grants: { view: true, record: true },
      leaveBalance: true,
      amounts: true,
      opensFile: true,
    });
  });

  it('a Teachers supervisor: both pages and every action, the balance and the File, never an amount', () => {
    const a = admin('t-1', StaffRole.ADMIN);
    expect(decide(a, 'teachers', ROLE.teachers, bundle(StaffRole.ADMIN, 'teachers', 'member'))).toEqual({
      basis: 'teachers',
      attendance: { view: true, record: true, decide: true },
      grants: { view: true, record: true },
      leaveBalance: true,
      amounts: false,
      opensFile: true,
    });
  });

  it('an Operations supervisor: both pages and every action (PD-26 amendment), no balance, amount or File', () => {
    const a = admin('o-1', StaffRole.ADMIN);
    expect(decide(a, 'operations', null, bundle(StaffRole.ADMIN, 'operations', 'member'))).toEqual({
      basis: 'operations',
      attendance: { view: true, record: true, decide: true },
      grants: { view: true, record: true },
      leaveBalance: false,
      amounts: false,
      opensFile: false,
    });
  });

  it('no basis: nothing, whatever keys are held (a key is never sufficient)', () => {
    const a = admin('s-1', StaffRole.ADMIN);
    expect(decide(a, null, null, ['teacher_attendance.view', 'teacher_grants.view', 'teacher_supervision.view'])).toEqual(NO_TEACHER_RECORDS_ACCESS);
  });

  it('a basis without the key: that page is not offered (a role that holds only page B)', () => {
    const a = admin('t-2', StaffRole.ADMIN);
    const got = decide(a, 'teachers', ROLE.teachers, ['teacher_grants.view', 'teacher_grants.record']);
    expect(got.attendance).toEqual({ view: false, record: false, decide: false });
    expect(got.grants).toEqual({ view: true, record: true });
    expect(got.leaveBalance).toBe(false);
  });

  it('recording and deciding are separate keys on page A', () => {
    const a = admin('t-3', StaffRole.ADMIN);
    expect(decide(a, 'teachers', ROLE.teachers, ['teacher_attendance.view', 'teacher_attendance.record']).attendance).toEqual({
      view: true,
      record: true,
      decide: false,
    });
    expect(decide(a, 'teachers', ROLE.teachers, ['teacher_attendance.view', 'teacher_attendance.decide']).attendance).toEqual({
      view: true,
      record: false,
      decide: true,
    });
  });

  it('the old keys still count, for one release', () => {
    const a = admin('t-4', StaffRole.ADMIN);
    const got = decide(a, 'teachers', ROLE.teachers, ['teacher_supervision.view', 'teacher_supervision.record']);
    expect(got.attendance).toEqual({ view: true, record: true, decide: true });
    expect(got.grants).toEqual({ view: true, record: true });
  });
});
