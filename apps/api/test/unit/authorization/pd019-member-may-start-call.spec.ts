/**
 * PROTECTED (docs/qa/protected-tests.tsv) — product decision PD-19.
 *
 * PD-19, closed 2026-10-21 by the product owner, supersedes PD-2:
 *
 *   "Teachers, parents and supervisors can start calls in the chats they are
 *    authorized to participate in, while keeping the existing access rules for
 *    other chats unchanged."
 *
 *   member who may speak here + initiate = ALLOW   (parents included)
 *   everything canSend / BR-1 / C-4 refuses = still DENY, with its own code
 *
 * Under PD-2 a parent could join a group call but never start one, so the
 * parent's family group was the one chat of theirs with no call button. This
 * file now pins BOTH halves of PD-19: the parent is allowed to start, and the
 * limits it did not lift still hold. Weakening the second half would turn
 * "call in your own chats" into "call anywhere".
 *
 * Ordering is asserted as before: the BR-1 / C-4 constitutional checks run
 * first and report their own codes.
 */
import { CallIntent } from '@platform/authorization.service';
import type { LiveMember } from '@platform/authorization.service';
import { CommErrorCode } from '@platform/errors';
import {
  admin,
  authzWithOnDuty,
  conversation,
  member,
  parent,
  studentGroup,
  teacher,
} from '../../support/fixtures';

const NOW = new Date('2026-10-21T10:00:00Z');

const asMember = (actorKind: string, memberRole: string, isActive?: boolean): LiveMember => ({
  actorId: `${actorKind}-1`,
  actorKind,
  memberRole,
  ...(isActive === undefined ? {} : { isActive }),
});

/** A legitimate, BR-1 compliant Student Group: teacher, parent, live admin. */
const LIVE_GROUP: LiveMember[] = [
  asMember('teacher', 'teacher'),
  asMember('contact', 'parent'),
  asMember('staff', 'admin', true),
];

const PARTICIPANTS = [
  { kind: 'teacher' as const },
  { kind: 'contact' as const },
  { kind: 'staff' as const },
];

describe('PD-19 — a member may START a call in their own chat', () => {
  const authz = authzWithOnDuty();

  it('ALLOWS a parent starting a Student Group call in a compliant group', async () => {
    const p = parent();
    const d = await authz.canCall(
      p, studentGroup(), member(p), PARTICIPANTS, NOW, null, LIVE_GROUP, CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(true);
  });

  it('ALLOWS a parent starting a Class Group call', async () => {
    const p = parent();
    const d = await authz.canCall(
      p,
      conversation({ type: 'class_group' }),
      member(p),
      PARTICIPANTS,
      NOW,
      null,
      LIVE_GROUP,
      CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(true);
  });

  it('ALLOWS a parent starting a call in their family group', async () => {
    const p = parent();
    const d = await authz.canCall(
      p,
      conversation({ type: 'family_group' }),
      member(p),
      PARTICIPANTS,
      NOW,
      null,
      LIVE_GROUP,
      CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(true);
  });

  it('the default intent (start) is allowed too — no start-only rule remains', async () => {
    const p = parent();
    const d = await authz.canCall(p, studentGroup(), member(p), PARTICIPANTS, NOW, null, LIVE_GROUP);
    expect(d.allowed).toBe(true);
  });

  it('ALLOWS a parent JOINING the same call, as before', async () => {
    const p = parent();
    const d = await authz.canCall(
      p, studentGroup(), member(p), PARTICIPANTS, NOW, null, LIVE_GROUP, CallIntent.JOIN,
    );
    expect(d.allowed).toBe(true);
  });

  it('ALLOWS a teacher starting the group call', async () => {
    const t = teacher();
    const d = await authz.canCall(
      t, studentGroup(), member(t), PARTICIPANTS, NOW, null, LIVE_GROUP, CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(true);
  });

  it('ALLOWS an on-duty admin starting the group call', async () => {
    const a = admin();
    const onDuty = authzWithOnDuty(a.actorId);
    const d = await onDuty.canCall(
      a, studentGroup(), member(a), PARTICIPANTS, NOW, null, LIVE_GROUP, CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(true);
  });

  it('ALLOWS a parent 1:1 call to their handler, as before', async () => {
    const p = parent();
    const d = await authz.canCall(
      p,
      conversation({ type: 'direct', familyId: 'family-1' }),
      member(p),
      [{ kind: 'contact' as const }, { kind: 'staff' as const }],
      NOW,
      null,
      [asMember('contact', 'parent'), asMember('staff', 'admin', true)],
      CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(true);
  });

  // --- what PD-19 did NOT lift ---------------------------------------------

  it('C-4 still holds: no live admin in the group, no call — for the parent and the teacher', async () => {
    const noAdmin: LiveMember[] = [asMember('teacher', 'teacher'), asMember('contact', 'parent')];
    for (const who of [parent(), teacher()]) {
      const d = await authz.canCall(
        who, studentGroup(), member(who), PARTICIPANTS, NOW, null, noAdmin, CallIntent.INITIATE,
      );
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED);
    }
  });

  it('BR-1 / PD-7 still holds: no direct teacher<->parent call, from either side', async () => {
    for (const who of [parent(), teacher()]) {
      const d = await authz.canCall(
        who,
        conversation({ type: 'direct', familyId: 'family-1' }),
        member(who),
        [{ kind: 'contact' as const }, { kind: 'teacher' as const }],
        NOW,
        null,
        [asMember('contact', 'parent'), asMember('teacher', 'teacher')],
        CallIntent.INITIATE,
      );
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
    }
  });

  it('a parent who is NOT a member of the group may not start a call there', async () => {
    const p = parent();
    const d = await authz.canCall(
      p, studentGroup(), null, PARTICIPANTS, NOW, null, LIVE_GROUP, CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(false);
  });

  it('a silent parent member is still refused, by the membership rule', async () => {
    const p = parent();
    const d = await authz.canCall(
      p,
      studentGroup(),
      member(p, { isSilent: true }),
      PARTICIPANTS,
      NOW,
      null,
      LIVE_GROUP,
      CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.MEMBER_IS_SILENT);
  });
});
