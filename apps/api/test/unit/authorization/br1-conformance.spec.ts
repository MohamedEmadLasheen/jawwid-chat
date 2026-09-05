/**
 * QA (AI #5) — BR-1 conformance matrix (release gates G-01, G-02, G-03).
 *
 *   Teacher <-> Parent direct 1:1 communication is FORBIDDEN, for messaging and
 *   calling alike. Teacher <-> Parent communication happens ONLY through the
 *   official Student Group, with the required admin presence/authorization.
 *
 * WHY THESE ARE PENDING RATHER THAN FAILING
 * -----------------------------------------
 * They cannot be written yet, and QA will not fake them:
 *
 *   JC-002  BR-1's PERMITTED case is currently unrepresentable. Authorization
 *           is keyed on Thread(kind=FAMILY) unique per family, so there is no
 *           conversation participant set to assert against.
 *   JC-003  There is no teacher actor. ActorKind is STAFF|CONTACT|SYSTEM, and a
 *           teacher mapped onto StaffRole.ACADEMIC is barred from ALL family
 *           communication, which deletes BR-1's permitted case.
 *   AMB-9   "Required admin presence/authorization" is UNDEFINED in any document
 *           available to QA. It is the load-bearing condition of the permitted
 *           case, and QA must not resolve it by assumption.
 *
 * Pending (not failing) so peer agents keep usable CI feedback. The release gate
 * — not this suite — is the authority on readiness, and it holds G-01/G-02/G-03
 * at FAIL. Convert each todo to a real assertion as the seam lands; the matrix
 * below is the exact set required, and none of it may be dropped.
 *
 * See docs/qa/seams-required.md for the seam signature these will target.
 */
import { StaffRole } from '@prisma/client';
import { isFamilyFacing } from '@platform/types';

describe('BR-1 — current implementation state (executable, non-blocking)', () => {
  it('documents that no teacher actor exists: ACADEMIC is barred from family communication', () => {
    // This is TRUE today and is exactly the defect (JC-003). When a teacher
    // becomes a first-class actor, this expectation must be revisited together
    // with the whole matrix below — it is a tripwire, not an endorsement.
    expect(isFamilyFacing(StaffRole.ACADEMIC)).toBe(false);
  });

  it('documents that back-office staff remain barred (this part is correct)', () => {
    expect(isFamilyFacing(StaffRole.FINANCE)).toBe(false);
    expect(isFamilyFacing(StaffRole.TECHNICAL)).toBe(false);
  });
});

describe('BR-1 — forbidden 1:1 channels (blocked by JC-002/JC-003)', () => {
  it.todo('BR1-01 teacher creates a 1:1 conversation with a parent → DENY');
  it.todo('BR1-02 parent creates a 1:1 conversation with a teacher → DENY');
  it.todo('BR1-03 teacher sends into a parent 1:1 thread id → DENY');
  it.todo('BR1-04 teacher places a 1:1 voice call to a parent → DENY');
  it.todo('BR1-05 parent places a 1:1 voice call to a teacher → DENY');
  it.todo('BR1-06 co-members of a group open a 1:1 with each other → DENY');
  it.todo('BR1-07 add a parent to an existing Teacher↔Admin 1:1 → DENY');
  it.todo('BR1-08 add a teacher to an existing Parent↔Admin 1:1 → DENY');
  it.todo('BR1-10 convert a Student Group into a 1:1 by removing members → DENY');
  it.todo('BR1-11 teacher subscribes to a parent 1:1 realtime channel → no events');
  it.todo('BR1-12 teacher searches for a parent and retrieves contact details → DENY');
  it.todo('BR1-13 teacher joins a Parent↔Admin call room → DENY at token issue AND at join');
  it.todo('BR1-14 teacher requests a call token for an arbitrary room id → DENY');
  it.todo('BR1-15 direct websocket frame bypassing REST → DENY');
  it.todo('BR1-16 replay an admin-issued request with a teacher session → DENY');
  it.todo('BR1-17 deep link to a parent 1:1 opened by a teacher → DENY server-side');
  it.todo('BR1-18 push for a parent 1:1 delivered to a teacher device → never emitted');
  it.todo('BR1-20 Teacher↔Parent conversation created directly in the DB → surfaced by an invariant check');
});

describe('BR-1 — acceptance test for the whole rule', () => {
  // Run with client-side CommunicationPolicy disabled. If any forbidden row
  // passes here, BR-1 is not implemented regardless of what the UI does.
  it.todo('BR1-19 hostile client with client-side policy patched out → server denies every forbidden row');
});

describe('BR-1 — permitted case (additionally blocked by AMB-9)', () => {
  it.todo('teacher and parent exchange messages inside the official Student Group → ALLOW');
  it.todo('teacher and parent join a Student Group voice call → ALLOW');
  it.todo('BR1-09 admin removed from a Student Group leaving teacher+parent alone → AMB-9');
  it.todo('SG-12 required admin presence enforced at post time AND at call time → AMB-9');
});
