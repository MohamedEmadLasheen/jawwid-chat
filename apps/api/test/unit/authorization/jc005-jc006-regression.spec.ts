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
import { StaffAccessBasis } from '@platform/staff-scope';
import type { Actor } from '@platform/types';
import type { CoverageService } from '@platform/coverage.service';
import { ActorKind, ConversationType, OnBehalfMode, StaffRole, Visibility } from '@communication/contracts/vocab';
import { FakeStaffScope } from '../../support/fixtures';

const OWNER = 'staff_owner_a';
const INTRUDER = 'staff_admin_b';
const BACKUP = 'staff_backup_c';
const MANAGER = 'staff_mgr';
const FAMILY = 'fam_0001';
const ORG = 'org-1';
const NOW = new Date('2026-09-06T12:00:00Z');

/** on_duty() decides nothing since PD-8; pinned to the intruder to prove it. */
const dutyOf = (id: string | null): CoverageService => ({ onDuty: async () => id });

/**
 * PD-8 (2026-10-15): the scope is chat.staff_conversation_access(). OWNER is
 * the children's supervisor, BACKUP an ACTIVE backup, MANAGER their department
 * manager. INTRUDER has no basis -- even when on_duty() names them and even
 * with a live membership row.
 */
const scoped = () =>
  new AuthorizationService(
    dutyOf(INTRUDER),
    new FakeStaffScope({
      [OWNER]: StaffAccessBasis.RESPONSIBLE,
      [BACKUP]: StaffAccessBasis.BACKUP,
      [MANAGER]: StaffAccessBasis.MANAGER,
    }),
  );

const staff = (actorId: string, staffRole: string, over: Partial<Actor> = {}): Actor => ({
  actorId, kind: ActorKind.STAFF, displayName: 'synthetic', locale: 'ar',
  staffRole: staffRole as Actor['staffRole'], isActive: true, organizationId: ORG, ...over,
});

/** A live membership row the intruder holds: since PD-8 it grants nothing on its own. */
const intruderMember = {
  actorId: INTRUDER, actorKind: ActorKind.STAFF, memberRole: 'admin', isSilent: false, leftAt: null,
} as never;

const conv = {
  id: 'conv_1',
  type: ConversationType.DIRECT,
  organizationId: ORG,
  familyId: FAMILY,
  stickyHandlerId: null,
  stickyUntil: null,
  teacherRequiresApproval: true,
  parentRequiresApproval: true,
  archivedAt: null,
} as never;

describe('JC-005 — a client-supplied on_behalf_mode must never widen authority', () => {
  const svc = scoped();
  const intruder = staff(INTRUDER, StaffRole.ADMIN);
  const owner = staff(OWNER, StaffRole.ADMIN);

  it('denies an out-of-scope admin with no requested mode, even one on_duty() names', async () => {
    const d = await svc.canSend(intruder, conv, intruderMember, { visibility: Visibility.CUSTOMER }, NOW, OWNER);
    expect(d.allowed).toBe(false);
  });

  it('an admin OUTSIDE the family is refused by scope before any mode is read', async () => {
    for (const mode of Object.values(OnBehalfMode)) {
      const d = await svc.canSend(
        intruder, conv, null,
        { visibility: Visibility.CUSTOMER, requestedMode: mode }, NOW, OWNER,
      );
      expect({ mode, code: d.allowed ? null : d.code }).toEqual({ mode, code: CommErrorCode.STAFF_OUT_OF_SCOPE });
    }
  });

  it('ASSIST does not by itself grant access', async () => {
    const d = await svc.canSend(
      intruder, conv, intruderMember,
      { visibility: Visibility.CUSTOMER, requestedMode: OnBehalfMode.ASSIST }, NOW, OWNER,
    );
    expect(d.allowed).toBe(false);
    // ...and an in-scope supervisor cannot use it to re-attribute their own reply.
    const own = await svc.canSend(
      owner, conv, null,
      { visibility: Visibility.CUSTOMER, requestedMode: OnBehalfMode.ASSIST }, NOW, OWNER,
    );
    expect(own.allowed).toBe(false);
    if (!own.allowed) expect(own.code).toBe(CommErrorCode.ASSIST_NOT_PERMITTED);
  });

  it('ESCALATION does not by itself grant access', async () => {
    const d = await svc.canSend(
      intruder, conv, intruderMember,
      { visibility: Visibility.CUSTOMER, requestedMode: OnBehalfMode.ESCALATION }, NOW, OWNER,
    );
    expect(d.allowed).toBe(false);
    const own = await svc.canSend(
      owner, conv, null,
      { visibility: Visibility.CUSTOMER, requestedMode: OnBehalfMode.ESCALATION }, NOW, OWNER,
    );
    expect(own.allowed).toBe(false);
    if (!own.allowed) expect(own.code).toBe(CommErrorCode.ESCALATION_NOT_PERMITTED);
  });

  it('no value of requestedMode grants access to an out-of-scope admin, member row or not', async () => {
    for (const mode of Object.values(OnBehalfMode)) {
      for (const membership of [intruderMember, null]) {
        const d = await svc.canSend(
          intruder, conv, membership,
          { visibility: Visibility.CUSTOMER, requestedMode: mode }, NOW, OWNER,
        );
        expect({ mode, allowed: d.allowed }).toEqual({ mode, allowed: false });
      }
    }
  });
});

describe('JC-006 — deactivated actors lose internal-note access on every path', () => {
  const svc = scoped();

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
  it("the children's supervisor may still send, attributed OWNER", async () => {
    const d = await scoped().canSend(
      staff(OWNER, StaffRole.ADMIN), conv, null,
      { visibility: Visibility.CUSTOMER }, NOW, OWNER,
    );
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe(OnBehalfMode.OWNER);
  });

  it('their department manager may still act on the family, recorded as a step-in', async () => {
    const d = await scoped().canSend(
      staff(MANAGER, StaffRole.MANAGER), conv, null,
      { visibility: Visibility.CUSTOMER }, NOW, OWNER,
    );
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe(OnBehalfMode.ASSIST);
  });

  it('an ACTIVE backup may write an internal note, attributed COVERAGE', async () => {
    const d = await scoped().canSend(
      staff(BACKUP, StaffRole.COVERAGE), conv, null,
      { visibility: Visibility.INTERNAL }, NOW, OWNER,
    );
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe(OnBehalfMode.COVERAGE);
  });

  it('the supervisor may write an internal note', async () => {
    const d = await scoped().canSend(
      staff(OWNER, StaffRole.ADMIN), conv, null,
      { visibility: Visibility.INTERNAL }, NOW, OWNER,
    );
    expect(d.allowed).toBe(true);
  });

  it('...but an admin outside the family may not, even as a note (staff scope)', async () => {
    const d = await scoped().canSend(
      staff(INTRUDER, StaffRole.ADMIN), conv, intruderMember,
      { visibility: Visibility.INTERNAL }, NOW, OWNER,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  });
});
