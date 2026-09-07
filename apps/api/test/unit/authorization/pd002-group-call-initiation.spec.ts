/**
 * PROTECTED (docs/qa/protected-tests.tsv) — product decision PD-2.
 *
 * PD-2, closed 2026-09-07 by the product owner:
 *
 *   "Parents MAY JOIN Student Group calls, but parents MAY NOT INITIATE
 *    Student Group calls. Student Group calls may be initiated by: Teacher,
 *    Admin / authorized staff."
 *
 *   parent + student_group_call + initiate = DENY
 *   parent + student_group_call + join     = ALLOW, subject to normal
 *                                            membership/authorization rules
 *
 * PRD section 9 is the product basis: the group call row reads
 * "Group call | Teacher, admin (parent by policy) | Members of the Student
 * Group | The official Teacher <-> Parent call channel", and section 7.3 says
 * "Group calls are started from the group by teachers or admins; parents can
 * join and, if policy allows, start one." The policy is now fixed: they may
 * not.
 *
 * WHY THIS FILE IS PROTECTED. Before PD-2 was closed, `canCall` delegated to
 * `canSend` and then added only the BR-1 direct-conversation denial, so a
 * parent member of a Student Group with a live admin present was ALLOWED to
 * start a group call, and no test covered either direction. The permissive
 * behaviour was live and undocumented. Deleting or weakening this file
 * restores that state silently.
 *
 * Ordering matters and is asserted: the BR-1 / C-4 constitutional checks run
 * FIRST, so a violation of those always reports its own code rather than this
 * policy one.
 */
import { CallIntent } from '@platform/authorization.service';
import type { LiveMember } from '@platform/authorization.service';
import { CommErrorCode } from '@platform/errors';
import {
  admin,
  authzWithOnDuty,
  conversation,
  manager,
  member,
  parent,
  studentGroup,
  teacher,
} from '../../support/fixtures';

const NOW = new Date('2026-09-07T10:00:00Z');

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

describe('PD-2 — who may START a Student Group call', () => {
  const authz = authzWithOnDuty();

  it('DENIES a parent starting a Student Group call, even in a fully compliant group', async () => {
    const p = parent();
    const d = await authz.canCall(
      p, studentGroup(), member(p), PARTICIPANTS, NOW, null, LIVE_GROUP, CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.PARENT_CANNOT_START_GROUP_CALL);
  });

  it('DENIES a parent starting a Class Group call', async () => {
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
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.PARENT_CANNOT_START_GROUP_CALL);
  });

  it('DENIES by default when the caller does not state an intent — the strict default', async () => {
    // A future call site that forgets the argument must be refused, not allowed.
    const p = parent();
    const d = await authz.canCall(
      p, studentGroup(), member(p), PARTICIPANTS, NOW, null, LIVE_GROUP,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.PARENT_CANNOT_START_GROUP_CALL);
  });

  it('ALLOWS a parent JOINING the same call', async () => {
    const p = parent();
    const d = await authz.canCall(
      p, studentGroup(), member(p), PARTICIPANTS, NOW, null, LIVE_GROUP, CallIntent.JOIN,
    );
    expect(d.allowed).toBe(true);
  });

  it('ALLOWS a teacher starting the group call — PRD section 9 official channel', async () => {
    const t = teacher();
    const d = await authz.canCall(
      t, studentGroup(), member(t), PARTICIPANTS, NOW, null, LIVE_GROUP, CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(true);
  });

  it('ALLOWS an on-duty admin starting the group call', async () => {
    // The duty rule is pre-existing and unrelated to PD-2: a staff member who
    // is neither the family owner nor on duty is already refused by canSend
    // with NOT_ON_DUTY. The legitimate case is the on-duty admin.
    const a = admin();
    const onDuty = authzWithOnDuty(a.actorId);
    const d = await onDuty.canCall(
      a, studentGroup(), member(a), PARTICIPANTS, NOW, null, LIVE_GROUP, CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(true);
  });

  it('ALLOWS a manager starting the group call', async () => {
    const m = manager();
    const d = await authz.canCall(
      m, studentGroup(), member(m), PARTICIPANTS, NOW, null, LIVE_GROUP, CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(true);
  });

  it('does NOT touch the parent 1:1 call to their handler (PRD section 9)', async () => {
    // "1:1 call | Parent | Parent <-> Admin (their handler) | Allowed".
    // PD-2 is scoped to group conversations and must not narrow this.
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

  it('BR-1 still wins: a parent starting a group call with no live admin reports the BR-1 code', async () => {
    // C-4 runs first, so the constitutional violation is reported, not PD-2.
    const p = parent();
    const noAdmin: LiveMember[] = [asMember('teacher', 'teacher'), asMember('contact', 'parent')];
    const d = await authz.canCall(
      p, studentGroup(), member(p), PARTICIPANTS, NOW, null, noAdmin, CallIntent.INITIATE,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED);
  });

  it('a silent parent member is still refused, and by the membership rule first', async () => {
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
