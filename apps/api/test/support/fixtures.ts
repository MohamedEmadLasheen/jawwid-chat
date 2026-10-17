import { AuthorizationService } from '@platform/authorization.service';
import type { CoverageService } from '@platform/coverage.service';
import {
  StaffAccessBasis,
  type ActsFor,
  type FamilyReach,
  type StaffScope,
} from '@platform/staff-scope';
import { Actor } from '@platform/types';

/** on_duty() is AI #1's; unit tests stub it rather than reimplement coverage. */
export class FakeCoverage implements CoverageService {
  constructor(private readonly onDutyId: string | null = null) {}
  async onDuty(): Promise<string | null> {
    return this.onDutyId;
  }
}

/**
 * PD-8: the staff scope is SQL (chat.staff_conversation_access) and is proven
 * against a real database in the integration suites. Unit tests stub its
 * ANSWER per staff id, exactly as they stub on_duty(): the policy under test is
 * what AuthorizationService does with a basis, not how the basis is computed.
 */
export class FakeStaffScope implements StaffScope {
  constructor(
    private readonly access: Readonly<Record<string, StaffAccessBasis>> = {},
    private readonly acts: Readonly<Record<string, ActsFor>> = {},
    private readonly reach: Readonly<Record<string, FamilyReach>> = {},
  ) {}
  async conversationAccess(staffId: string): Promise<StaffAccessBasis | null> {
    return this.access[staffId] ?? null;
  }
  async visibleConversationIds(): Promise<string[]> {
    return [];
  }
  async familyReach(staffId: string): Promise<FamilyReach> {
    return this.reach[staffId] ?? null;
  }
  async familyReachMany(pairs: ReadonlyArray<{ staffId: string; familyId: string }>): Promise<Map<string, FamilyReach>> {
    return new Map(pairs.map((p) => [`${p.staffId}:${p.familyId}`, this.reach[p.staffId] ?? null]));
  }
  async actsFor(staffId: string): Promise<ActsFor> {
    return this.acts[staffId] ?? null;
  }
  async responsibleSupervisor(): Promise<string | null> {
    return null;
  }
}

export const authzWithScope = (
  access: Readonly<Record<string, StaffAccessBasis>> = {},
  acts: Readonly<Record<string, ActsFor>> = {},
  reach: Readonly<Record<string, FamilyReach>> = {},
): AuthorizationService => new AuthorizationService(new FakeCoverage(null), new FakeStaffScope(access, acts, reach));

/**
 * The pre-PD-8 helper, kept for the suites written against it. What "on duty"
 * used to grant is now the RESPONSIBLE basis (the child's supervisor), and the
 * default `manager-1` is the department manager of everyone -- the two facts
 * those suites actually depended on. Nothing else is in scope.
 */
export const authzWithOnDuty = (onDutyId: string | null = null): AuthorizationService =>
  authzWithScope({
    'manager-1': StaffAccessBasis.MANAGER,
    ...(onDutyId ? { [onDutyId]: StaffAccessBasis.RESPONSIBLE } : {}),
  });

/**
 * Every fixture carries an organizationId, because every real Actor does:
 * IdentityService reads it from a NOT NULL column on each principal table. A
 * fixture without one models a state the identity layer cannot produce, and a
 * tenant check written against it would be testing the wrong world.
 */
const ORG = 'org-1';

export const parent = (id = 'parent-1', familyId = 'family-1'): Actor => ({
  actorId: id,
  kind: 'contact',
  displayName: 'Umm Ahmed',
  locale: 'ar',
  isActive: true,
  familyId,
  canMessage: true,
  organizationId: ORG,
});

export const teacher = (id = 'teacher-1'): Actor => ({
  actorId: id,
  kind: 'teacher',
  displayName: 'Ustadh Mohamed',
  locale: 'ar',
  isActive: true,
  organizationId: ORG,
});

export const admin = (id = 'admin-1', role: string = 'admin'): Actor => ({
  actorId: id,
  kind: 'staff',
  displayName: 'Admin',
  locale: 'ar',
  isActive: true,
  staffRole: role as Actor['staffRole'],
  organizationId: ORG,
});

export const manager = (id = 'manager-1'): Actor => admin(id, 'manager');
export const financeStaff = (id = 'finance-1'): Actor => admin(id, 'finance');
export const academicStaff = (id = 'academic-1'): Actor => admin(id, 'academic');

type Conv = Parameters<AuthorizationService['canRead']>[1];

export const conversation = (over: Partial<Conv> = {}): Conv => ({
  id: 'conv-1',
  type: 'direct',
  organizationId: ORG,
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
