/**
 * BR-1 conformance matrix (QA release gate G-01).
 *
 * RE-VERSIONED 2026-09-23 BY PD-6. The rule this file asserts changed:
 *
 *   WAS  Teacher <-> Parent direct 1:1 communication is FORBIDDEN, for
 *        messaging and calling alike.
 *
 *   NOW  Teacher <-> Parent direct 1:1 communication is ALLOWED for an
 *        AUTHORIZED relationship, and forbidden for every other pairing.
 *
 * Nothing was deleted to make the new rule pass. Each former DENY became a
 * PAIR -- unauthorized denies, authorized allows -- because a test that only
 * proved "allowed" would no longer be testing a boundary at all. The denial
 * code moved from BR1_TEACHER_PARENT_DIRECT to TEACHER_PARENT_NOT_AUTHORIZED;
 * the old code is asserted to be unreachable rather than removed.
 *
 * The relationship arrives as a RESOLVED FACT -- the last argument to each
 * decision -- because AuthorizationService must not read a database. Which is
 * why these remain pure unit tests with no server behind them.
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

/** The resolved relationship fact, named so each call site reads as English. */
const AUTHORIZED = true;
const UNAUTHORIZED = false;

describe('PD-6 — the direct teacher/parent channel is decided by the RELATIONSHIP', () => {
  const authz = authzWithOnDuty();

  it('BR1-01 teacher opens a 1:1 with an UNAUTHORIZED parent -> DENY', () => {
    const d = authz.canOpenDirect(teacher(), parent(), UNAUTHORIZED);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED);
  });

  it('BR1-01b teacher opens a 1:1 with an AUTHORIZED parent -> ALLOW', () => {
    const d = authz.canOpenDirect(teacher(), parent(), AUTHORIZED);
    expect(d.allowed).toBe(true);
  });

  it('BR1-02 parent opens a 1:1 with an UNAUTHORIZED teacher -> DENY (order does not matter)', () => {
    const d = authz.canOpenDirect(parent(), teacher(), UNAUTHORIZED);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED);
  });

  it('BR1-02b parent opens a 1:1 with an AUTHORIZED teacher -> ALLOW (order does not matter)', () => {
    const d = authz.canOpenDirect(parent(), teacher(), AUTHORIZED);
    expect(d.allowed).toBe(true);
  });

  it('the relationship defaults to UNAUTHORIZED: a caller that does not state it is denied', () => {
    // Fail closed. A call site that forgets to resolve the relationship keeps
    // the pre-PD-6 behaviour instead of opening a channel by omission.
    const d = authz.canOpenDirect(teacher(), parent());
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED);
  });

  it('BR1-03 teacher sends into a direct conversation with an UNAUTHORIZED parent -> DENY', async () => {
    const t = teacher();
    const d = await authz.canSend(
      t,
      conversation({ type: 'direct' }),
      member(t),
      { visibility: 'customer' },
      NOW,
      null,
      // The participant set is what the rule is decided on: a contact is present.
      ['teacher', 'contact'],
      [],
      UNAUTHORIZED,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED);
  });

  it('BR1-03b teacher sends into a direct conversation with an AUTHORIZED parent -> ALLOW', async () => {
    const t = teacher();
    const d = await authz.canSend(
      t,
      conversation({ type: 'direct' }),
      member(t),
      { visibility: 'customer' },
      NOW,
      null,
      ['teacher', 'contact'],
      [],
      AUTHORIZED,
    );
    expect(d.allowed).toBe(true);
    // PD-6: no admin approval on the direct channel. It publishes immediately,
    // exactly as every other authorized direct channel does (BR-6).
    if (d.allowed) expect(d.moderation).toBe('published');
  });

  it('PD-6: the PARENT\'s side is checked too — an unauthorized parent cannot send either', async () => {
    // Before PD-6 only the teacher branch carried this check, because the
    // channel could not exist and a parent could never be in one. Now it can,
    // and a revoked relationship must close BOTH directions, not half of them.
    const p = parent();
    const d = await authz.canSend(
      p,
      conversation({ type: 'direct' }),
      member(p),
      { visibility: 'customer' },
      NOW,
      null,
      ['teacher', 'contact'],
      [],
      UNAUTHORIZED,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED);
  });

  it('PD-6: the parent may send when the relationship IS authorized', async () => {
    const p = parent();
    const d = await authz.canSend(
      p,
      conversation({ type: 'direct' }),
      member(p),
      { visibility: 'customer' },
      NOW,
      null,
      ['teacher', 'contact'],
      [],
      AUTHORIZED,
    );
    expect(d.allowed).toBe(true);
  });

  it('BR1-04/05 a direct call pairing a teacher and an UNAUTHORIZED parent -> DENY', async () => {
    const t = teacher();
    const d = await authz.canCall(
      t,
      conversation({ type: 'direct' }),
      member(t),
      [teacher(), parent()],
      NOW,
      null,
      [],
      undefined,
      UNAUTHORIZED,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED);
  });

  it('BR1-04b a direct call pairing a teacher and an AUTHORIZED parent -> ALLOW', async () => {
    const t = teacher();
    const d = await authz.canCall(
      t,
      conversation({ type: 'direct' }),
      member(t),
      [teacher(), parent()],
      NOW,
      null,
      [],
      undefined,
      AUTHORIZED,
    );
    expect(d.allowed).toBe(true);
  });

  it('BR1-04c the parent may place the call too — PD-6 is symmetric', async () => {
    const p = parent();
    const d = await authz.canCall(
      p,
      conversation({ type: 'direct' }),
      member(p),
      [teacher(), parent()],
      NOW,
      null,
      [],
      undefined,
      AUTHORIZED,
    );
    expect(d.allowed).toBe(true);
  });

  it('calling is never more permissive than messaging: same relationship, same verdict', async () => {
    const t = teacher();
    const conv = conversation({ type: 'direct' });
    for (const pairing of [AUTHORIZED, UNAUTHORIZED]) {
      const send = await authz.canSend(
        t, conv, member(t), { visibility: 'customer' }, NOW, null,
        ['teacher', 'contact'], [], pairing,
      );
      const call = await authz.canCall(
        t, conv, member(t), [teacher(), parent()], NOW, null, [], undefined, pairing,
      );
      expect({ pairing, call: call.allowed }).toEqual({ pairing, call: send.allowed });
    }
  });

  it('the deprecated BR1_TEACHER_PARENT_DIRECT code is no longer emitted by any decision', async () => {
    // PD-6 keeps the constant for shipped clients that treat it as terminal,
    // but nothing in the policy may still raise it.
    const decisions = [
      authz.canOpenDirect(teacher(), parent(), UNAUTHORIZED),
      authz.canOpenDirect(parent(), teacher(), UNAUTHORIZED),
      await authz.canSend(
        teacher(), conversation({ type: 'direct' }), member(teacher()),
        { visibility: 'customer' }, NOW, null, ['teacher', 'contact'], [], UNAUTHORIZED,
      ),
      await authz.canCall(
        teacher(), conversation({ type: 'direct' }), member(teacher()),
        [teacher(), parent()], NOW, null, [], undefined, UNAUTHORIZED,
      ),
    ];
    for (const d of decisions) {
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).not.toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
    }
  });

  it('BR1-06 group co-members get no direct channel from group membership alone', () => {
    // Sharing a student group is not a relationship. Only the learner link is.
    const d = authz.canOpenDirect(teacher('teacher-in-group'), parent('parent-in-group'), UNAUTHORIZED);
    expect(d.allowed).toBe(false);
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

  it('parent <-> admin 1:1 -> ALLOW', () => {
    expect(authz.canOpenDirect(parent(), admin()).allowed).toBe(true);
  });

  it('teacher <-> admin 1:1 -> ALLOW', () => {
    expect(authz.canOpenDirect(teacher(), admin()).allowed).toBe(true);
  });

  it('coverage admin counts as family-facing', () => {
    expect(authz.canOpenDirect(parent(), admin('cov-1', 'coverage')).allowed).toBe(true);
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
