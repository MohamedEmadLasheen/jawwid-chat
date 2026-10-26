/**
 * The communication matrix beyond BR-1: who may reply, in what capacity, and
 * PD-14 (nothing is held; who moderates after sending).
 */
import { CommErrorCode } from '@platform/errors';
import { StaffAccessBasis } from '@platform/staff-scope';
import {
  admin,
  authzWithOnDuty,
  authzWithScope,
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

describe('staff replies are gated on the PD-8 scope basis (on_duty() decides nothing)', () => {
  it("the children's supervisor replying is attributed OWNER", async () => {
    const a = admin('sup');
    const authz = authzWithScope({ sup: StaffAccessBasis.RESPONSIBLE });
    const d = await authz.canSend(a, conversation(), member(a), customer, NOW);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('owner');
  });

  it('an ACTIVE backup is attributed COVERAGE, not OWNER', async () => {
    const a = admin('bak', 'coverage');
    const authz = authzWithScope({ bak: StaffAccessBasis.BACKUP });
    const d = await authz.canSend(a, conversation(), null, customer, NOW);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('coverage');
  });

  it('an admin on_duty() names but with no basis may NOT reply -- the coverage engine grants nothing', async () => {
    const a = admin('admin-on-duty');
    const authz = authzWithScope();
    const d = await authz.canSend(a, conversation(), member(a), customer, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  });

  it('an in-scope admin may write an internal note; an out-of-scope one may not', async () => {
    const authz = authzWithScope({ sup: StaffAccessBasis.RESPONSIBLE });
    expect((await authz.canSend(admin('sup'), conversation(), null, internal, NOW)).allowed).toBe(true);
    expect((await authz.canSend(admin('x'), conversation(), member(admin('x')), internal, NOW)).allowed).toBe(false);
  });

  it('a department manager may act on their department', async () => {
    const authz = authzWithOnDuty('someone-else');
    const d = await authz.canSend(manager(), conversation(), null, customer, NOW);
    expect(d.allowed).toBe(true);
  });

  it('stickiness grants nothing: the admin who last replied keeps the conversation only while in scope', async () => {
    const a = admin('sticky-admin');
    const sticky = conversation({
      stickyHandlerId: 'sticky-admin',
      stickyUntil: new Date(NOW.getTime() + 5 * 60_000),
    });
    const out = await authzWithScope().canSend(a, sticky, member(a), customer, NOW);
    expect(out.allowed).toBe(false);
    const inScope = await authzWithScope({ 'sticky-admin': StaffAccessBasis.RESPONSIBLE }).canSend(a, sticky, member(a), customer, NOW);
    expect(inScope.allowed).toBe(true);
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

  it('assist and escalation FAIL CLOSED: a client-supplied mode never grants access or re-attributes', async () => {
    // Out of scope: refused whatever is asked.
    const outsider = admin('helper');
    const none = authzWithScope();
    expect((await none.canSend(outsider, conversation(), member(outsider), { ...customer, requestedMode: 'assist' }, NOW)).allowed).toBe(false);
    // In scope as the supervisor: the request is refused by name, never honoured.
    const a = admin('sup');
    const authz = authzWithScope({ sup: StaffAccessBasis.RESPONSIBLE });

    const assist = await authz.canSend(a, conversation(), member(a), { ...customer, requestedMode: 'assist' }, NOW);
    expect(assist.allowed).toBe(false);
    if (!assist.allowed) expect(assist.code).toBe(CommErrorCode.ASSIST_NOT_PERMITTED);

    const esc = await authz.canSend(a, conversation(), member(a), { ...customer, requestedMode: 'escalation' }, NOW);
    expect(esc.allowed).toBe(false);
    if (!esc.allowed) expect(esc.code).toBe(CommErrorCode.ESCALATION_NOT_PERMITTED);
  });

  it('a client cannot upgrade itself to owner by asking', async () => {
    const out = admin('off-duty');
    // owner/coverage are derived from the basis, never taken from the request.
    const d = await authzWithScope().canSend(out, conversation(), member(out), { ...customer, requestedMode: 'owner' }, NOW);
    expect(d.allowed).toBe(false);
    const bak = admin('bak', 'coverage');
    const asked = await authzWithScope({ bak: StaffAccessBasis.BACKUP }).canSend(bak, conversation(), null, { ...customer, requestedMode: 'owner' }, NOW);
    if (asked.allowed) expect(asked.onBehalfMode).toBe('coverage');
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

describe('PD-14: nothing is held for approval -- every message publishes on send', () => {
  const authz = authzWithOnDuty('admin-1');
  // The retired flags are set ON in every case: a stale row must not hold anything.
  const held = { teacherRequiresApproval: true, parentRequiresApproval: true };

  it('a teacher message in a group publishes, even on a group still flagged for approval', async () => {
    const t = teacher();
    const d = await authz.canSend(t, studentGroup(held), member(t), customer, NOW);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.moderation).toBe('published');
  });

  it('a parent message in a group publishes, even on a group still flagged for approval', async () => {
    const p = parent();
    const d = await authz.canSend(p, studentGroup(held), member(p), customer, NOW);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.moderation).toBe('published');
  });

  it('an admin message in a group publishes', async () => {
    const a = admin('admin-1');
    const d = await authz.canSend(a, studentGroup(held), member(a), customer, NOW);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.moderation).toBe('published');
  });

  it('a 1:1 parent message publishes', async () => {
    const p = parent();
    const d = await authz.canSend(p, conversation({ type: 'direct', ...held }), member(p), customer, NOW);
    if (d.allowed) expect(d.moderation).toBe('published');
  });
});

describe('PD-14: who may edit or delete a sent message they did not write', () => {
  const authz = authzWithOnDuty();
  const families = ['teacher', 'contact'];
  const everyone = ['teacher', 'contact', 'staff'];

  it("the children's supervisor, their active backup and the staff party of a 1:1 moderate teachers and parents", () => {
    expect(authz.moderatableAuthorKinds(admin('sup'), StaffAccessBasis.RESPONSIBLE)).toEqual(families);
    expect(authz.moderatableAuthorKinds(admin('bak', 'coverage'), StaffAccessBasis.BACKUP)).toEqual(families);
    expect(authz.moderatableAuthorKinds(admin('m'), StaffAccessBasis.MEMBER)).toEqual(families);
  });

  it('only a department manager or the super admin also moderates other staff', () => {
    expect(authz.moderatableAuthorKinds(manager(), StaffAccessBasis.MANAGER)).toEqual(everyone);
    expect(authz.moderatableAuthorKinds(admin('owner', 'super_admin'), StaffAccessBasis.SUPER_ADMIN)).toEqual(everyone);
    expect(authz.moderatableAuthorKinds(admin('sup'), StaffAccessBasis.RESPONSIBLE)).not.toContain('staff');
  });

  it('no basis on the conversation means no moderation -- the role alone is not enough', () => {
    expect(authz.moderatableAuthorKinds(manager(), null)).toEqual([]);
    expect(authz.moderatableAuthorKinds(admin('bystander'), null)).toEqual([]);
  });

  it('an inactive admin, or staff who never take part in conversations, moderate nothing', () => {
    expect(authz.moderatableAuthorKinds({ ...admin('gone'), isActive: false }, StaffAccessBasis.RESPONSIBLE)).toEqual([]);
    expect(authz.moderatableAuthorKinds(admin('fin', 'finance'), StaffAccessBasis.RESPONSIBLE)).toEqual([]);
  });

  it('a teacher or a parent never moderates', () => {
    expect(authz.moderatableAuthorKinds(teacher(), StaffAccessBasis.RESPONSIBLE)).toEqual([]);
    expect(authz.moderatableAuthorKinds(parent(), StaffAccessBasis.RESPONSIBLE)).toEqual([]);
  });

  it('system messages and cards are never moderated', () => {
    expect(authz.moderatableAuthorKinds(admin('owner', 'super_admin'), StaffAccessBasis.SUPER_ADMIN)).not.toContain('system');
  });

  it('PD-35: a seated person moderates nobody, decides no approval and changes no membership -- a seat is presence, not charge', () => {
    expect(authz.moderatableAuthorKinds(admin('seated'), StaffAccessBasis.SEATED)).toEqual([]);
    expect(authz.canApprove(admin('seated'), StaffAccessBasis.SEATED).allowed).toBe(false);
    expect(
      authz.canManageMembershipIn(admin('seated'), {
        type: 'student_group', organizationId: admin('seated').organizationId as string,
        actorBasis: StaffAccessBasis.SEATED, actorMemberRole: 'admin',
      }).allowed,
    ).toBe(false);
  });
});

/** Legacy: decides only messages held BEFORE PD-14; nothing new joins the queue. */
describe('who may decide an approval (PD-8: whoever is in charge of the group)', () => {
  const authz = authzWithOnDuty();

  it("the children's supervisor may decide", () => {
    expect(authz.canApprove(admin('handler'), StaffAccessBasis.RESPONSIBLE).allowed).toBe(true);
  });

  it('their ACTIVE backup and their department manager may decide', () => {
    expect(authz.canApprove(admin('bak', 'coverage'), StaffAccessBasis.BACKUP).allowed).toBe(true);
    expect(authz.canApprove(manager(), StaffAccessBasis.MANAGER).allowed).toBe(true);
  });

  it('an admin with no basis on the conversation may not decide', () => {
    const d = authz.canApprove(admin('bystander'), null);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.CANNOT_APPROVE);
  });

  it('a manager OUTSIDE the department may not decide: the role alone is not enough', () => {
    const d = authz.canApprove(manager(), null);
    expect(d.allowed).toBe(false);
  });

  it('the staff party of a 1:1 has nothing to decide (MEMBER is not a group basis)', () => {
    expect(authz.canApprove(admin('m'), StaffAccessBasis.MEMBER).allowed).toBe(false);
  });

  it('a teacher may never decide, even on their own message', () => {
    expect(authz.canApprove(teacher(), StaffAccessBasis.RESPONSIBLE).allowed).toBe(false);
  });

  it('a parent may never decide', () => {
    expect(authz.canApprove(parent(), StaffAccessBasis.RESPONSIBLE).allowed).toBe(false);
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
