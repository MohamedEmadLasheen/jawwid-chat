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
import type { Actor } from '@platform/types';
import { admin, authzWithOnDuty, financeStaff, manager, parent, teacher } from '../../support/fixtures';

const authz = authzWithOnDuty();
const ORG = 'org-1';

const coverageAdmin = (id = 'coverage-1') => admin(id, 'coverage');
type ConvFacts = Parameters<typeof authz.canManageMembershipIn>[1];
const group = (over: Partial<ConvFacts> = {}): ConvFacts => ({
  type: 'student_group',
  organizationId: ORG,
  familyId: 'family-1',
  familyOwnerId: 'admin-1',
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

describe('canManageMembershipIn -- which conversation', () => {
  it("the family's owner may manage its Student Group", () => {
    expect(authz.canManageMembershipIn(admin('admin-1'), group()).allowed).toBe(true);
  });
  it('a manager may manage any family conversation in their organization', () => {
    expect(authz.canManageMembershipIn(manager(), group({ familyOwnerId: 'someone' })).allowed).toBe(true);
  });
  it('an admin who does not own the family is refused, even if a member of the group', () => {
    deniedWith(
      authz.canManageMembershipIn(admin('admin-2'), group({ actorMemberRole: 'admin' })),
      CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
    );
  });
  it('a coverage admin who does not own the family is refused (on duty is not scope)', () => {
    deniedWith(authz.canManageMembershipIn(coverageAdmin(), group()), CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
  });
  it('a direct conversation is refused to EVERYONE, a manager and its own admin member included', () => {
    for (const a of [manager(), admin('admin-1')]) {
      deniedWith(
        authz.canManageMembershipIn(a, group({ type: 'direct', actorMemberRole: 'admin' })),
        CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
      );
      deniedWith(
        authz.canManageMembershipIn(a, group({ type: 'direct', familyId: null, familyOwnerId: null })),
        CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
      );
    }
  });
  it("another organization's conversation reads as NOT FOUND, even to a manager", () => {
    deniedWith(
      authz.canManageMembershipIn(manager(), group({ organizationId: 'org-2' })),
      CommErrorCode.CONVERSATION_NOT_FOUND,
    );
  });
  it('a family-less conversation: its live admin member or a manager, nobody else', () => {
    const familyLess = { type: 'class_group', familyId: null, familyOwnerId: null };
    expect(authz.canManageMembershipIn(admin(), group({ ...familyLess, actorMemberRole: 'admin' })).allowed).toBe(true);
    expect(authz.canManageMembershipIn(manager(), group(familyLess)).allowed).toBe(true);
    deniedWith(authz.canManageMembershipIn(admin(), group(familyLess)), CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
    deniedWith(
      authz.canManageMembershipIn(admin(), group({ ...familyLess, actorMemberRole: 'observer' })),
      CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
    );
  });
  it('repeats the gate, so it is safe to call on its own', () => {
    deniedWith(authz.canManageMembershipIn(parent(), group()), CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
    deniedWith(
      authz.canManageMembershipIn({ ...admin('admin-1'), isActive: false }, group()),
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
  const staffRow = (over = {}) => ({
    kind: 'staff' as const, organizationId: ORG, isActive: true, leftAt: null, staffRole: 'admin', ...over,
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
  it('family-facing staff, as admin or observer', () => {
    for (const role of ['admin', 'observer']) {
      for (const staffRole of ['admin', 'coverage', 'manager']) {
        expect(authz.canAddMember(conv, role, staffRow({ staffRole })).allowed).toBe(true);
      }
    }
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
