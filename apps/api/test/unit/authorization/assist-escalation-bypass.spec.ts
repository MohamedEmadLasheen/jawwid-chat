/**
 * QA (AI #5) — authorization bypass conformance.
 *
 * Defect JC-005. These tests encode the REQUIRED behaviour and are expected to
 * FAIL against the current implementation. They are the regression tests for
 * the fix; do not weaken them to make the suite green.
 *
 * AuthorizationService declares:
 *   "No controller, gateway, or worker is permitted to make its own access
 *    decision."
 *
 * But canSendMessage() currently returns allow() for ANY family-facing staff
 * member who simply sets requestedMode = ASSIST or ESCALATION, with no
 * precondition evaluated, deferring the gate to "the caller". That is the
 * controller making the access decision, and it is reachable from a client that
 * controls the request body.
 *
 * The unused CommErrorCode.ASSIST_NOT_PERMITTED shows the gate was intended.
 */
import { MessageVisibility, OnBehalfMode, StaffRole } from '@prisma/client';
import { AuthorizationService } from '@platform/authorization.service';
import { CommErrorCode } from '@platform/errors';
import type { Actor } from '@platform/types';
import type { CoverageService } from '@platform/coverage.service';

const OWNER_ID = 'staff_admin_owner';
const OTHER_ADMIN_ID = 'staff_admin_intruder';
const FAMILY_ID = 'fam_0001';
const NOW = new Date('2026-09-05T12:00:00Z');

/** on_duty() resolves to the owner, never to the intruder. */
const coverage: CoverageService = { onDuty: async () => OWNER_ID };

const thread = { familyId: FAMILY_ID, stickyHandlerId: null, stickyUntil: null };

function staff(userId: string, staffRole: StaffRole): Actor {
  return { userId, kind: 'STAFF', displayName: 'synthetic', locale: 'AR', staffRole, isActive: true };
}

describe('AuthorizationService — assist/escalation must not bypass on_duty', () => {
  const svc = new AuthorizationService(coverage);
  const intruder = staff(OTHER_ADMIN_ID, StaffRole.ADMIN);

  it('denies a customer-facing send from an admin who is not on duty', async () => {
    const d = await svc.canSendMessage(
      intruder, thread, OWNER_ID,
      { visibility: MessageVisibility.CUSTOMER }, NOW,
    );
    expect(d.allowed).toBe(false);
  });

  it('JC-005a: requestedMode=ASSIST must not by itself grant access', async () => {
    const d = await svc.canSendMessage(
      intruder, thread, OWNER_ID,
      { visibility: MessageVisibility.CUSTOMER, requestedMode: OnBehalfMode.ASSIST }, NOW,
    );
    // Assist requires: family in the NOW bucket, waited > 50% of the response
    // target, and the on-duty admin has not opened it -- or the on-duty admin
    // explicitly requested help. None hold here, so this must be denied by the
    // centralized policy, not by a caller that may or may not check.
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ASSIST_NOT_PERMITTED);
  });

  it('JC-005b: requestedMode=ESCALATION must not by itself grant access', async () => {
    const d = await svc.canSendMessage(
      intruder, thread, OWNER_ID,
      { visibility: MessageVisibility.CUSTOMER, requestedMode: OnBehalfMode.ESCALATION }, NOW,
    );
    expect(d.allowed).toBe(false);
  });

  it('JC-005c: a client-supplied mode never widens authority beyond on_duty', async () => {
    for (const mode of [OnBehalfMode.OWNER, OnBehalfMode.COVERAGE, OnBehalfMode.ASSIST, OnBehalfMode.ESCALATION]) {
      const d = await svc.canSendMessage(
        intruder, thread, OWNER_ID,
        { visibility: MessageVisibility.CUSTOMER, requestedMode: mode }, NOW,
      );
      expect({ mode, allowed: d.allowed }).toEqual({ mode, allowed: false });
    }
  });

  it('the on-duty owner is still allowed, and is tagged OWNER', async () => {
    const d = await svc.canSendMessage(
      staff(OWNER_ID, StaffRole.ADMIN), thread, OWNER_ID,
      { visibility: MessageVisibility.CUSTOMER }, NOW,
    );
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe(OnBehalfMode.OWNER);
  });
});
