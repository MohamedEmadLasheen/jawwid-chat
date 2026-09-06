import { AuthorizationService } from '@platform/authorization.service';
import type { CoverageService } from '@platform/coverage.service';
import { Actor } from '@platform/types';

/** on_duty() is AI #1's; unit tests stub it rather than reimplement coverage. */
export class FakeCoverage implements CoverageService {
  constructor(private readonly onDutyId: string | null = null) {}
  async onDuty(): Promise<string | null> {
    return this.onDutyId;
  }
}

export const authzWithOnDuty = (onDutyId: string | null = null): AuthorizationService =>
  new AuthorizationService(new FakeCoverage(onDutyId));

export const parent = (id = 'parent-1', familyId = 'family-1'): Actor => ({
  actorId: id,
  kind: 'contact',
  displayName: 'Umm Ahmed',
  locale: 'ar',
  isActive: true,
  familyId,
  canMessage: true,
});

export const teacher = (id = 'teacher-1'): Actor => ({
  actorId: id,
  kind: 'teacher',
  displayName: 'Ustadh Mohamed',
  locale: 'ar',
  isActive: true,
});

export const admin = (id = 'admin-1', role: string = 'admin'): Actor => ({
  actorId: id,
  kind: 'staff',
  displayName: 'Admin',
  locale: 'ar',
  isActive: true,
  staffRole: role as Actor['staffRole'],
});

export const manager = (id = 'manager-1'): Actor => admin(id, 'manager');
export const financeStaff = (id = 'finance-1'): Actor => admin(id, 'finance');
export const academicStaff = (id = 'academic-1'): Actor => admin(id, 'academic');

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
