/**
 * ============================================================================
 * SECURITY REGRESSION SUITE — DO NOT DELETE OR WEAKEN
 * ============================================================================
 *
 * These tests protect two CONFIRMED authorization defects that have ALREADY
 * REGRESSED ONCE (defects.md JC-011): the conversation-model rewrite restored
 * the vulnerable code verbatim, and the original regression suites were removed
 * in the same change, so nothing caught it.
 *
 *   JC-005 (P0)  canSend() granted ASSIST / ESCALATION on a client-supplied
 *                field with no precondition evaluated. Any family-facing admin
 *                could post a customer-visible message to ANY family by setting
 *                one request-body field, defeating on_duty().
 *
 *   JC-006 (P1)  canReadInternal() omitted the isActive check, so an offboarded
 *                admin still passed it.
 *
 * If you are refactoring and these fail: the refactor reintroduced the defect.
 * Fix the code, not the test. If assist/escalation must become available, they
 * need a SERVER-EVALUATED predicate inside AuthorizationService (JC-007) — at
 * which point these tests are updated to assert the permitted case too, not
 * deleted.
 * ============================================================================
 */
import { AuthorizationService } from '@platform/authorization.service';
import { CommErrorCode } from '@platform/errors';
import type { Actor } from '@platform/types';
import type { CoverageService } from '@platform/coverage.service';
import { ActorKind, ConversationType, OnBehalfMode, StaffRole, Visibility } from '@communication/contracts/vocab';

const OWNER = 'staff_owner_a';
const INTRUDER = 'staff_admin_b';
const FAMILY = 'fam_0001';
const NOW = new Date('2026-09-06T12:00:00Z');

const dutyOf = (id: string | null): CoverageService => ({ onDuty: async () => id });

const staff = (actorId: string, staffRole: string, over: Partial<Actor> = {}): Actor => ({
  actorId, kind: ActorKind.STAFF, displayName: 'synthetic', locale: 'ar',
  staffRole: staffRole as Actor['staffRole'], isActive: true, ...over,
});

const conv = {
  id: 'conv_1',
  type: ConversationType.DIRECT,
  familyId: FAMILY,
  stickyHandlerId: null,
  stickyUntil: null,
  teacherRequiresApproval: true,
  parentRequiresApproval: true,
  archivedAt: null,
} as never;

describe('JC-005 — a client-supplied on_behalf_mode must never widen authority', () => {
  const svc = new AuthorizationService(dutyOf(OWNER));
  const intruder = staff(INTRUDER, StaffRole.ADMIN);

  it('denies a not-on-duty admin with no requested mode', async () => {
    const d = await svc.canSend(intruder, conv, null, { visibility: Visibility.CUSTOMER }, NOW, OWNER);
    expect(d.allowed).toBe(false);
  });

  it('ASSIST does not by itself grant access', async () => {
    const d = await svc.canSend(
      intruder, conv, null,
      { visibility: Visibility.CUSTOMER, requestedMode: OnBehalfMode.ASSIST }, NOW, OWNER,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ASSIST_NOT_PERMITTED);
  });

  it('ESCALATION does not by itself grant access', async () => {
    const d = await svc.canSend(
      intruder, conv, null,
      { visibility: Visibility.CUSTOMER, requestedMode: OnBehalfMode.ESCALATION }, NOW, OWNER,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ESCALATION_NOT_PERMITTED);
  });

  it('no value of requestedMode grants access to a not-on-duty admin', async () => {
    for (const mode of Object.values(OnBehalfMode)) {
      const d = await svc.canSend(
        intruder, conv, null,
        { visibility: Visibility.CUSTOMER, requestedMode: mode }, NOW, OWNER,
      );
      expect({ mode, allowed: d.allowed }).toEqual({ mode, allowed: false });
    }
  });
});

describe('JC-006 — deactivated actors lose internal-note access on every path', () => {
  const svc = new AuthorizationService(dutyOf(OWNER));

  it('denies a deactivated admin', () => {
    expect(svc.canReadInternal(staff(OWNER, StaffRole.ADMIN, { isActive: false }))).toBe(false);
  });

  it('denies a deactivated manager', () => {
    expect(svc.canReadInternal(staff('staff_mgr', StaffRole.MANAGER, { isActive: false }))).toBe(false);
  });

  it('still allows active family-facing staff', () => {
    expect(svc.canReadInternal(staff(OWNER, StaffRole.ADMIN))).toBe(true);
  });

  it('denies a family contact and a teacher', () => {
    const contact: Actor = {
      actorId: 'c1', kind: ActorKind.CONTACT, displayName: 'p', locale: 'ar',
      isActive: true, familyId: FAMILY, canMessage: true,
    };
    const teacher: Actor = {
      actorId: 't1', kind: ActorKind.TEACHER, displayName: 't', locale: 'ar', isActive: true,
    };
    expect(svc.canReadInternal(contact)).toBe(false);
    expect(svc.canReadInternal(teacher)).toBe(false);
  });
});

describe('legitimate access must survive the fail-closed fix', () => {
  it('the on-duty admin may still send', async () => {
    const svc = new AuthorizationService(dutyOf(OWNER));
    const d = await svc.canSend(
      staff(OWNER, StaffRole.ADMIN), conv, null,
      { visibility: Visibility.CUSTOMER }, NOW, OWNER,
    );
    expect(d.allowed).toBe(true);
  });

  it('a manager may still act on any family', async () => {
    const svc = new AuthorizationService(dutyOf(OWNER));
    const d = await svc.canSend(
      staff('staff_mgr', StaffRole.MANAGER), conv, null,
      { visibility: Visibility.CUSTOMER }, NOW, OWNER,
    );
    expect(d.allowed).toBe(true);
  });

  it('an off-duty admin may still write an internal note', async () => {
    const svc = new AuthorizationService(dutyOf(OWNER));
    const d = await svc.canSend(
      staff(INTRUDER, StaffRole.ADMIN), conv, null,
      { visibility: Visibility.INTERNAL }, NOW, OWNER,
    );
    expect(d.allowed).toBe(true);
  });
});
