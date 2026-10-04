/**
 * DEF-001 — an ordinary `admin` could not answer a teacher.
 *
 * A Teacher <-> Admin conversation is DIRECT and, by decision C-2, never
 * family-scoped. The staff branch of canSend had no path that could allow it:
 * `onDuty()` needs a familyId and the group branch needs a group, so every
 * customer-visible send fell through to NOT_ON_DUTY -- a teacher could ask Jawwid
 * a question and nobody holding the ordinary admin role could reply. Found by
 * manual QA against a live server, reproduced on two independent
 * freshly-migrated databases.
 *
 * Stickiness does not rescue it either, but for a subtler reason than "nothing
 * sets it": `MessageService.send` DOES make a replying staff member sticky. It
 * just cannot help the first reply, because there has been no staff reply yet to
 * create the stickiness. It matters afterwards, which is why the new branch is
 * decided before it -- see the attribution tests below.
 *
 * The fix makes SERVER-RESOLVED MEMBERSHIP the authority for that one shape. The
 * tests below are split deliberately: the first group proves the journey works,
 * and the second proves every boundary that membership must not be allowed to
 * widen. The second group is the point of the file.
 */
import { CommErrorCode } from '@platform/errors';
import {
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

const NOW = new Date('2026-10-01T10:00:00Z');
const customer = { visibility: 'customer' };
const internal = { visibility: 'internal' };

/** The Teacher <-> Admin shape: direct, and no family. */
const staffDirect = (over = {}) => conversation({ familyId: null, ...over });

describe('DEF-001 — a member admin may answer in a non-family-scoped direct channel', () => {
  it('an ordinary admin who IS a member may send to the customer', async () => {
    const a = admin('admin-1');
    // Nobody is on duty anywhere: the allow must come from membership, not from
    // a coverage answer that happens to match.
    const d = await authzWithOnDuty(null).canSend(a, staffDirect(), member(a), customer, NOW);
    expect(d.allowed).toBe(true);
  });

  it('is attributed OWNER, never ASSIST', async () => {
    const a = admin('admin-1');
    const d = await authzWithOnDuty(null).canSend(a, staffDirect(), member(a), customer, NOW);
    // ASSIST would be false -- the admin is the counterpart, not a stand-in --
    // and message.service writes a `message.assist` audit row for it, so a wrong
    // mode here would forge an assist event on every ordinary reply.
    if (d.allowed) expect(d.onBehalfMode).toBe('owner');
  });

  it('the teacher may send in the same conversation', async () => {
    const t = teacher('teacher-1');
    const d = await authzWithOnDuty(null).canSend(t, staffDirect(), member(t), customer, NOW);
    expect(d.allowed).toBe(true);
  });

  it('the teacher is not held for approval in a direct staff channel', async () => {
    const t = teacher('teacher-1');
    // teacherRequiresApproval is true on the fixture: moderation applies to
    // GROUPS, where a supervisor is the audience's guard, not to the teacher's
    // own 1:1 with Jawwid.
    const d = await authzWithOnDuty(null).canSend(
      t, staffDirect({ teacherRequiresApproval: true }), member(t), customer, NOW,
    );
    expect(d.allowed).toBe(true);
  });

  it('a manager still may, exactly as before', async () => {
    const m = manager('manager-1');
    const d = await authzWithOnDuty(null).canSend(m, staffDirect(), member(m), customer, NOW);
    expect(d.allowed).toBe(true);
  });

  it('stays OWNER once the sender has become the sticky handler', async () => {
    const a = admin('admin-1');
    // `MessageService.send` makes the replying staff member sticky for
    // handoff.grace_minutes, so from the second reply onwards this is the state
    // every further reply is evaluated in. The sticky branch would attribute it
    // through deriveMode, which with no family falls through to ASSIST and makes
    // MessageService write a `message.assist` audit row -- an assist that never
    // happened. The attribution must not change just because the admin replied
    // twice.
    const sticky = staffDirect({
      stickyHandlerId: 'admin-1',
      stickyUntil: new Date('2026-10-01T10:30:00Z'),
    });
    const d = await authzWithOnDuty(null).canSend(a, sticky, member(a), customer, NOW);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('owner');
  });

  it('a FAMILY-SCOPED sticky handler is still attributed through deriveMode', async () => {
    const a = admin('admin-1');
    // The relocation must not reach anything with a family: there, stickiness
    // keeps deciding, and the mode keeps coming from the owner/coverage facts.
    const sticky = conversation({
      familyId: 'family-1',
      stickyHandlerId: 'admin-1',
      stickyUntil: new Date('2026-10-01T10:30:00Z'),
    });
    const d = await authzWithOnDuty('admin-1').canSend(a, sticky, member(a), customer, NOW, 'admin-1');
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('owner'); // familyOwnerId match, via deriveMode
  });
});

describe('DEF-001 — the boundaries membership must not widen', () => {
  it('a NON-MEMBER admin who guessed the conversation id is refused', async () => {
    const a = admin('intruder');
    // This is the case `canRead` cannot catch: family-facing staff may READ any
    // conversation without membership, so the send check is the only thing
    // standing between a guessed id and a posted message.
    const d = await authzWithOnDuty(null).canSend(a, staffDirect(), null, customer, NOW);
    expect(d.allowed).toBe(false);
    // Named for what is actually wrong. NOT_ON_DUTY was the old message and was
    // misleading here: there is no duty roster on a conversation with no family.
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('a departed admin is NOT rescued by their own stale stickiness', async () => {
    const a = admin('admin-1');
    // The window this closes: MessageService made this admin sticky on their
    // earlier reply, then they were removed from the conversation. Falling
    // through to the sticky branch would allow them for handoff.grace_minutes on
    // nothing but that stale row.
    const sticky = staffDirect({
      stickyHandlerId: 'admin-1',
      stickyUntil: new Date('2026-10-01T10:30:00Z'),
    });
    const gone = member(a, { leftAt: new Date('2026-09-30T10:00:00Z') });
    const d = await authzWithOnDuty(null).canSend(a, sticky, gone, customer, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('a non-member is not rescued by stale stickiness either', async () => {
    const a = admin('admin-1');
    const sticky = staffDirect({
      stickyHandlerId: 'admin-1',
      stickyUntil: new Date('2026-10-01T10:30:00Z'),
    });
    const d = await authzWithOnDuty(null).canSend(a, sticky, null, customer, NOW);
    expect(d.allowed).toBe(false);
  });

  it('a DEPARTED admin cannot keep sending on a stale client view', async () => {
    const a = admin('admin-1');
    const gone = member(a, { leftAt: new Date('2026-09-30T10:00:00Z') });
    const d = await authzWithOnDuty(null).canSend(a, staffDirect(), gone, customer, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('a teacher is still refused a conversation they do not belong to', async () => {
    const t = teacher('outsider');
    const d = await authzWithOnDuty(null).canSend(t, staffDirect(), null, customer, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('a non-family-facing staff role gains nothing from membership', async () => {
    const f = financeStaff('finance-1');
    // Finance may never take part in family communication. Being a member row in
    // a conversation must not become a way around that.
    const d = await authzWithOnDuty(null).canSend(f, staffDirect(), member(f), customer, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY);
  });

  it('a FAMILY-SCOPED direct conversation still requires on duty', async () => {
    const a = admin('admin-off-duty');
    // The whole point of the new branch is that it cannot reach anything with a
    // family. Membership here is real and still must not be enough.
    const d = await authzWithOnDuty('someone-else').canSend(
      a, conversation({ familyId: 'family-1' }), member(a), customer, NOW, 'a-different-owner',
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_ON_DUTY);
  });

  it('the on-duty admin in a family conversation is still COVERAGE, not OWNER', async () => {
    const a = admin('admin-on-duty');
    const d = await authzWithOnDuty('admin-on-duty').canSend(
      a, conversation({ familyId: 'family-1' }), member(a), customer, NOW, 'a-different-owner',
    );
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('coverage');
  });

  it('a GROUP with no family is still decided by the group branch', async () => {
    const a = admin('admin-1');
    // studentGroup with familyId null hits `else if (isGroup)` first, which
    // allows regardless of membership. The new branch must not change that, and
    // must not start requiring membership there.
    const d = await authzWithOnDuty(null).canSend(a, studentGroup({ familyId: null }), null, customer, NOW);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('owner');
  });

  it('internal notes keep their own rule, above this branch', async () => {
    const a = admin('admin-off-duty');
    const d = await authzWithOnDuty('someone-else').canSend(
      a, conversation({ familyId: 'family-1' }), member(a), internal, NOW,
    );
    expect(d.allowed).toBe(true);
  });

  it('a parent gains nothing: a contact is never in a staff direct channel', async () => {
    const p = parent('parent-1');
    const d = await authzWithOnDuty(null).canSend(p, staffDirect(), member(p), internal, NOW);
    // The contact branch refuses internal visibility outright, well before this.
    expect(d.allowed).toBe(false);
  });

  it('an inactive admin is refused even as a member', async () => {
    const a = { ...admin('admin-1'), isActive: false };
    const d = await authzWithOnDuty(null).canSend(a, staffDirect(), member(a), customer, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });
});

/**
 * JC-005 / JC-011 — the historical failure mode this branch must not reopen.
 *
 * JC-005 was `canSend` granting ASSIST / ESCALATION because the CLIENT asked for
 * it in `intent.requestedMode`. The new branch reads nothing the caller sent: its
 * inputs are the conversation row and the server's own membership row, and it
 * returns a fixed OWNER rather than anything derived from the request. These
 * tests state that as an executable claim rather than a comment.
 */
describe('DEF-001 does not reopen JC-005', () => {
  it('no value of requestedMode grants a NON-MEMBER admin access', async () => {
    const a = admin('intruder');
    for (const mode of ['owner', 'coverage', 'assist', 'escalation']) {
      const d = await authzWithOnDuty(null).canSend(
        a, staffDirect(), null, { ...customer, requestedMode: mode }, NOW,
      );
      expect({ mode, allowed: d.allowed }).toEqual({ mode, allowed: false });
    }
  });

  it('a requested mode cannot change the attribution of a member admin', async () => {
    const a = admin('admin-1');
    for (const mode of ['assist', 'escalation', 'coverage']) {
      const d = await authzWithOnDuty(null).canSend(
        a, staffDirect(), member(a), { ...customer, requestedMode: mode }, NOW,
      );
      expect(d.allowed).toBe(true);
      // Still OWNER. The client asked for something else and was ignored.
      if (d.allowed) expect(d.onBehalfMode).toBe('owner');
    }
  });

  it('the family-scoped ASSIST and ESCALATION refusals are unchanged', async () => {
    const a = admin('intruder');
    const fam = conversation({ familyId: 'family-1' });
    const assist = await authzWithOnDuty('someone-else').canSend(
      a, fam, null, { ...customer, requestedMode: 'assist' }, NOW, 'owner-1',
    );
    expect(assist.allowed).toBe(false);
    if (!assist.allowed) expect(assist.code).toBe(CommErrorCode.ASSIST_NOT_PERMITTED);
    const esc = await authzWithOnDuty('someone-else').canSend(
      a, fam, null, { ...customer, requestedMode: 'escalation' }, NOW, 'owner-1',
    );
    expect(esc.allowed).toBe(false);
    if (!esc.allowed) expect(esc.code).toBe(CommErrorCode.ESCALATION_NOT_PERMITTED);
  });
});
