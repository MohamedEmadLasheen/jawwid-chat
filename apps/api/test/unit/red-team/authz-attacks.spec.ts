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

  it('an on-duty admin who is not the owner is attributed COVERAGE, not OWNER', async () => {
    const cov = admin('coverage-admin', 'coverage');
    const authz = authzWithOnDuty('coverage-admin');
    const d = await authz.canSend(cov, conversation(), member(cov), customer, NOW, OWNER);
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
  it('an internal note by an off-duty non-owner is attributed ASSIST, not COVERAGE', async () => {
    const a = admin('bystander');
    const authz = authzWithOnDuty('somebody-else');
    const d = await authz.canSend(a, conversation(), member(a), internal, NOW, OWNER);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe('assist');
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

  it('control: family-facing staff may still open any family conversation', () => {
    expect(authz.canRead(admin(), studentGroup(), null).allowed).toBe(true);
  });
});

describe('conversation-type confusion', () => {
  const authz = authzWithOnDuty();

  it('a teacher cannot post into a direct conversation with a parent by presenting a membership row', async () => {
    // PD-6 re-versioned the rule but not this attack: a membership row is not a
    // relationship. Holding a member row in a direct conversation with a
    // contact buys nothing when the relationship says no.
    const t = teacher();
    const d = await authz.canSend(
      t, conversation({ type: 'direct' }), member(t), customer, NOW, null, ['teacher', 'contact'],
      [], false /* pairingAuthorized */,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED);
  });

  it('...and the resolved relationship is the ONLY thing that changes that verdict', async () => {
    // The positive control for the attack above: same actor, same membership
    // row, same participant set, only the server-resolved fact differs. Without
    // this the assertion above could pass for the wrong reason.
    const t = teacher();
    const d = await authz.canSend(
      t, conversation({ type: 'direct' }), member(t), customer, NOW, null, ['teacher', 'contact'],
      [], true /* pairingAuthorized */,
    );
    expect(d.allowed).toBe(true);
  });

  it('a client cannot widen its own authority: the fact comes from the server, not the request', async () => {
    // RT-002/003/004 in PD-6 shape. There is no request field that reaches
    // pairingAuthorized -- it is resolved by RelationshipService from Jawwid
    // Core data before the policy runs. This asserts the policy's half of that
    // contract: the parameter is positional and typed boolean, so no actor
    // field, membership field or participant-kind string can reach it.
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
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED);
  });
});
