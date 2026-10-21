/**
 * PD-12 S3 / PD-17, the pure parts: who reads (and records) a family's money,
 * the derived status and the page order, and a plan's due dates. Since PD-17
 * nothing is read from Jawwid Core, so there is no Core boundary to test.
 */
import { decideBillingAccess } from '@platform/pd012-policy';
import type { Actor } from '@platform/types';
import { addMonths, compareInstalments, daysFrom, statusOf } from '../../../src/billing/instalment';

const ORG = '11111111-1111-1111-1111-111111111111';

function staff(role: string, over: Partial<Actor> = {}): Actor {
  return { actorId: 's', kind: 'staff', displayName: 's', locale: 'ar', isActive: true, staffRole: role as never, organizationId: ORG, ...over };
}

describe('who reads and records a family\'s money (billing.family_read, PD-17)', () => {
  it.each`
    role             | ops          | sales        | scope      | assign   | record   | edit
    ${'super_admin'} | ${null}      | ${null}      | ${'all'}   | ${true}  | ${true}  | ${true}
    ${'manager'}     | ${'manager'} | ${null}      | ${'all'}   | ${true}  | ${true}  | ${true}
    ${'admin'}       | ${'member'}  | ${null}      | ${'reach'} | ${false} | ${true}  | ${true}
    ${'coverage'}    | ${'member'}  | ${null}      | ${'reach'} | ${false} | ${true}  | ${true}
    ${'manager'}     | ${null}      | ${'manager'} | ${'all'}   | ${false} | ${true}  | ${false}
    ${'admin'}       | ${null}      | ${'member'}  | ${'all'}   | ${false} | ${true}  | ${false}
    ${'manager'}     | ${null}      | ${null}      | ${null}    | ${false} | ${false} | ${false}
    ${'manager'}     | ${'member'}  | ${null}      | ${null}    | ${false} | ${false} | ${false}
    ${'admin'}       | ${null}      | ${null}      | ${null}    | ${false} | ${false} | ${false}
    ${'admin'}       | ${'manager'} | ${null}      | ${null}    | ${false} | ${false} | ${false}
    ${'finance'}     | ${'member'}  | ${null}      | ${null}    | ${false} | ${false} | ${false}
  `('$role, Operations $ops, Sales $sales -> $scope', ({ role, ops, sales, scope, assign, record, edit }) => {
    expect(decideBillingAccess(staff(role), ops, sales)).toEqual({ scope, canAssign: assign, canRecord: record, canEditParent: edit });
  });

  it('never a teacher, a parent, an inactive or org-less staff member -- whatever department they claim', () => {
    const teacher: Actor = { actorId: 't', kind: 'teacher', displayName: 't', locale: 'ar', isActive: true, organizationId: ORG };
    const parent: Actor = { actorId: 'p', kind: 'contact', displayName: 'p', locale: 'ar', isActive: true, organizationId: ORG };
    expect(decideBillingAccess(teacher, 'manager', 'manager').scope).toBeNull();
    expect(decideBillingAccess(parent, 'manager', 'manager').scope).toBeNull();
    expect(decideBillingAccess(staff('super_admin', { isActive: false }), null).scope).toBeNull();
    expect(decideBillingAccess(staff('super_admin', { organizationId: undefined }), null).scope).toBeNull();
    expect(decideBillingAccess(staff('admin', { isActive: false }), null, 'member').scope).toBeNull();
  });
});

describe('the instalment status and order', () => {
  const today = '2026-10-19';

  it('derives paid / overdue / due / upcoming from the academy day', () => {
    expect(statusOf({ status: 'paid', dueDate: '2026-10-01' }, today)).toBe('paid');
    expect(statusOf({ status: 'open', dueDate: '2026-10-18' }, today)).toBe('overdue');
    expect(statusOf({ status: 'open', dueDate: today }, today)).toBe('due');
    expect(statusOf({ status: 'open', dueDate: '2026-10-20' }, today)).toBe('upcoming');
  });

  it('orders overdue (oldest first) > due today > upcoming (soonest) > paid (latest first)', () => {
    const rows = [
      { id: 'u2', status: 'upcoming' as const, dueDate: '2026-11-30' },
      { id: 'p1', status: 'paid' as const, dueDate: '2026-09-01' },
      { id: 'o2', status: 'overdue' as const, dueDate: '2026-10-10' },
      { id: 'd1', status: 'due' as const, dueDate: today },
      { id: 'u1', status: 'upcoming' as const, dueDate: '2026-10-25' },
      { id: 'p2', status: 'paid' as const, dueDate: '2026-10-01' },
      { id: 'o1', status: 'overdue' as const, dueDate: '2026-08-01' },
    ];
    expect(rows.sort(compareInstalments).map((r) => r.id)).toEqual(['o1', 'o2', 'd1', 'u1', 'u2', 'p2', 'p1']);
  });

  it('counts whole calendar days across a month end', () => {
    expect(daysFrom('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysFrom(today, '2026-10-12')).toBe(-7);
  });
});

describe('a plan\'s due dates (PD-17)', () => {
  it('adds calendar months, keeping the day, and the 31st becomes the month\'s last day', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-10-21', 0)).toBe('2026-10-21');
    expect(addMonths('2026-12-31', 12)).toBe('2027-12-31');
  });
});
