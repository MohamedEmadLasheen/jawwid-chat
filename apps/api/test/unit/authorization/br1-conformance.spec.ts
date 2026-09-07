/**
 * BR-1 conformance matrix (QA release gates G-01, G-02, G-03).
 *
 *   Teacher <-> Parent direct 1:1 communication is FORBIDDEN, for messaging and
 *   calling alike. Teacher <-> Parent communication happens ONLY through the
 *   official Student Group.
 *
 * QA (AI #5) specified this matrix as it.todo because the seams did not exist:
 * there was no teacher actor (JC-003) and no conversation participant set
 * (JC-002). Both now exist, so the matrix below is executable.
 *
 * These assertions exercise the server-side decision directly. They pass with
 * any client behaviour whatsoever, which is the point: BR-1 is a server rule.
 */
import { CommErrorCode } from '@platform/errors';
import { isFamilyFacingStaff } from '@platform/types';
import {
  IN_SCOPE,
  academicStaff,
  admin,
  authzWithOnDuty,
  conversation,
  coverageAdmin,
  financeStaff,
  manager,
  member,
  parent,
  studentGroup,
  teacher,
} from '../../support/fixtures';

const NOW = new Date('2026-09-06T10:00:00Z');

describe('BR-1 — forbidden 1:1 channels', () => {
  const authz = authzWithOnDuty();

  it('BR1-01 teacher opens a 1:1 with a parent -> DENY', () => {
    const d = authz.canOpenDirect(teacher(), parent(), IN_SCOPE);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
  });

  it('BR1-02 parent opens a 1:1 with a teacher -> DENY (order does not matter)', () => {
    const d = authz.canOpenDirect(parent(), teacher(), IN_SCOPE);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
  });

  it('BR1-03 teacher sends into a direct conversation containing a parent -> DENY', async () => {
    const t = teacher();
    const d = await authz.canSend(
      t,
      conversation({ type: 'direct' }),
      member(t),
      { visibility: 'customer' },
      NOW,
      null,
      // The participant set is what BR-1 is decided on: a contact is present.
      ['teacher', 'contact'],
      undefined,
      IN_SCOPE,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
  });

  it('BR1-04/05 a direct call pairing a teacher and a parent -> DENY', async () => {
    const t = teacher();
    const d = await authz.canCall(
      t,
      conversation({ type: 'direct' }),
      member(t),
      [teacher(), parent()],
      NOW,
      undefined,
      undefined,
      undefined,
      IN_SCOPE,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
  });

  it('BR1-06 group co-members cannot open a 1:1 with each other', () => {
    // Sharing a student group grants no direct channel whatsoever.
    const d = authz.canOpenDirect(teacher('teacher-in-group'), parent('parent-in-group'), IN_SCOPE);
    expect(d.allowed).toBe(false);
  });

  it('teacher-to-teacher direct messaging is off by default', () => {
    const d = authz.canOpenDirect(teacher('t1'), teacher('t2'), IN_SCOPE);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.TEACHER_TEACHER_DISABLED);
  });

  it('two family contacts cannot open a channel', () => {
    expect(authz.canOpenDirect(parent('p1'), parent('p2'), IN_SCOPE).allowed).toBe(false);
  });

  it('back-office staff may never take part in family communication', () => {
    expect(isFamilyFacingStaff(financeStaff())).toBe(false);
    expect(isFamilyFacingStaff(academicStaff())).toBe(false);
    for (const role of [financeStaff(), academicStaff()]) {
      const d = authz.canOpenDirect(role, parent(), IN_SCOPE);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY);
    }
  });

  it('an unknown actor pairing is denied by default rather than allowed by accident', () => {
    const alien = { ...parent(), kind: 'martian' as never };
    expect(authz.canOpenDirect(alien, parent('p2'), IN_SCOPE).allowed).toBe(false);
  });
});

describe('BR-1 — permitted channels', () => {
  const authz = authzWithOnDuty();

  it('parent <-> admin 1:1 -> ALLOW', () => {
    expect(authz.canOpenDirect(parent(), admin(), IN_SCOPE).allowed).toBe(true);
  });

  it('teacher <-> admin 1:1 -> ALLOW', () => {
    expect(authz.canOpenDirect(teacher(), admin(), IN_SCOPE).allowed).toBe(true);
  });

  it('coverage admin counts as family-facing', () => {
    expect(authz.canOpenDirect(parent(), coverageAdmin('cov-1'), IN_SCOPE).allowed).toBe(true);
  });

  it('a teacher may post in a Teacher<->Admin 1:1: no contact is present', async () => {
    const t = teacher();
    const d = await authz.canSend(
      t,
      conversation({ type: 'direct' }),
      member(t),
      { visibility: 'customer' },
      NOW,
      null,
      ['teacher', 'staff'],
      undefined,
      IN_SCOPE,
    );
    expect(d.allowed).toBe(true);
  });
});

describe('BR-1 — the permitted case: teacher and parent inside the student group', () => {
  const authz = authzWithOnDuty();

  it('a teacher may post in the student group', async () => {
    const t = teacher();
    const d = await authz.canSend(t, studentGroup(), member(t), { visibility: 'customer' }, NOW, undefined, undefined, undefined, IN_SCOPE);
    expect(d.allowed).toBe(true);
  });

  it('a parent may post in the student group', async () => {
    const p = parent();
    const d = await authz.canSend(p, studentGroup(), member(p), { visibility: 'customer' }, NOW, undefined, undefined, undefined, IN_SCOPE);
    expect(d.allowed).toBe(true);
  });

  it('teacher and parent may share a GROUP call — with the admin actually present', async () => {
    // C-4 (2026-09-06) requires admin presence to be evaluated at operation
    // time, so the permitted case must now SAY who is present rather than imply
    // it from the participant list. Without live membership the policy fails
    // closed, which is deliberate: a caller that cannot establish who is in the
    // group cannot be told the interaction is safe. The negative cases live in
    // br1-admin-presence.spec.ts.
    const t = teacher();
    const d = await authz.canCall(
      t,
      studentGroup(),
      member(t),
      [teacher(), parent(), admin()],
      NOW,
      null,
      [
        { actorId: 'teacher-1', actorKind: 'teacher', memberRole: 'teacher' },
        { actorId: 'parent-1', actorKind: 'contact', memberRole: 'parent' },
        { actorId: 'admin-1', actorKind: 'staff', memberRole: 'admin', isActive: true },
      ],
      undefined,
      IN_SCOPE,
    );
    expect(d.allowed).toBe(true);
  });

  it('a teacher who is not a member of the group cannot post in it', async () => {
    const d = await authz.canSend(teacher('outsider'), studentGroup(), null, { visibility: 'customer' }, NOW, undefined, undefined, undefined, IN_SCOPE);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('a member who has left the group cannot post in it', async () => {
    const t = teacher();
    const d = await authz.canSend(
      t,
      studentGroup(),
      member(t, { leftAt: new Date('2026-09-01T00:00:00Z') }),
      { visibility: 'customer' },
      NOW,
      undefined,
      undefined,
      undefined,
      IN_SCOPE,
    );
    expect(d.allowed).toBe(false);
  });

  it('a silent member is present but may not post', async () => {
    const t = teacher();
    const d = await authz.canSend(
      t,
      studentGroup(),
      member(t, { isSilent: true }),
      { visibility: 'customer' },
      NOW,
      undefined,
      undefined,
      undefined,
      IN_SCOPE,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.MEMBER_IS_SILENT);
  });
});

describe('BR-1 — membership management cannot be used to route around the rule', () => {
  const authz = authzWithOnDuty();

  it('BR1-07/08 a teacher may not change membership', () => {
    const d = authz.canManageMembership(teacher(), IN_SCOPE);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
  });

  it('BR1-10 a parent may not change membership', () => {
    expect(authz.canManageMembership(parent(), IN_SCOPE).allowed).toBe(false);
  });

  it('an admin may change membership', () => {
    expect(authz.canManageMembership(admin(), IN_SCOPE).allowed).toBe(true);
    expect(authz.canManageMembership(manager(), IN_SCOPE).allowed).toBe(true);
  });
});

describe('BR-1 — archived conversations accept nothing', () => {
  it('no one may post into an archived group', async () => {
    const authz = authzWithOnDuty();
    const p = parent();
    const d = await authz.canSend(
      p,
      studentGroup({ archivedAt: new Date('2026-01-01T00:00:00Z') }),
      member(p),
      { visibility: 'customer' },
      NOW,
      undefined,
      undefined,
      undefined,
      IN_SCOPE,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.CONVERSATION_ARCHIVED);
  });
});
