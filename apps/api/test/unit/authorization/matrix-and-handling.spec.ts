/**
 * The communication matrix beyond BR-1: who may reply, in what capacity, and
 * what the approval policy holds.
 */
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

const NOW = new Date('2026-09-06T10:00:00Z');
const customer = { visibility: 'customer' };
const internal = { visibility: 'internal' };

describe('staff replies are gated on on_duty()', () => {
  it('the family owner replying on duty is attributed OWNER', async () => {
    const a = admin('admin-on-duty');
    const authz = authzWithOnDuty('admin-on-duty');
    const d = await authz.canSend(a, conversation(), member(a), customer, NOW, 'admin-on-duty');
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('owner');
  });

  it('a covering admin on duty is attributed COVERAGE, not OWNER', async () => {
    const a = admin('admin-on-duty');
    const authz = authzWithOnDuty('admin-on-duty');
    const d = await authz.canSend(a, conversation(), member(a), customer, NOW, 'a-different-owner');
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('coverage');
  });

  it('an off-duty admin may NOT reply to the customer', async () => {
    const a = admin('admin-off-duty');
    const authz = authzWithOnDuty('someone-else');
    const d = await authz.canSend(a, conversation(), member(a), customer, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_ON_DUTY);
  });

  it('an off-duty admin may still write an internal note on any family', async () => {
    const a = admin('admin-off-duty');
    const authz = authzWithOnDuty('someone-else');
    const d = await authz.canSend(a, conversation(), member(a), internal, NOW);
    expect(d.allowed).toBe(true);
  });

  it('a manager may act on anything', async () => {
    const authz = authzWithOnDuty('someone-else');
    const d = await authz.canSend(manager(), conversation(), null, customer, NOW);
    expect(d.allowed).toBe(true);
  });

  it('stickiness lets the admin who just replied keep the conversation past shift end', async () => {
    const a = admin('sticky-admin');
    const authz = authzWithOnDuty('now-someone-else');
    const d = await authz.canSend(
      a,
      conversation({
        stickyHandlerId: 'sticky-admin',
        stickyUntil: new Date(NOW.getTime() + 5 * 60_000),
      }),
      member(a),
      customer,
      NOW,
    );
    expect(d.allowed).toBe(true);
  });

  it('expired stickiness does not grant a reply', async () => {
    const a = admin('sticky-admin');
    const authz = authzWithOnDuty('now-someone-else');
    const d = await authz.canSend(
      a,
      conversation({
        stickyHandlerId: 'sticky-admin',
        stickyUntil: new Date(NOW.getTime() - 60_000),
      }),
      member(a),
      customer,
      NOW,
    );
    expect(d.allowed).toBe(false);
  });

  it('assist and escalation FAIL CLOSED: a client-supplied mode never grants access', async () => {
    // The real assist predicate depends on the attention / response-target
    // engines AI #1 owns. Until that grant exists, an off-duty admin asking to
    // "assist" is denied rather than admitted on their own say-so.
    const a = admin('helper');
    const authz = authzWithOnDuty('someone-else');

    const assist = await authz.canSend(a, conversation(), member(a), { ...customer, requestedMode: 'assist' }, NOW);
    expect(assist.allowed).toBe(false);
    if (!assist.allowed) expect(assist.code).toBe(CommErrorCode.ASSIST_NOT_PERMITTED);

    const esc = await authz.canSend(a, conversation(), member(a), { ...customer, requestedMode: 'escalation' }, NOW);
    expect(esc.allowed).toBe(false);
    if (!esc.allowed) expect(esc.code).toBe(CommErrorCode.ESCALATION_NOT_PERMITTED);
  });

  it('a client cannot upgrade itself to owner by asking', async () => {
    const a = admin('off-duty');
    const authz = authzWithOnDuty('someone-else');
    // owner/coverage are derived from on_duty(), never taken from the request.
    const d = await authz.canSend(a, conversation(), member(a), { ...customer, requestedMode: 'owner' }, NOW);
    expect(d.allowed).toBe(false);
  });
});

describe('contacts', () => {
  const authz = authzWithOnDuty();

  it('a contact without can_message cannot post', async () => {
    const p = { ...parent(), canMessage: false };
    const d = await authz.canSend(p, conversation(), member(p), customer, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.CONTACT_CANNOT_MESSAGE);
  });

  it('a contact can never write an internal note', async () => {
    const p = parent();
    const d = await authz.canSend(p, conversation(), member(p), internal, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.CONTACT_CANNOT_WRITE_INTERNAL);
  });

  it('an inactive actor is refused', async () => {
    const p = { ...parent(), isActive: false };
    const d = await authz.canSend(p, conversation(), member(p), customer, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('a teacher can never write an internal note', async () => {
    const t = teacher();
    const d = await authz.canSend(t, studentGroup(), member(t), internal, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.TEACHER_CANNOT_WRITE_INTERNAL);
  });
});

describe('group approval policy', () => {
  const authz = authzWithOnDuty('admin-1');

  it('a teacher message is held when teacher approval is on', async () => {
    const t = teacher();
    const d = await authz.canSend(t, studentGroup({ teacherRequiresApproval: true }), member(t), customer, NOW);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.moderation).toBe('pending');
  });

  it('a parent message is held when parent approval is on', async () => {
    const p = parent();
    const d = await authz.canSend(p, studentGroup({ parentRequiresApproval: true }), member(p), customer, NOW);
    if (d.allowed) expect(d.moderation).toBe('pending');
  });

  it('approval can be switched off per group', async () => {
    const t = teacher();
    const d = await authz.canSend(t, studentGroup({ teacherRequiresApproval: false }), member(t), customer, NOW);
    if (d.allowed) expect(d.moderation).toBe('published');
  });

  it('an admin message in a group is NEVER held', async () => {
    const a = admin('admin-1');
    const d = await authz.canSend(
      a,
      studentGroup({ teacherRequiresApproval: true, parentRequiresApproval: true }),
      member(a),
      customer,
      NOW,
    );
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.moderation).toBe('published');
  });

  it('a 1:1 parent message is never held: approval applies to groups only', async () => {
    const p = parent();
    const d = await authz.canSend(p, conversation({ type: 'direct' }), member(p), customer, NOW);
    if (d.allowed) expect(d.moderation).toBe('published');
  });
});

describe('who may decide an approval', () => {
  const authz = authzWithOnDuty();

  it('the active handler may decide', () => {
    expect(authz.canApprove(admin('handler'), 'handler').allowed).toBe(true);
  });

  it('an admin who is not the active handler may not decide', () => {
    const d = authz.canApprove(admin('bystander'), 'handler');
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.CANNOT_APPROVE);
  });

  it('a manager may always decide', () => {
    expect(authz.canApprove(manager(), 'someone-else').allowed).toBe(true);
  });

  it('a teacher may never decide, even on their own message', () => {
    expect(authz.canApprove(teacher(), 'teacher-1').allowed).toBe(false);
  });

  it('a parent may never decide', () => {
    expect(authz.canApprove(parent(), 'parent-1').allowed).toBe(false);
  });
});

describe('internal note visibility', () => {
  const authz = authzWithOnDuty();

  it('only family-facing staff may read internal notes', () => {
    expect(authz.canReadInternal(admin())).toBe(true);
    expect(authz.canReadInternal(manager())).toBe(true);
    expect(authz.canReadInternal(parent())).toBe(false);
    expect(authz.canReadInternal(teacher())).toBe(false);
  });
});
