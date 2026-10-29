/**
 * PD-42 -- a package carried over from Jawwid Core: its completed lessons count
 * as used, exactly as chat.compute_learner_access counts them, and who may
 * hold subscriptions.carry_over (PD-30-amendment-carried-over).
 *
 * The database decides the five conditions (test/integration/pd042-intake-data.spec.ts);
 * this is the pure half.
 */
import type { LearnerSubscription } from '@prisma/client';
import { ActorKind, StaffRole } from '@communication/contracts/vocab';
import type { Actor } from '@platform/types';
import { canCarryOverPackage, canGrantSubscriptionException } from '@platform/subscription-policy';
import { lessonsUsedBefore, positionOf, standingInOrder } from '../../../src/billing/subscription-reads';

function sub(id: string, lessons: number, startsOn: string, over: Partial<LearnerSubscription> = {}): LearnerSubscription {
  return {
    id, organizationId: 'o', learnerId: 'l', familyId: 'f', planMonths: 3, lessonsIncluded: lessons,
    startsOn: new Date(`${startsOn}T00:00:00Z`), source: 'staff', requestId: null, planRef: null, note: null,
    createdBy: 's', createdAt: new Date(`${startsOn}T08:00:00Z`), voidedAt: null, voidedBy: null, voidReason: null,
    lessonsUsedBefore: 0, overConfirmedBy: null,
    ...over,
  };
}

const staff = (role: string): Actor =>
  ({ kind: ActorKind.STAFF, actorId: `${role}-1`, staffRole: role, isActive: true, organizationId: 'org-1' }) as unknown as Actor;

describe('PD-42 -- the carried-over package counts its completed lessons', () => {
  const carried = sub('c', 20, '2026-10-28', { source: 'carried_over', lessonsUsedBefore: 12 });

  it('12 done of 20 in Core: the next lesson is "13 of 20"; one held in Chat makes it "14 of 20"', () => {
    const standing = standingInOrder([carried]);
    expect(positionOf(standing, 0 + lessonsUsedBefore(standing))).toEqual({ n: 13, m: 20 });
    expect(positionOf(standing, 1 + lessonsUsedBefore(standing))).toEqual({ n: 14, m: 20 });
  });

  it('a renewal after it fills in order: 20 + 8, all 20 used -> "1 of 8"', () => {
    const renewal = sub('r', 8, '2026-12-01', { source: 'payment_request', requestId: 'q' });
    const standing = standingInOrder([renewal, carried]);
    expect(positionOf(standing, 8 + lessonsUsedBefore(standing))).toEqual({ n: 1, m: 8 });
  });

  it('completed above the total (F1): 21 of 20 is past the package, N > M, as a grace lesson is', () => {
    const over = sub('o', 20, '2026-10-28', { source: 'carried_over', lessonsUsedBefore: 21, overConfirmedBy: 'mgr' });
    const standing = standingInOrder([over]);
    expect(positionOf(standing, lessonsUsedBefore(standing))).toEqual({ n: 22, m: 20 });
  });

  it('a voided carried-over row counts nothing: only standing rows are summed', () => {
    const voided = sub('v', 20, '2026-10-28', { source: 'carried_over', lessonsUsedBefore: 12, voidedAt: new Date() });
    expect(lessonsUsedBefore(standingInOrder([voided]))).toBe(0);
    expect(lessonsUsedBefore(standingInOrder([voided, carried]))).toBe(12);
  });

  it('every other source contributes 0, so PD-30 positions are unchanged', () => {
    const paid = sub('p', 24, '2026-09-01', { source: 'payment_request', requestId: 'q' });
    expect(lessonsUsedBefore([paid])).toBe(0);
    expect(positionOf([paid], 3 + lessonsUsedBefore([paid]))).toEqual(positionOf([paid], 3));
  });
});

describe('PD-42 -- who may hold subscriptions.carry_over', () => {
  it.each`
    role             | ops          | sales        | allowed
    ${'super_admin'} | ${null}      | ${null}      | ${true}
    ${'manager'}     | ${'manager'} | ${null}      | ${true}
    ${'manager'}     | ${null}      | ${'manager'} | ${true}
    ${'admin'}       | ${'member'}  | ${null}      | ${true}
    ${'coverage'}    | ${'member'}  | ${null}      | ${true}
    ${'admin'}       | ${null}      | ${'member'}  | ${true}
    ${'admin'}       | ${null}      | ${null}      | ${false}
    ${'manager'}     | ${null}      | ${null}      | ${false}
    ${'manager'}     | ${'member'}  | ${null}      | ${false}
    ${'finance'}     | ${null}      | ${null}      | ${false}
  `('$role, Operations $ops, Sales $sales -> $allowed', ({ role, ops, sales, allowed }) => {
    expect(canCarryOverPackage(staff(role), ops, sales)).toBe(allowed);
  });

  it('never a teacher, a parent, an inactive or org-less staff member', () => {
    const teacher = { kind: ActorKind.TEACHER, actorId: 't', isActive: true, organizationId: 'org-1' } as unknown as Actor;
    const parent = { kind: ActorKind.CONTACT, actorId: 'p', isActive: true, organizationId: 'org-1' } as unknown as Actor;
    expect(canCarryOverPackage(teacher, 'member', 'member')).toBe(false);
    expect(canCarryOverPackage(parent, 'member', 'member')).toBe(false);
    expect(canCarryOverPackage({ ...staff(StaffRole.SUPER_ADMIN), isActive: false } as Actor, null, null)).toBe(false);
    expect(canCarryOverPackage({ ...staff(StaffRole.SUPER_ADMIN), organizationId: undefined } as unknown as Actor, null, null)).toBe(false);
  });

  it('wider than the exception grantors: a supervisor carries over, but never grants an exception', () => {
    expect(canCarryOverPackage(staff('admin'), 'member', null)).toBe(true);
    expect(canGrantSubscriptionException(staff('admin'), 'member', null)).toBe(false);
  });
});
