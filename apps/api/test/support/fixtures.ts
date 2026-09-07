import { AuthorizationService } from '@platform/authorization.service';
import type { ScopeState } from '@platform/authorization.service';
import type { CoverageService } from '@platform/coverage.service';
import { Actor } from '@platform/types';
import { AuthzRole, ROLE_PERMISSIONS } from '@platform/rbac/permissions';

/** on_duty() is AI #1's; unit tests stub it rather than reimplement coverage. */
export class FakeCoverage implements CoverageService {
  constructor(private readonly onDutyId: string | null = null) {}
  async onDuty(): Promise<string | null> {
    return this.onDutyId;
  }
}

export const authzWithOnDuty = (onDutyId: string | null = null): AuthorizationService =>
  new AuthorizationService(new FakeCoverage(onDutyId));

/**
 * PHASE 1: scope is now an explicit argument to every conversation decision,
 * and `undefined` means NOT ESTABLISHED -- which denies for staff.
 *
 * `IN_SCOPE` is what a test says when the point it is making is about something
 * else (BR-1, moderation, attribution) and the family is simply the actor's.
 * `OUT_OF_SCOPE` is for the tests that are about scope itself. Making it
 * explicit in the fixtures rather than defaulting it is deliberate: a test that
 * forgets to say gets a denial, which is the safe direction for a mistake.
 */
export const IN_SCOPE: ScopeState = { familyInScope: true, sameOrganization: true };
export const OUT_OF_SCOPE: ScopeState = { familyInScope: false, sameOrganization: true };
export const OTHER_TENANT: ScopeState = { familyInScope: true, sameOrganization: false };

const permissionsFor = (role: AuthzRole): ReadonlySet<string> =>
  new Set<string>(ROLE_PERMISSIONS[role]);

export const parent = (id = 'parent-1', familyId = 'family-1'): Actor => ({
  actorId: id,
  kind: 'contact',
  displayName: 'Umm Ahmed',
  locale: 'ar',
  isActive: true,
  organizationId: 'org-jawwid',
  accountId: `account-${id}`,
  familyId,
  canMessage: true,
  permissions: permissionsFor(AuthzRole.PARENT),
});

export const teacher = (id = 'teacher-1'): Actor => ({
  actorId: id,
  kind: 'teacher',
  displayName: 'Ustadh Mohamed',
  locale: 'ar',
  isActive: true,
  organizationId: 'org-jawwid',
  accountId: `account-${id}`,
  permissions: permissionsFor(AuthzRole.TEACHER),
});

export const admin = (id = 'admin-1', role: string = 'admin'): Actor => ({
  actorId: id,
  kind: 'staff',
  displayName: 'Admin',
  locale: 'ar',
  isActive: true,
  organizationId: 'org-jawwid',
  accountId: `account-${id}`,
  staffRole: role as Actor['staffRole'],
  department: null,
  permissions:
    role in ROLE_PERMISSIONS ? permissionsFor(role as AuthzRole) : new Set<string>(),
});

export const coverageAdmin = (id = 'coverage-1'): Actor => admin(id, 'coverage_admin');
export const manager = (id = 'manager-1'): Actor => admin(id, 'manager');
export const superAdmin = (id = 'super-1'): Actor => admin(id, 'super_admin');

/**
 * Departmental staff.
 *
 * `finance` / `technical` / `academic` used to be ROLES; PD-5 made them
 * departments on a staff row whose role is `admin`. Either shape must be
 * non-family-facing, so the fixtures carry both: `financeStaff()` is the
 * post-migration shape, and `legacyRoleStaff()` proves that an actor still
 * claiming one of the removed role names is refused rather than unrecognised.
 */
export const departmentStaff = (id: string, department: string): Actor => ({
  ...admin(id, 'admin'),
  department,
  permissions: new Set<string>(),
});
export const financeStaff = (id = 'finance-1'): Actor => departmentStaff(id, 'finance');
export const academicStaff = (id = 'academic-1'): Actor => departmentStaff(id, 'academic');
export const technicalStaff = (id = 'technical-1'): Actor => departmentStaff(id, 'technical');
export const legacyRoleStaff = (id: string, role: string): Actor => admin(id, role);

type Conv = Parameters<AuthorizationService['canRead']>[1];

export const conversation = (over: Partial<Conv> = {}): Conv => ({
  id: 'conv-1',
  type: 'direct',
  familyId: 'family-1',
  stickyHandlerId: null,
  stickyUntil: null,
  teacherRequiresApproval: true,
  parentRequiresApproval: true,
  archivedAt: null,
  ...over,
} as Conv);

export const studentGroup = (over: Partial<Conv> = {}): Conv =>
  conversation({ type: 'student_group', ...over });

type Member = Parameters<AuthorizationService['canRead']>[2];

export const member = (actor: Actor, over: Partial<NonNullable<Member>> = {}): NonNullable<Member> =>
  ({
    actorId: actor.actorId,
    actorKind: actor.kind,
    memberRole:
      actor.kind === 'contact' ? 'parent' : actor.kind === 'teacher' ? 'teacher' : 'admin',
    isSilent: false,
    leftAt: null,
    ...over,
  }) as NonNullable<Member>;
