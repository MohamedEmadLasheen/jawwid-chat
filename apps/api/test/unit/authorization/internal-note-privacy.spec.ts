/**
 * QA (AI #5) — INV-11: internal notes are unreachable by any family-side actor,
 * and by any actor whose session should no longer be trusted.
 */
import { StaffRole } from '@prisma/client';
import { AuthorizationService } from '@platform/authorization.service';
import type { Actor } from '@platform/types';
import type { CoverageService } from '@platform/coverage.service';

const coverage: CoverageService = { onDuty: async () => 'staff_admin_owner' };
const svc = new AuthorizationService(coverage);

const contact = (over: Partial<Actor> = {}): Actor => ({
  userId: 'contact_parent_a', kind: 'CONTACT', displayName: 'synthetic parent',
  locale: 'AR', contactId: 'c1', familyId: 'fam_0001', canMessage: true,
  isActive: true, ...over,
});

const staff = (role: StaffRole, over: Partial<Actor> = {}): Actor => ({
  userId: `staff_${role}`, kind: 'STAFF', displayName: 'synthetic staff',
  locale: 'AR', staffRole: role, isActive: true, ...over,
});

describe('canReadInternal — internal note privacy', () => {
  it('denies every family-side contact, whatever their capability flags', () => {
    expect(svc.canReadInternal(contact())).toBe(false);
    expect(svc.canReadInternal(contact({ canMessage: false }))).toBe(false);
  });

  it('denies back-office staff who may never see family threads', () => {
    for (const r of [StaffRole.FINANCE, StaffRole.TECHNICAL, StaffRole.ACADEMIC]) {
      expect({ role: r, can: svc.canReadInternal(staff(r)) }).toEqual({ role: r, can: false });
    }
  });

  it('allows family-facing staff', () => {
    for (const r of [StaffRole.ADMIN, StaffRole.COVERAGE, StaffRole.MANAGER]) {
      expect({ role: r, can: svc.canReadInternal(staff(r)) }).toEqual({ role: r, can: true });
    }
  });

  it('JC-006: denies a DEACTIVATED (offboarded) admin', () => {
    // canReadThread() gates on actor.isActive; canReadInternal() does not.
    // An offboarded admin must lose access on every path, not only the one that
    // happens to check first.
    expect(svc.canReadInternal(staff(StaffRole.ADMIN, { isActive: false }))).toBe(false);
  });

  it('JC-006: denies a SYSTEM actor', () => {
    expect(svc.canReadInternal({
      userId: 'system', kind: 'SYSTEM', displayName: 'Jawwid', locale: 'AR', isActive: true,
    })).toBe(false);
  });
});
