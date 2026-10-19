/**
 * RED TEAM — adversarial probes against the centralized authorization contract.
 *
 * These were CONFIRMED findings against the previous thread-based engine
 * (RT-002, RT-003, RT-004 in docs/red-team/findings.md). The conversation model
 * and the derived-attribution change fixed them, so each assertion is now
 * inverted: it asserts the SECURE behaviour, and will fail loudly if the
 * vulnerability is ever reintroduced.
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
const OWNER = 'owner-admin';

describe('RT-003 (fixed) · on_behalf_mode cannot be asserted by the client', () => {
  it('a manager who owns nothing cannot stamp a message as OWNER', async () => {
    const authz = authzWithOnDuty(null);
    const d = await authz.canSend(
      manager(),
      conversation(),
      null,
      { ...customer, requestedMode: 'owner' },
      NOW,
      OWNER, // the real owner is somebody else
    );
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).not.toBe('owner');
  });

  it('the real owner is attributed as OWNER without asking', async () => {
    const authz = authzWithOnDuty(OWNER);
    const owner = admin(OWNER);
    const d = await authz.canSend(owner, conversation(), member(owner), customer, NOW, OWNER);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('owner');
  });

  it('an ACTIVE backup who is not the supervisor is attributed COVERAGE, not OWNER (PD-8)', async () => {
    const cov = admin('coverage-admin', 'coverage');
    const authz = authzWithScope({ 'coverage-admin': StaffAccessBasis.BACKUP });
    const d = await authz.canSend(cov, conversation(), member(cov), { ...customer, requestedMode: 'owner' }, NOW, OWNER);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('coverage');
  });

  it('a manager asking for every mode never receives OWNER or COVERAGE falsely', async () => {
    const authz = authzWithOnDuty(null);
    for (const requested of ['owner', 'coverage', 'assist', 'escalation']) {
      const d = await authz.canSend(
        manager(),
        conversation(),
        null,
        { ...customer, requestedMode: requested },
        NOW,
        OWNER,
      );
      expect(d.allowed).toBe(true);
      if (d.allowed) expect(['assist', 'escalation']).toContain(d.onBehalfMode);
    }
  });
});

describe('RT-004 (fixed) · COVERAGE is never asserted without a coverage assignment', () => {
  it('an internal note by a department manager is attributed ASSIST, not COVERAGE (PD-8)', async () => {
    const m = manager('manager-x');
    const authz = authzWithScope({ 'manager-x': StaffAccessBasis.MANAGER });
    const d = await authz.canSend(m, conversation(), null, { ...internal, requestedMode: 'coverage' }, NOW, OWNER);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('assist');
  });

  it('a membership row without a basis writes nothing, not even a note', async () => {
    const a = admin('bystander');
    const d = await authzWithScope().canSend(a, conversation(), member(a), internal, NOW, OWNER);
    expect(d.allowed).toBe(false);
  });

  it('an internal note by the owner is attributed OWNER', async () => {
    const authz = authzWithOnDuty(null);
    const owner = admin(OWNER);
    const d = await authz.canSend(owner, conversation(), member(owner), internal, NOW, OWNER);
    if (d.allowed) expect(d.onBehalfMode).toBe('owner');
  });
});

describe('RT-002 (fixed) · authorization is a function of the participant set, not familyId alone', () => {
  const authz = authzWithOnDuty();

  it('a teacher cannot read a group they are not a member of', () => {
    const d = authz.canRead(teacher('outsider'), studentGroup(), null);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('a parent cannot read a group they are not a member of', () => {
    expect(authz.canRead(parent('other-parent'), studentGroup(), null).allowed).toBe(false);
  });

  it('membership, not family, is what admits a teacher', () => {
    const t = teacher();
    expect(authz.canRead(t, studentGroup(), member(t)).allowed).toBe(true);
  });

  it('a departed member loses read access', () => {
    const t = teacher();
    const d = authz.canRead(t, studentGroup(), member(t, { leftAt: NOW }));
    expect(d.allowed).toBe(false);
  });

  it('control: staff open what is in their charge -- a manager too, and only through the resolved basis (PD-8)', () => {
    // The scope is a server-resolved fact; without it a non-member admin is
    // refused, with it they are admitted. A manager's role alone no longer
    // opens the whole organization: they read their department.
    expect(authz.canRead(admin(), studentGroup(), null, true).allowed).toBe(true);
    expect(authz.canRead(manager(), studentGroup(), null, true).allowed).toBe(true);
    expect(authz.canRead(manager(), studentGroup(), null).allowed).toBe(false);
    const outside = authz.canRead(admin(), studentGroup(), null);
    expect(outside.allowed).toBe(false);
    if (!outside.allowed) expect(outside.code).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  });

  it('another organization\'s conversation reads as not found, even for a manager', () => {
    const foreign = studentGroup({ organizationId: 'org-2' });
    for (const staff of [admin(), manager()]) {
      const d = authz.canRead(staff, foreign, member(staff), true);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.CONVERSATION_NOT_FOUND);
    }
  });
});

describe('conversation-type confusion', () => {
  const authz = authzWithOnDuty();

  it('a teacher cannot post into a direct conversation with a parent by presenting a membership row', async () => {
    // PD-7 restored BR-1: a membership row in a direct conversation with a
    // contact buys nothing at all.
    const t = teacher();
    const d = await authz.canSend(
      t, conversation({ type: 'direct' }), member(t), customer, NOW, null, ['teacher', 'contact'], [],
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
  });

  it('...and the participant set, not the type, is what decides it', async () => {
    // The positive control for the attack above: same actor, same membership
    // row, same conversation type, only the other participant's kind differs.
    // Without this the assertion above could pass for the wrong reason.
    const t = teacher();
    const d = await authz.canSend(
      t, conversation({ type: 'direct', familyId: null }), member(t), customer, NOW, null, ['teacher', 'staff'], [],
    );
    expect(d.allowed).toBe(true);
  });

  it('a client cannot widen its own authority: the fact comes from the server, not the request', async () => {
    // RT-002/003/004. Under PD-7 the policy reads no relationship at all, so
    // no actor field an attacker adds -- however it is named -- can open the
    // channel.
    const t = teacher();
    const forged = {
      ...teacher(),
      // Everything an attacker might hope the policy reads.
      pairingAuthorized: true,
      relationshipAuthorized: true,
      familyId: 'family-1',
      canMessage: true,
    } as typeof t;
    const d = await authz.canSend(
      forged, conversation({ type: 'direct' }), member(forged), customer, NOW, null,
      ['teacher', 'contact'],
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
  });
});
