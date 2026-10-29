import { ActorKind, StaffRole } from '../../communication/contracts/vocab';
import type { Actor } from '../types';
import { PERMISSION_KEYS, type PermissionKey } from './catalogue';

/**
 * PD-40: what every EXISTING staff account holds, as permission keys -- its
 * legacy bundle, decided by its staff role and the department it runs or
 * belongs to. Nobody grants these; they are what today's service rules already
 * let that kind of account reach, written down so PermissionGuard has
 * something to check them against.
 *
 * WHY PER DEPARTMENT, NOT PER ROLE. A role alone overstates: "manager" spans
 * the Operations, Teachers and Sales managers, and only one of them reads
 * money. A bundle per role would let a Teachers manager appear to hold
 * billing.record and, once PD-40 lets managers grant what they hold, delegate
 * it. So a bundle is (tier, department kind), the same shape as
 * decidePd012StaffAccess / decideBillingAccess / decideTeacherFileAccess.
 *
 * VERIFIED vs WIDE. For keys with a DB-free policy behind them (billing, PD-12,
 * Teacher File, staff profiles, account administration, organization) the
 * bundle is checked against that policy, both ways, by
 * pd040-legacy-bundles.spec.ts. The other keys are WIDE: granted to every tier
 * whose service rule could ever admit it, because a missing key would refuse
 * a legitimate request once the guard enforces. Wide grants change nothing --
 * the service still decides -- but they are not delegable (catalogue.ts) until
 * they are verified too.
 *
 * The super admin holds every key. The tier `specialist` (PD-40 PR-2) holds
 * none: its keys come only from the roles it is granted.
 */
export type LegacyTier = 'super_admin' | 'manager' | 'supervisor' | 'legacy_department';
export type DepartmentKind = 'operations' | 'teachers' | 'sales';

/** Where a staff member sits, as the database says: the department they run or belong to. */
export interface StaffPlacement {
  kind: DepartmentKind | null;
  position: 'manager' | 'member' | null;
}

export const NO_PLACEMENT: StaffPlacement = Object.freeze({ kind: null, position: null });

export function legacyTierOf(role: string | undefined): LegacyTier | null {
  switch (role) {
    case StaffRole.SUPER_ADMIN:
      return 'super_admin';
    case StaffRole.MANAGER:
      return 'manager';
    case StaffRole.ADMIN:
    case StaffRole.COVERAGE:
      return 'supervisor';
    case StaffRole.FINANCE:
    case StaffRole.TECHNICAL:
    case StaffRole.ACADEMIC:
      return 'legacy_department';
    default:
      return null;
  }
}

const k = (...keys: PermissionKey[]): readonly PermissionKey[] => keys;

/** Every family-facing staff member, whatever their department: PD-8 decides which conversations. */
const CONVERSATION_STAFF = k('chat.use', 'chat.manage', 'chat.moderate', 'calls.use', 'stories.view', 'stories.publish', 'teacher_profiles.review');

/** Running a department: the structure view, backups and covers, the team's profiles. */
const DEPARTMENT_MANAGER = k(
  'org.view',
  'org.manage',
  'org.covers',
  'staff_profiles.team',
  'staff_profiles.manage',
  'reports.view',
  // PD-40 PR-3 (owner 2026-10-28, S1): a department manager creates and manages
  // the specialists of their department (decideStaffAccountCreate / Manage).
  'staff_accounts.view',
  'staff_accounts.create',
  'staff_accounts.manage',
  // PD-47: their team's tasks -- watch, give, decide (TaskService narrows to the team).
  'tasks.team',
  'tasks.create',
  'tasks.manage',
);

/** Operations supervisors: their families' money, contact record, lessons and journey (PD-8, PD-15, PD-17). */
const OPERATIONS_MEMBER = k(
  'org.covers',
  'accounts.administer',
  'accounts.support_session',
  'parents.view',
  'parents.edit',
  'billing.view',
  'billing.record',
  'subscriptions.view',
  'subscriptions.carry_over',
  'schedule.view',
  'schedule.manage',
  'lessons.view',
  'lessons.manage',
  'students.view',
  'students.manage',
  'trials.view',
  'trials.manage',
  'new_students.view',
  'new_students.manage',
  'materials.view',
  'cases.view',
  'cases.manage',
  'feedback.view',
  // PD-26 amendment: the Teacher Supervision page, for the teachers of their
  // families (the services narrow by TeacherScopeService.pageScopeOf). Never
  // the Teacher File itself: no teacher_files.* key.
  'teacher_supervision.view',
  'teacher_supervision.record',
  // PD-41: an Operations supervisor requests their students' certificates,
  // approves the design, sends it and publishes its Story (owner 2026-10-28).
  'certificates.view',
  'certificates.request.student',
  'certificates.deliver',
  'certificates.story',
);

/** The Teachers department: certificates, leave, discipline, supervision, the Teacher File (PD-10, PD-12, PD-35). */
const TEACHERS_MEMBER = k(
  'org.covers',
  'accounts.administer',
  'accounts.support_session',
  'certificates.view',
  // PD-12's issuers keep designing until a Designer exists (PD-41 design §6.2).
  'certificates.design',
  'certificates.deliver',
  // PD-41: Teacher Supervision requests teachers' certificates.
  'certificates.request.teacher',
  'certificates.story',
  'teacher_supervision.view',
  'teacher_supervision.record',
  'supervision.chats',
  'teacher_files.view',
  'teacher_files.supervise',
  'teacher_files.evaluate',
  'schedule.view',
  'schedule.manage',
  'lessons.view',
  'lessons.manage',
  'students.view',
  'trials.view',
  'trials.manage',
  'materials.view',
  'cases.view',
  'cases.manage',
  'feedback.view',
  // PD-40 shadow QA (2026-10-28): the stats reader is the Teachers department
  // (StatsService.isStatsReader), members included.
  'reports.view',
  // PD-43 (owner Q1): teacher supervisors add teachers too, for themselves or
  // with no supervisor (decideTeacherOnboarding narrows them).
  'teachers.create',
  // PD-47: a teacher supervisor sees their own teachers' tasks, read-only
  // (owner Q3), and gives them tasks (Q5). TaskService narrows to their teachers.
  'tasks.team',
  'tasks.create',
);

/** Sales: enrolment, trials, payments (PD-16, PD-20). */
const SALES_MEMBER = k(
  'org.covers',
  'accounts.administer',
  'parents.view',
  // PD-42: the contact record of the families they own (BillingAccess.editOwnedOnly).
  'parents.edit',
  'billing.view',
  'billing.record',
  'subscriptions.view',
  'subscriptions.carry_over',
  'schedule.view',
  'trials.view',
  'trials.manage',
  'new_students.view',
  'new_students.manage',
  'students.view',
  // PD-40 shadow QA (2026-10-28): what Sales reaches today -- the course list
  // and lessons (the enrolment form, PD-16), and the cases list (empty for
  // Sales: a case is opened and owned only by Teachers or Operations).
  'lessons.view',
  'cases.view',
);

const BUNDLES: Readonly<Record<string, readonly PermissionKey[]>> = {
  'manager:operations': [
    ...CONVERSATION_STAFF,
    ...DEPARTMENT_MANAGER,
    ...OPERATIONS_MEMBER,
    'billing.assign',
    'billing.verify',
    'subscriptions.manage',
    'materials.manage',
    'lessons.courses',
    // PD-41: the department's certificate requests, whoever filed them.
    'certificates.oversee',
  ],
  'manager:teachers': [
    ...CONVERSATION_STAFF,
    ...DEPARTMENT_MANAGER,
    ...TEACHERS_MEMBER,
    'leave.allowance',
    'teacher_files.edit',
    // PD-43 owner N2, "Full teacher finance": payroll, as the super admin.
    'teacher_files.finance',
    'teachers.offboard',
    'materials.manage',
    'lessons.courses',
    // PD-41: the department's certificate requests, whoever filed them.
    'certificates.oversee',
    // PD-48 (owner Q4): the Teachers Manager approves lesson voice-over, and grants it.
    'lesson_audio.view',
    'lesson_audio.review',
    // PD-49: the Teachers Manager checks and signs children's Quran content as a
    // teacher, and delegates both. Never the scholar's step (super admin only).
    'lesson_content.view',
    'lesson_content.check',
    'lesson_content.review_teacher',
  ],
  'manager:sales': [...CONVERSATION_STAFF, ...DEPARTMENT_MANAGER, ...SALES_MEMBER, 'subscriptions.manage'],
  'manager:none': [...CONVERSATION_STAFF, 'org.view', 'staff_profiles.team', 'staff_profiles.manage'],
  'supervisor:operations': [...CONVERSATION_STAFF, ...OPERATIONS_MEMBER],
  // PD-48: a Teachers supervisor listens; approving needs the Pronunciation reviewer role.
  // PD-49: a Teachers supervisor sees content under review; signing needs a granted role.
  'supervisor:teachers': [...CONVERSATION_STAFF, ...TEACHERS_MEMBER, 'lesson_audio.view', 'lesson_content.view'],
  'supervisor:sales': [...CONVERSATION_STAFF, ...SALES_MEMBER],
  'supervisor:none': [...CONVERSATION_STAFF],
  'legacy_department:none': [],
};

const ALL: ReadonlySet<string> = PERMISSION_KEYS;
const NONE: ReadonlySet<string> = new Set();
const SETS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(BUNDLES).map(([key, keys]) => [key, new Set(keys)]),
);

/**
 * The legacy bundle of (tier, placement). A placement that does not fit the
 * tier -- a manager listed as a member, a supervisor as a manager, a
 * department role held by finance/technical/academic -- counts as no
 * department: a stale row widens nothing.
 */
export function legacyBundle(tier: LegacyTier | null, placement: StaffPlacement): ReadonlySet<string> {
  if (tier === null) return NONE;
  if (tier === 'super_admin') return ALL;
  const fits =
    (tier === 'manager' && placement.position === 'manager') || (tier === 'supervisor' && placement.position === 'member');
  const kind = fits && placement.kind ? placement.kind : 'none';
  return SETS.get(`${tier}:${kind}`) ?? NONE;
}

/** Every bundle by name, for the spec and the generated route table. */
export function legacyBundleNames(): string[] {
  return ['super_admin', ...Object.keys(BUNDLES)];
}

/** The keys an actor holds, before PD-40 grants exist. Non-staff hold none: they are not checked. */
export function permissionsOf(actor: Actor, placement: StaffPlacement): ReadonlySet<string> {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return NONE;
  return legacyBundle(legacyTierOf(actor.staffRole), placement);
}
