/**
 * Conversation membership -- who may change it, where, and who may be added.
 *
 * Before this, `POST /conversations/:id/members` asked only whether the caller
 * held a family-facing staff role, then wrote whatever actorId / actorKind /
 * memberRole the client sent into any conversation of any organization. A
 * coverage admin could remove the other side of a Teacher<->Admin direct and
 * add themselves in its place.
 *
 * Pure: the decisions are exercised directly. The real-database counterpart is
 * test/integration/membership-authorization.spec.ts.
 */
import { CommErrorCode } from '@platform/errors';
import { StaffAccessBasis } from '@platform/staff-scope';
import type { Actor } from '@platform/types';
import { admin, authzWithOnDuty, financeStaff, manager, parent, teacher } from '../../support/fixtures';

const authz = authzWithOnDuty();
const ORG = 'org-1';

const coverageAdmin = (id = 'coverage-1') => admin(id, 'coverage');
type ConvFacts = Parameters<typeof authz.canManageMembershipIn>[1];
/** PD-8: the actor's resolved scope basis arrives as `actorBasis`; default none. */
const group = (over: Partial<ConvFacts> = {}): ConvFacts => ({
  type: 'student_group',
  organizationId: ORG,
  actorBasis: null,
  actorMemberRole: null,
  ...over,
});

function deniedWith(d: { allowed: boolean; code?: CommErrorCode }, code: CommErrorCode) {
  expect(d.allowed).toBe(false);
  if (!d.allowed) expect(d.code).toBe(code);
}

describe('canManageMembership -- the gate', () => {
  it('admin, coverage and manager pass', () => {
    for (const a of [admin(), coverageAdmin(), manager()]) expect(authz.canManageMembership(a).allowed).toBe(true);
  });
  it('a parent, a teacher and department staff are refused', () => {
    for (const a of [parent(), teacher(), financeStaff()]) {
      deniedWith(authz.canManageMembership(a), CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
    }
  });
  it('an inactive admin is refused as inactive (previously unchecked)', () => {
    deniedWith(authz.canManageMembership({ ...admin(), isActive: false }), CommErrorCode.ACTOR_INACTIVE);
  });
  it('staff with no organization are refused', () => {
    const orphan: Actor = { ...manager(), organizationId: undefined };
    deniedWith(authz.canManageMembership(orphan), CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
  });
});

describe('canManageMembershipIn -- which conversation (PD-8: whoever is in charge of it)', () => {
  it("the children's supervisor may manage their Student Group", () => {
    expect(authz.canManageMembershipIn(admin('admin-1'), group({ actorBasis: StaffAccessBasis.RESPONSIBLE })).allowed).toBe(true);
  });
  it('their ACTIVE backup, their department manager and the super admin may too', () => {
    expect(authz.canManageMembershipIn(coverageAdmin(), group({ actorBasis: StaffAccessBasis.BACKUP })).allowed).toBe(true);
    expect(authz.canManageMembershipIn(manager(), group({ actorBasis: StaffAccessBasis.MANAGER })).allowed).toBe(true);
    expect(
      authz.canManageMembershipIn(admin('super-1', 'super_admin'), group({ actorBasis: StaffAccessBasis.SUPER_ADMIN })).allowed,
    ).toBe(true);
  });
  it('a manager with no basis (another department) is refused: the role alone is not scope', () => {
    deniedWith(authz.canManageMembershipIn(manager(), group()), CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
  });
  it('an admin who is not in charge is refused, even if an admin member of the group', () => {
    deniedWith(
      authz.canManageMembershipIn(admin('admin-2'), group({ actorMemberRole: 'admin' })),
      CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
    );
  });
  it('a coverage admin with no active backup link is refused (on duty is not scope)', () => {
    deniedWith(authz.canManageMembershipIn(coverageAdmin(), group()), CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
  });
  it('a direct conversation is refused to EVERYONE, a manager and its own admin member included', () => {
    for (const a of [manager(), admin('admin-1')]) {
      deniedWith(
        authz.canManageMembershipIn(a, group({ type: 'direct', actorBasis: StaffAccessBasis.MEMBER, actorMemberRole: 'admin' })),
        CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
      );
      deniedWith(
        authz.canManageMembershipIn(a, group({ type: 'direct', actorBasis: StaffAccessBasis.MANAGER })),
        CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
      );
    }
  });
  it("another organization's conversation reads as NOT FOUND, even to a manager in charge", () => {
    deniedWith(
      authz.canManageMembershipIn(manager(), group({ organizationId: 'org-2', actorBasis: StaffAccessBasis.MANAGER })),
      CommErrorCode.CONVERSATION_NOT_FOUND,
    );
  });
  it('a non-group conversation: its live ADMIN member (MEMBER basis) or whoever is in charge, nobody else', () => {
    const classGroup = { type: 'class_group' };
    expect(
      authz.canManageMembershipIn(admin(), group({ ...classGroup, actorBasis: StaffAccessBasis.MEMBER, actorMemberRole: 'admin' })).allowed,
    ).toBe(true);
    expect(authz.canManageMembershipIn(manager(), group({ ...classGroup, actorBasis: StaffAccessBasis.MANAGER })).allowed).toBe(true);
    deniedWith(authz.canManageMembershipIn(admin(), group(classGroup)), CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
    deniedWith(
      authz.canManageMembershipIn(admin(), group({ ...classGroup, actorBasis: StaffAccessBasis.MEMBER, actorMemberRole: 'observer' })),
      CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
    );
  });
  it('repeats the gate, so it is safe to call on its own', () => {
    deniedWith(authz.canManageMembershipIn(parent(), group({ actorBasis: StaffAccessBasis.RESPONSIBLE })), CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
    deniedWith(
      authz.canManageMembershipIn({ ...admin('admin-1'), isActive: false }, group({ actorBasis: StaffAccessBasis.RESPONSIBLE })),
      CommErrorCode.ACTOR_INACTIVE,
    );
  });
});

describe('canAddMember -- who may be added, judged from their own row', () => {
  const conv = { type: 'student_group', organizationId: ORG, familyId: 'family-1', learnerTeacherId: 'teacher-1' };
  const contact = (over = {}) => ({
    kind: 'contact' as const, organizationId: ORG, isActive: true, familyId: 'family-1', canMessage: true, ...over,
  });
  const teacherRow = (over = {}) => ({
    kind: 'teacher' as const, actorId: 'teacher-1', organizationId: ORG, isActive: true, leftAt: null, ...over,
  });
  // PD-8: `access` is the candidate's own basis on the conversation; in charge by default.
  const staffRow = (over: Record<string, unknown> = {}) => ({
    kind: 'staff' as const, organizationId: ORG, isActive: true, leftAt: null, staffRole: 'admin',
    access: StaffAccessBasis.MANAGER as StaffAccessBasis | null, ...over,
  });
  const no = (d: ReturnType<typeof authz.canAddMember>) => deniedWith(d, CommErrorCode.INVALID_PARTICIPANTS);

  it("a contact of the conversation's family, as parent", () => {
    expect(authz.canAddMember(conv, 'parent', contact()).allowed).toBe(true);
  });
  it('a contact of ANOTHER family is refused (the client cannot move a parent between families)', () => {
    no(authz.canAddMember(conv, 'parent', contact({ familyId: 'family-2' })));
  });
  it('a contact who may not message, or is inactive, is refused', () => {
    no(authz.canAddMember(conv, 'parent', contact({ canMessage: false })));
    no(authz.canAddMember(conv, 'parent', contact({ isActive: false })));
  });
  it('a contact may not be added as admin or teacher (kind and role must agree)', () => {
    no(authz.canAddMember(conv, 'admin', contact()));
    no(authz.canAddMember(conv, 'teacher', contact()));
  });
  it("the learner's own teacher, as teacher", () => {
    expect(authz.canAddMember(conv, 'teacher', teacherRow()).allowed).toBe(true);
  });
  it('any other teacher is refused -- teaching is the academy\'s fact, not a request field', () => {
    no(authz.canAddMember(conv, 'teacher', teacherRow({ actorId: 'teacher-2' })));
  });
  it('an inactive or departed teacher is refused', () => {
    no(authz.canAddMember(conv, 'teacher', teacherRow({ isActive: false })));
    no(authz.canAddMember(conv, 'teacher', teacherRow({ leftAt: new Date() })));
  });
  it('a teacher may not be added to a non-Student-Group conversation', () => {
    no(authz.canAddMember({ ...conv, type: 'official', learnerTeacherId: null }, 'teacher', teacherRow()));
  });
  it('a teacher may not be added as admin', () => {
    no(authz.canAddMember(conv, 'admin', teacherRow()));
  });
  it('conversation staff already in charge of it, as admin or observer', () => {
    for (const role of ['admin', 'observer']) {
      for (const staffRole of ['admin', 'coverage', 'manager', 'super_admin']) {
        expect(authz.canAddMember(conv, role, staffRow({ staffRole })).allowed).toBe(true);
      }
    }
  });
  it('a staff member NOT in charge of the conversation is refused: another supervisor cannot be pulled in (PD-8)', () => {
    no(authz.canAddMember(conv, 'admin', staffRow({ access: null })));
    no(authz.canAddMember(conv, 'observer', staffRow({ staffRole: 'manager', access: null })));
  });
  it("a family group admits a teacher of one of ITS children, and no other (PD-8)", () => {
    const fg = { type: 'family_group', organizationId: ORG, familyId: 'family-1', learnerTeacherId: null, anchorTeacherIds: ['teacher-1'] };
    expect(authz.canAddMember(fg, 'teacher', teacherRow()).allowed).toBe(true);
    no(authz.canAddMember(fg, 'teacher', teacherRow({ actorId: 'teacher-2' })));
    no(authz.canAddMember({ ...fg, anchorTeacherIds: undefined }, 'teacher', teacherRow()));
    expect(authz.canAddMember(fg, 'parent', contact()).allowed).toBe(true);
    no(authz.canAddMember(fg, 'parent', contact({ familyId: 'family-2' })));
  });
  it('department staff, inactive staff and staff "as parent" are refused', () => {
    no(authz.canAddMember(conv, 'admin', staffRow({ staffRole: 'finance' })));
    no(authz.canAddMember(conv, 'admin', staffRow({ isActive: false })));
    no(authz.canAddMember(conv, 'parent', staffRow()));
  });
  it('a candidate in another organization is refused exactly as an unknown one', () => {
    const cross = authz.canAddMember(conv, 'admin', staffRow({ organizationId: 'org-2' }));
    const unknown = authz.canAddMember(conv, 'admin', null);
    no(cross);
    no(unknown);
    if (!cross.allowed && !unknown.allowed) expect(cross.reason).toBe(unknown.reason);
  });
  it('contacts are refused in a family-less conversation (class-group rules are Phase 2)', () => {
    no(authz.canAddMember({ ...conv, type: 'class_group', familyId: null, learnerTeacherId: null }, 'parent', contact()));
  });
});
