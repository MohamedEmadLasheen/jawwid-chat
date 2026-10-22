/**
 * PD-19 second amendment (2026-10-22): which conversations' calls are GROUP
 * calls, and so where the super admin may take a seat without membership.
 *
 * The integration half (call-staff-group-chats.spec.ts) proves the database
 * accepts these calls; this file pins the pure rule, and that C-4's set did not
 * grow with it.
 */
import { CommErrorCode } from '@platform/errors';
import {
  ConversationType,
  GROUP_CALL_CONVERSATION_TYPES,
  GROUP_CONVERSATION_TYPES,
} from '@communication/contracts/vocab';
import { admin, authzWithOnDuty, manager, teacher } from '../../support/fixtures';

const authz = authzWithOnDuty();
const superAdmin = admin('super-1', 'super_admin');
const others = [{ actorId: 'teacher-1' }, { actorId: 'admin-1' }, { actorId: 'manager-9' }];

describe('GROUP_CALL_CONVERSATION_TYPES', () => {
  it('is the family-facing groups plus the trial group and the supervision conversation -- nothing else', () => {
    expect([...GROUP_CALL_CONVERSATION_TYPES].sort()).toEqual(
      [
        ConversationType.STUDENT_GROUP,
        ConversationType.CLASS_GROUP,
        ConversationType.FAMILY_GROUP,
        ConversationType.TRIAL_GROUP,
        ConversationType.TEACHER_SUPERVISION,
      ].sort(),
    );
  });

  it('did not widen C-4: admin presence is still keyed on the family-facing groups only', () => {
    expect([...GROUP_CONVERSATION_TYPES].sort()).toEqual(
      [ConversationType.STUDENT_GROUP, ConversationType.CLASS_GROUP, ConversationType.FAMILY_GROUP].sort(),
    );
  });
});

describe('canStartCallAsParticipant -- the super admin seat', () => {
  it.each([ConversationType.TRIAL_GROUP, ConversationType.TEACHER_SUPERVISION, ConversationType.STUDENT_GROUP])(
    'ALLOWS the super admin in %s without being a participant',
    (type) => {
      expect(authz.canStartCallAsParticipant(superAdmin, others, { type }).allowed).toBe(true);
    },
  );

  it('still REFUSES the super admin a direct call between two other people', () => {
    const d = authz.canStartCallAsParticipant(superAdmin, others.slice(0, 2), { type: ConversationType.DIRECT });
    expect(d).toEqual(expect.objectContaining({ allowed: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER }));
  });

  it.each([ConversationType.TRIAL_GROUP, ConversationType.TEACHER_SUPERVISION])(
    'REFUSES a manager or a teacher who is not a participant of %s',
    (type) => {
      for (const actor of [manager('manager-2'), teacher('teacher-2')]) {
        const d = authz.canStartCallAsParticipant(actor, others, { type });
        expect(d).toEqual(expect.objectContaining({ allowed: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER }));
      }
    },
  );
});
