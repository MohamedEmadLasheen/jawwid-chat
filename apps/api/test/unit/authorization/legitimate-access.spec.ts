/**
 * QA (AI #5) — regression guard for the JC-005 / JC-006 fixes.
 *
 * Failing closed is only correct if every LEGITIMATE path still works. This
 * suite pins the access that must survive. If a future change to the assist /
 * escalation predicate breaks one of these, it broke the product, not an
 * attack.
 */
import { MessageVisibility, OnBehalfMode, StaffRole } from '@prisma/client';
import { AuthorizationService } from '@platform/authorization.service';
import type { Actor } from '@platform/types';
import type { CoverageService } from '@platform/coverage.service';

const OWNER = 'staff_owner_a';
const COVER = 'staff_coverage_b';
const FAMILY = 'fam_0001';
const NOW = new Date('2026-09-05T12:00:00Z');

const staff = (userId: string, staffRole: StaffRole, over: Partial<Actor> = {}): Actor => ({
  userId, kind: 'STAFF', displayName: 'synthetic', locale: 'AR', staffRole, isActive: true, ...over,
});
const contact = (over: Partial<Actor> = {}): Actor => ({
  userId: 'contact_parent_a', kind: 'CONTACT', displayName: 'synthetic parent', locale: 'AR',
  contactId: 'c1', familyId: FAMILY, canMessage: true, isActive: true, ...over,
});

const plainThread = { familyId: FAMILY, stickyHandlerId: null, stickyUntil: null };
const customer = { visibility: MessageVisibility.CUSTOMER };

/** on_duty() resolves to whoever the test says is on duty. */
const dutyOf = (id: string | null): CoverageService => ({ onDuty: async () => id });

describe('legitimate access still works after the JC-005 fail-closed fix', () => {
  it('the on-duty OWNER may send, tagged OWNER', async () => {
    const svc = new AuthorizationService(dutyOf(OWNER));
    const d = await svc.canSendMessage(staff(OWNER, StaffRole.ADMIN), plainThread, OWNER, customer, NOW);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.onBehalfMode).toBe(OnBehalfMode.OWNER);
  });

  it('the on-duty COVERAGE admin may send, tagged COVERAGE, and ownership is untouched', async () => {
    const svc = new AuthorizationService(dutyOf(COVER));
    const d = await svc.canSendMessage(staff(COVER, StaffRole.COVERAGE), plainThread, OWNER, customer, NOW);
    expect(d.allowed).toBe(true);
    // Primary Owner != Current Handler: the message is tagged COVERAGE, and
    // nothing in this path may reassign family.ownerId.
    if (d.allowed) expect(d.onBehalfMode).toBe(OnBehalfMode.COVERAGE);
  });

  it('the STICKY handler may send past shift end while stickiness is live', async () => {
    const svc = new AuthorizationService(dutyOf(COVER)); // duty has already moved on
    const sticky = {
      familyId: FAMILY,
      stickyHandlerId: OWNER,
      stickyUntil: new Date(NOW.getTime() + 5 * 60_000),
    };
    const d = await svc.canSendMessage(staff(OWNER, StaffRole.ADMIN), sticky, OWNER, customer, NOW);
    expect(d.allowed).toBe(true);
  });

  it('expired stickiness does NOT grant access', async () => {
    const svc = new AuthorizationService(dutyOf(COVER));
    const expired = {
      familyId: FAMILY,
      stickyHandlerId: OWNER,
      stickyUntil: new Date(NOW.getTime() - 1),
    };
    const d = await svc.canSendMessage(staff(OWNER, StaffRole.ADMIN), expired, OWNER, customer, NOW);
    expect(d.allowed).toBe(false);
  });

  it('the MANAGER may act on any family', async () => {
    const svc = new AuthorizationService(dutyOf(OWNER));
    const d = await svc.canSendMessage(staff('staff_manager', StaffRole.MANAGER), plainThread, OWNER, customer, NOW);
    expect(d.allowed).toBe(true);
  });

  it('any family-facing admin may write an INTERNAL note even when not on duty', async () => {
    const svc = new AuthorizationService(dutyOf(OWNER));
    const d = await svc.canSendMessage(
      staff('staff_other_admin', StaffRole.ADMIN), plainThread, OWNER,
      { visibility: MessageVisibility.INTERNAL }, NOW,
    );
    expect(d.allowed).toBe(true);
  });

  it('a contact of the family with can_message may send', async () => {
    const svc = new AuthorizationService(dutyOf(OWNER));
    const d = await svc.canSendMessage(contact(), plainThread, OWNER, customer, NOW);
    expect(d.allowed).toBe(true);
  });

  it('a contact of ANOTHER family may not', async () => {
    const svc = new AuthorizationService(dutyOf(OWNER));
    const d = await svc.canSendMessage(contact({ familyId: 'fam_other' }), plainThread, OWNER, customer, NOW);
    expect(d.allowed).toBe(false);
  });

  it('the SYSTEM actor may send (deterministic templates and timers)', async () => {
    const svc = new AuthorizationService(dutyOf(OWNER));
    const d = await svc.canSendMessage(
      { userId: 'system', kind: 'SYSTEM', displayName: 'Jawwid', locale: 'AR', isActive: true },
      plainThread, OWNER, customer, NOW,
    );
    expect(d.allowed).toBe(true);
  });

  it('canReadThread still allows an active family-facing admin', () => {
    const svc = new AuthorizationService(dutyOf(OWNER));
    expect(svc.canReadThread(staff('staff_any_admin', StaffRole.ADMIN), plainThread).allowed).toBe(true);
  });

  it('canReadThread still allows the family’s own contact', () => {
    const svc = new AuthorizationService(dutyOf(OWNER));
    expect(svc.canReadThread(contact(), plainThread).allowed).toBe(true);
  });
});
