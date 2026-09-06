/**
 * BR-1 required admin presence, at OPERATION TIME.
 *
 * Product decision C-4 (2026-09-06):
 *   "Admin presence is required BOTH when posting a Student Group message and
 *    when initiating/accepting a Student Group call. The invariant must be
 *    evaluated at operation time. A group containing Teacher + Parent without
 *    an authorized Admin present must NOT permit the prohibited interaction."
 *
 * PRD BR-1: "Teachers and parents communicate only inside the official Student
 * Group, WHERE THE ASSIGNED ADMIN/SUPERVISOR IS A MEMBER."
 *
 * Red team RT-025 proved this was unenforced. The database backstop added in
 * 20260905093300 constrains COMMITTED MEMBERSHIP STATE; these tests cover the
 * half it cannot: a membership row survives an account being deactivated, so
 * "an admin is a member" and "an admin is present" are different statements.
 *
 * Both paths are tested, because C-4 requires both and because a rule enforced
 * for chat and forgotten for calls is how BR-1 gets bypassed.
 */
import { CommErrorCode } from '@platform/errors';
import type { LiveMember } from '@platform/authorization.service';
import { admin, authzWithOnDuty, member, parent, studentGroup, teacher } from '../../support/fixtures';

const NOW = new Date('2026-09-06T10:00:00Z');

const asMember = (actorKind: string, memberRole: string, isActive?: boolean): LiveMember => ({
  actorId: `${actorKind}-1`,
  actorKind,
  memberRole,
  ...(isActive === undefined ? {} : { isActive }),
});

const TEACHER_AND_PARENT: LiveMember[] = [
  asMember('teacher', 'teacher'),
  asMember('contact', 'parent'),
];
const WITH_LIVE_ADMIN: LiveMember[] = [...TEACHER_AND_PARENT, asMember('staff', 'admin', true)];
const WITH_DEACTIVATED_ADMIN: LiveMember[] = [
  ...TEACHER_AND_PARENT,
  asMember('staff', 'admin', false),
];

describe('C-4 — required admin presence on the MESSAGE path', () => {
  const authz = authzWithOnDuty();

  it('denies a teacher posting into a teacher+parent group with no admin member', async () => {
    const t = teacher();
    const d = await authz.canSend(
      t, studentGroup(), member(t), { visibility: 'customer' }, NOW, null,
      ['teacher', 'contact'], TEACHER_AND_PARENT,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED);
  });

  it('denies a parent posting into the same group', async () => {
    const p = parent();
    const d = await authz.canSend(
      p, studentGroup(), member(p), { visibility: 'customer' }, NOW, null,
      ['teacher', 'contact'], TEACHER_AND_PARENT,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED);
  });

  it('DENIES when the only admin member is deactivated — the row exists, the admin does not', async () => {
    const t = teacher();
    const d = await authz.canSend(
      t, studentGroup(), member(t), { visibility: 'customer' }, NOW, null,
      ['teacher', 'contact'], WITH_DEACTIVATED_ADMIN,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED);
  });

  it('fails CLOSED when live membership cannot be established', async () => {
    const t = teacher();
    const d = await authz.canSend(
      t, studentGroup(), member(t), { visibility: 'customer' }, NOW, null,
      ['teacher', 'contact'], [],
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED);
  });

  it('ALLOWS the teacher when a live admin is present — the permitted channel still works', async () => {
    const t = teacher();
    const d = await authz.canSend(
      t, studentGroup(), member(t), { visibility: 'customer' }, NOW, null,
      ['teacher', 'contact'], WITH_LIVE_ADMIN,
    );
    expect(d.allowed).toBe(true);
  });

  it('ALLOWS the parent when a live admin is present', async () => {
    const p = parent();
    const d = await authz.canSend(
      p, studentGroup(), member(p), { visibility: 'customer' }, NOW, null,
      ['teacher', 'contact'], WITH_LIVE_ADMIN,
    );
    expect(d.allowed).toBe(true);
  });

  it('does not fire on a group with no teacher: a parent-only group is not the prohibited pairing', async () => {
    const p = parent();
    const d = await authz.canSend(
      p, studentGroup(), member(p), { visibility: 'customer' }, NOW, null,
      ['contact'], [asMember('contact', 'parent')],
    );
    expect(d.allowed).toBe(true);
  });

  it('still lets an ON-DUTY admin post into an adminless group, so it can be repaired', async () => {
    // The admin-presence rule targets the prohibited interaction -- teacher and
    // parent talking without Jawwid present. Staff are not that interaction, so
    // the rule must not lock the only people who can fix the group out of it.
    // Ordinary on-duty authorization still applies, which is why this uses an
    // authz whose on_duty() actually returns this admin.
    const a = admin('admin-on-duty');
    const onDutyAuthz = authzWithOnDuty('admin-on-duty');
    const d = await onDutyAuthz.canSend(
      a, studentGroup(), member(a), { visibility: 'customer' }, NOW, null,
      ['teacher', 'contact'], TEACHER_AND_PARENT,
    );
    expect(d.allowed).toBe(true);
  });
});

describe('C-4 — required admin presence on the CALL path', () => {
  const authz = authzWithOnDuty();
  const participants = [{ kind: 'teacher' as const }, { kind: 'contact' as const }];

  it('denies a teacher starting a group call with no admin present', async () => {
    const t = teacher();
    const d = await authz.canCall(
      t, studentGroup(), member(t), participants, NOW, null, TEACHER_AND_PARENT,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED);
  });

  it('denies a parent joining that call', async () => {
    const p = parent();
    const d = await authz.canCall(
      p, studentGroup(), member(p), participants, NOW, null, TEACHER_AND_PARENT,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED);
  });

  it('denies when the only admin member is deactivated', async () => {
    const t = teacher();
    const d = await authz.canCall(
      t, studentGroup(), member(t), participants, NOW, null, WITH_DEACTIVATED_ADMIN,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED);
  });

  it('fails CLOSED when live membership cannot be established', async () => {
    const t = teacher();
    const d = await authz.canCall(
      t, studentGroup(), member(t), participants, NOW, null, [],
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED);
  });

  it('ALLOWS the group call when a live admin is present — PRD §9 official channel', async () => {
    const t = teacher();
    const d = await authz.canCall(
      t, studentGroup(), member(t), participants, NOW, null, WITH_LIVE_ADMIN,
    );
    expect(d.allowed).toBe(true);
  });

  it('calling is never more permissive than messaging: same inputs, same verdict', async () => {
    const t = teacher();
    const send = await authz.canSend(
      t, studentGroup(), member(t), { visibility: 'customer' }, NOW, null,
      ['teacher', 'contact'], TEACHER_AND_PARENT,
    );
    const call = await authz.canCall(
      t, studentGroup(), member(t), participants, NOW, null, TEACHER_AND_PARENT,
    );
    expect(call.allowed).toBe(send.allowed);
  });
});
