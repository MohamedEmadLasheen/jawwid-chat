/**
 * BR-1 conformance matrix (QA release gate G-01).
 *
 * RE-VERSIONED 2026-10-14 BY PD-7, which supersedes PD-6. The rule this file
 * asserts changed back:
 *
 *   PD-6 (2026-09-23)  Teacher <-> Parent direct 1:1 communication ALLOWED for
 *                      an authorized relationship.
 *
 *   PD-7 (2026-10-14)  Teacher <-> Parent direct 1:1 communication FORBIDDEN,
 *                      for messaging and calling alike, whatever the
 *                      relationship. They speak only inside the Student Group,
 *                      with a live Jawwid admin present (C-4).
 *
 * The PD-6 pairs (unauthorized denies / authorized allows) became pairs of
 * DENIALS in both directions, so the file still proves both sides of every
 * channel rather than one. The relationship is no longer an input to the
 * decision at all: the refusal is made from the participant kinds, which is
 * why no call below can pass one.
 *
 * These assertions exercise the server-side decision directly. They pass with
 * any client behaviour whatsoever, which is the point: this is a server rule.
 */
import { CommErrorCode } from '@platform/errors';
import { isFamilyFacingStaff } from '@platform/types';
import {
  academicStaff,
  admin,
  authzWithOnDuty,
  conversation,
  financeStaff,
  manager,
  member,
  parent,
  studentGroup,
  teacher,
} from '../../support/fixtures';

const NOW = new Date('2026-09-06T10:00:00Z');

const expectBr1 = (d: { allowed: boolean; code?: string }) => {
  expect(d.allowed).toBe(false);
  if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
};

describe('PD-7 — no direct teacher/parent channel, whatever the relationship', () => {
  const authz = authzWithOnDuty();

  it('BR1-01 a teacher may not open a 1:1 with a parent -> DENY', () => {
    expectBr1(authz.canOpenDirect(teacher(), parent()));
  });

  it('BR1-02 a parent may not open a 1:1 with a teacher -> DENY (order does not matter)', () => {
    expectBr1(authz.canOpenDirect(parent(), teacher()));
  });

  it('BR1-03 a teacher may not send into a direct conversation with a parent -> DENY', async () => {
    // A conversation opened under PD-6 still exists; it is history now.
    const t = teacher();
    expectBr1(
      await authz.canSend(
        t,
        conversation({ type: 'direct' }),
        member(t),
        { visibility: 'customer' },
        NOW,
        null,
        // The participant set is what the rule is decided on: a contact is present.
        ['teacher', 'contact'],
        [],
      ),
    );
  });

  it("BR1-03b the PARENT's side is closed too -> DENY", async () => {
    const p = parent();
    expectBr1(
      await authz.canSend(
        p,
        conversation({ type: 'direct' }),
        member(p),
        { visibility: 'customer' },
        NOW,
        null,
        ['teacher', 'contact'],
        [],
      ),
    );
  });

  it("the actor's own kind counts: an incomplete participant list cannot escape the check", async () => {
    const t = teacher();
    expectBr1(
      await authz.canSend(t, conversation({ type: 'direct' }), member(t), { visibility: 'customer' }, NOW, null, ['contact']),
    );
  });

  it('BR1-04/05 a direct call pairing a teacher and a parent -> DENY', async () => {
    const t = teacher();
    expectBr1(
      await authz.canCall(t, conversation({ type: 'direct' }), member(t), [teacher(), parent()], NOW, null, []),
    );
  });

  it('BR1-04b the parent may not place that call either', async () => {
    const p = parent();
    expectBr1(
      await authz.canCall(p, conversation({ type: 'direct' }), member(p), [teacher(), parent()], NOW, null, []),
    );
  });

  it('BR1-04c the call path refuses on its OWN participant set, even with a staff-only member list', async () => {
    // canSend sees teacher+staff (allowed); the call's participants pair a
    // teacher with a parent. The call must not be more permissive.
    const t = teacher();
    expectBr1(
      await authz.canCall(
        t, conversation({ type: 'direct', familyId: null }), member(t), [teacher(), parent()], NOW, null, [],
      ),
    );
  });

  it('calling is never more permissive than messaging: same channel, same verdict', async () => {
    const t = teacher();
    const conv = conversation({ type: 'direct' });
    const send = await authz.canSend(t, conv, member(t), { visibility: 'customer' }, NOW, null, ['teacher', 'contact'], []);
    const call = await authz.canCall(t, conv, member(t), [teacher(), parent()], NOW, null, []);
    expect({ call: call.allowed, code: (call as { code?: string }).code }).toEqual({
      call: send.allowed,
      code: (send as { code?: string }).code,
    });
  });

  it('the PD-6 code TEACHER_PARENT_NOT_AUTHORIZED is no longer emitted by any decision', async () => {
    // Kept as a constant for shipped clients; nothing in the policy raises it.
    const decisions = [
      authz.canOpenDirect(teacher(), parent()),
      authz.canOpenDirect(parent(), teacher()),
      await authz.canSend(
        teacher(), conversation({ type: 'direct' }), member(teacher()),
        { visibility: 'customer' }, NOW, null, ['teacher', 'contact'], [],
      ),
      await authz.canCall(
        teacher(), conversation({ type: 'direct' }), member(teacher()),
        [teacher(), parent()], NOW, null, [],
      ),
    ];
    for (const d of decisions) {
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).not.toBe(CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED);
    }
  });

  it('BR1-06 group co-members get no direct channel from group membership alone', () => {
    expectBr1(authz.canOpenDirect(teacher('teacher-in-group'), parent('parent-in-group')));
  });

  it('teacher-to-teacher direct messaging is off by default', () => {
    const d = authz.canOpenDirect(teacher('t1'), teacher('t2'));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.TEACHER_TEACHER_DISABLED);
  });

  it('two family contacts cannot open a channel', () => {
    expect(authz.canOpenDirect(parent('p1'), parent('p2')).allowed).toBe(false);
  });

  it('back-office staff may never take part in family communication', () => {
    expect(isFamilyFacingStaff(financeStaff())).toBe(false);
    expect(isFamilyFacingStaff(academicStaff())).toBe(false);
    for (const role of [financeStaff(), academicStaff()]) {
      const d = authz.canOpenDirect(role, parent());
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY);
    }
  });

  it('an unknown actor pairing is denied by default rather than allowed by accident', () => {
    const alien = { ...parent(), kind: 'martian' as never };
    expect(authz.canOpenDirect(alien, parent('p2')).allowed).toBe(false);
  });
});

describe('BR-1 — permitted channels', () => {
  const authz = authzWithOnDuty();

  it('parent <-> admin 1:1 -> ALLOW when the admin is in charge of the family (PD-8)', () => {
    expect(authz.canOpenDirect(parent(), admin(), true).allowed).toBe(true);
  });

  it('parent <-> admin 1:1 -> REFUSED when the admin is not in charge of the family (PD-8 / BR-3)', () => {
    const d = authz.canOpenDirect(parent(), admin(), false);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('COMM.STAFF_OUT_OF_SCOPE');
  });

  it('teacher <-> admin 1:1 -> ALLOW', () => {
    expect(authz.canOpenDirect(teacher(), admin()).allowed).toBe(true);
  });

  it('coverage admin counts as family-facing', () => {
    expect(authz.canOpenDirect(parent(), admin('cov-1', 'coverage'), true).allowed).toBe(true);
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
    );
    expect(d.allowed).toBe(true);
  });
});

describe('BR-1 — the permitted case: teacher and parent inside the student group', () => {
  const authz = authzWithOnDuty();

  it('a teacher may post in the student group', async () => {
    const t = teacher();
    const d = await authz.canSend(t, studentGroup(), member(t), { visibility: 'customer' }, NOW);
    expect(d.allowed).toBe(true);
  });

  it('a parent may post in the student group', async () => {
    const p = parent();
    const d = await authz.canSend(p, studentGroup(), member(p), { visibility: 'customer' }, NOW);
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
    );
    expect(d.allowed).toBe(true);
  });

  it('a teacher who is not a member of the group cannot post in it', async () => {
    const d = await authz.canSend(teacher('outsider'), studentGroup(), null, { visibility: 'customer' }, NOW);
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
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.MEMBER_IS_SILENT);
  });
});

describe('BR-1 — membership management cannot be used to route around the rule', () => {
  const authz = authzWithOnDuty();

  it('BR1-07/08 a teacher may not change membership', () => {
    const d = authz.canManageMembership(teacher());
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
  });

  it('BR1-10 a parent may not change membership', () => {
    expect(authz.canManageMembership(parent()).allowed).toBe(false);
  });

  it('an admin may change membership', () => {
    expect(authz.canManageMembership(admin()).allowed).toBe(true);
    expect(authz.canManageMembership(manager()).allowed).toBe(true);
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
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.CONVERSATION_ARCHIVED);
  });
});
