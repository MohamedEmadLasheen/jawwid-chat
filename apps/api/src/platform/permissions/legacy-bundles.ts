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
const DEPARTMENT_MANAGER = k('org.view', 'org.manage', 'org.covers', 'staff_profiles.team', 'staff_profiles.manage', 'reports.view');

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
  'feedback.manage',
);

/** The Teachers department: certificates, leave, discipline, supervision, the Teacher File (PD-10, PD-12, PD-35). */
const TEACHERS_MEMBER = k(
  'org.covers',
  'accounts.administer',
  'accounts.support_session',
  'certificates.view',
  'certificates.deliver',
  'certificates.decline',
  'leave.view',
  'leave.decide',
  'discipline.view',
  'discipline.manage',
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
  'feedback.manage',
);

/** Sales: enrolment, trials, payments (PD-16, PD-20). */
const SALES_MEMBER = k(
  'org.covers',
  'accounts.administer',
  'parents.view',
  'billing.view',
  'billing.record',
  'subscriptions.view',
  'schedule.view',
  'trials.view',
  'trials.manage',
  'new_students.view',
  'new_students.manage',
  'students.view',
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
  ],
  'manager:teachers': [
    ...CONVERSATION_STAFF,
    ...DEPARTMENT_MANAGER,
    ...TEACHERS_MEMBER,
    'leave.allowance',
    'teacher_files.edit',
    'materials.manage',
    'lessons.courses',
  ],
  'manager:sales': [...CONVERSATION_STAFF, ...DEPARTMENT_MANAGER, ...SALES_MEMBER, 'subscriptions.manage'],
  'manager:none': [...CONVERSATION_STAFF, 'org.view', 'staff_profiles.team', 'staff_profiles.manage'],
  'supervisor:operations': [...CONVERSATION_STAFF, ...OPERATIONS_MEMBER],
  'supervisor:teachers': [...CONVERSATION_STAFF, ...TEACHERS_MEMBER],
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
