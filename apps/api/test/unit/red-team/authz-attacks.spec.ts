/**
 * RED TEAM (AI #9) — adversarial probes against the centralized authorization
 * contract. These are ATTACKS, not conformance tests: each one asserts the
 * CURRENTLY OBSERVED behaviour so the finding is evidence-backed, and names the
 * secure behaviour it violates in a comment.
 *
 * Complementary to AI #5's JC-005/JC-006 suites: those assert the required
 * behaviour and fail. These assert the actual behaviour and pass, so the
 * red-team report can say CONFIRMED rather than THEORETICAL, and so a future
 * fix flips them loudly.
 *
 * Do not "fix" a failing expectation here by editing the expectation. When a
 * finding is fixed, the assertion is inverted in the same commit as the fix.
 */
import { MessageVisibility, OnBehalfMode, StaffRole, ThreadKind } from '@prisma/client';
import { AuthorizationService } from '@platform/authorization.service';
import type { Actor } from '@platform/types';
import type { CoverageService } from '@platform/coverage.service';

const OWNER_ID = 'staff_owner';
const OTHER_ID = 'staff_other';
const FAMILY_A = 'fam_a';
const FAMILY_B = 'fam_b';
const NOW = new Date('2026-09-05T12:00:00Z');

const thread = (familyId: string) => ({
  familyId,
  stickyHandlerId: null,
  stickyUntil: null,
});

function staff(userId: string, staffRole: StaffRole, over: Partial<Actor> = {}): Actor {
  return {
    userId,
    kind: 'STAFF',
    displayName: 'synthetic',
    locale: 'AR',
    staffRole,
    isActive: true,
    ...over,
  };
}

function contact(over: Partial<Actor> = {}): Actor {
  return {
    userId: 'contact_a',
    kind: 'CONTACT',
    displayName: 'synthetic parent',
    locale: 'AR',
    contactId: 'contact_a',
    familyId: FAMILY_A,
    canMessage: true,
    isActive: true,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// RT-001 — client-supplied on_behalf_mode is stamped verbatim for a MANAGER
// ---------------------------------------------------------------------------
describe('RT-001 · on_behalf_mode attribution is client-controlled for MANAGER', () => {
  const svc = new AuthorizationService({ onDuty: async () => OWNER_ID } as CoverageService);

  it('CONFIRMED: a manager who owns nothing can stamp the message OWNER', async () => {
    // Contract comment on SendIntent.requestedMode:
    //   "Only honoured for ASSIST/ESCALATION; OWNER vs COVERAGE is derived, never trusted."
    // The MANAGER branch honours it for ALL FOUR modes.
    const d = await svc.canSendMessage(
      staff('staff_manager', StaffRole.MANAGER),
      thread(FAMILY_A),
      OWNER_ID,
      { visibility: MessageVisibility.CUSTOMER, requestedMode: OnBehalfMode.OWNER },
      NOW,
    );
    expect(d.allowed).toBe(true);
    // SECURE BEHAVIOUR: OWNER may only be derived, and only when
    // actor.userId === familyOwnerId. Observed: taken from the request body.
    if (d.allowed) expect(d.onBehalfMode).toBe(OnBehalfMode.OWNER);
  });

  it('CONFIRMED: every mode a manager asks for is granted verbatim', async () => {
    const observed: Record<string, unknown> = {};
    for (const mode of Object.values(OnBehalfMode)) {
      const d = await svc.canSendMessage(
        staff('staff_manager', StaffRole.MANAGER),
        thread(FAMILY_A),
        OWNER_ID,
        { visibility: MessageVisibility.CUSTOMER, requestedMode: mode },
        NOW,
      );
      observed[mode] = d.allowed ? d.onBehalfMode : `denied`;
    }
    expect(observed).toEqual({
      OWNER: OnBehalfMode.OWNER,
      COVERAGE: OnBehalfMode.COVERAGE,
      ASSIST: OnBehalfMode.ASSIST,
      ESCALATION: OnBehalfMode.ESCALATION,
    });
  });
});

// ---------------------------------------------------------------------------
// RT-002 — on_behalf_mode for internal notes never consults on_duty()
// ---------------------------------------------------------------------------
describe('RT-002 · COVERAGE attribution is asserted without any coverage assignment', () => {
  it('CONFIRMED: on_duty() is never called on the internal-note path', async () => {
    let onDutyCalls = 0;
    const coverage: CoverageService = {
      onDuty: async () => {
        onDutyCalls += 1;
        return OWNER_ID;
      },
    };
    const svc = new AuthorizationService(coverage);

    const d = await svc.canSendMessage(
      staff(OTHER_ID, StaffRole.ADMIN), // not the owner, not on duty, no coverage rule
      thread(FAMILY_A),
      OWNER_ID,
      { visibility: MessageVisibility.INTERNAL },
      NOW,
    );

    expect(d.allowed).toBe(true);
    // The audit trail will record on_behalf_mode=COVERAGE for an actor who holds
    // no coverage assignment at all. The documented derivation is
    // "on_duty() + ownership"; only ownership is consulted.
    if (d.allowed) expect(d.onBehalfMode).toBe(OnBehalfMode.COVERAGE);
    expect(onDutyCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RT-003 — the authorization contract is blind to thread kind and participants
// ---------------------------------------------------------------------------
describe('RT-003 · authorization is a function of familyId alone', () => {
  const svc = new AuthorizationService({ onDuty: async () => OWNER_ID } as CoverageService);

  it('CONFIRMED: canReadThread admits any thread kind, including STUDENT_GROUP', () => {
    // The ThreadKind enum already contains STUDENT_GROUP, CLASS_GROUP and
    // OFFICIAL, and Thread is @@unique([familyId, kind]) — so up to four threads
    // per family are representable TODAY. canReadThread's parameter type is
    // Pick<Thread,'familyId'>: it cannot read `kind` even if it wanted to.
    for (const kind of Object.values(ThreadKind)) {
      const t = { familyId: FAMILY_A, kind };
      expect({ kind, allowed: svc.canReadThread(contact(), t).allowed }).toEqual({
        kind,
        allowed: true,
      });
    }
  });

  it('CONFIRMED: canSendMessage receives no participant set and no thread kind', async () => {
    // BR-1 ("no 1:1 conversation may contain both a teacher and a parent") is a
    // predicate over the participant set. Neither entry point is given one, so
    // the rule is not merely unimplemented — it is unexpressible without a
    // contract change.
    const d = await svc.canSendMessage(
      contact(),
      thread(FAMILY_A),
      OWNER_ID,
      { visibility: MessageVisibility.CUSTOMER },
      NOW,
    );
    expect(d.allowed).toBe(true);
    expect(Object.keys(thread(FAMILY_A))).toEqual([
      'familyId',
      'stickyHandlerId',
      'stickyUntil',
    ]);
  });

  it('control: cross-family access by a contact is correctly denied', () => {
    expect(svc.canReadThread(contact(), { familyId: FAMILY_B }).allowed).toBe(false);
  });

  it('CONFIRMED: any family-facing staff reads every family, with no coverage scope', () => {
    for (const role of [StaffRole.ADMIN, StaffRole.COVERAGE, StaffRole.MANAGER]) {
      for (const fam of [FAMILY_A, FAMILY_B, 'fam_never_seen', '*']) {
        expect({ role, fam, allowed: svc.canReadThread(staff('s', role), { familyId: fam }).allowed })
          .toEqual({ role, fam, allowed: true });
      }
    }
  });
});
