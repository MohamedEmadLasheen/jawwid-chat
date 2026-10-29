/**
 * PD-30 (2026-10-26): the subscription lock's pure rules.
 *
 *  - canSend / canCall: a family or student group with a locked child is
 *    read-only for the parent and the teacher; staff still write; a direct
 *    chat is never consulted; enforcement off = nothing refused.
 *  - who grants an exception: the super admin, the Operations Manager, the
 *    Sales Manager -- nobody else.
 *  - "Lesson N of M": the next lesson's place in the subscriptions in order.
 *  - the card and pay-page texts.
 *
 * The database half (counting, the state machine, holds) is proven in
 * test/integration/pd030-subscription-lock-http.spec.ts.
 */
import type { LearnerSubscription } from '@prisma/client';
import { AuthorizationService, CallIntent, type LiveMember } from '@platform/authorization.service';
import { CommErrorCode } from '@platform/errors';
import { StaffAccessBasis } from '@platform/staff-scope';
import { canGrantSubscriptionException } from '@platform/subscription-policy';
import { subscriptionLockEnforced, type LockedChild, type SubscriptionLockReader } from '@platform/subscription-lock';
import { currentOf, forParent, positionOf, standingInOrder, type StaffChildSubscription } from '../../../src/billing/subscription-reads';
import { renderCardBody } from '../../../src/lessons/lesson-card';
import { renderPayPage, type PayPageModel } from '../../../src/billing/pay-page';
import { FakeCoverage, FakeStaffScope, admin, conversation, member, parent, studentGroup, teacher } from '../../support/fixtures';

const NOW = new Date('2026-10-26T10:00:00Z');

class FakeLock implements SubscriptionLockReader {
  asked: string[] = [];
  constructor(public enforced: boolean, private readonly locked: LockedChild[]) {}
  async lockedChildren(conversationId: string) {
    this.asked.push(conversationId);
    return this.locked;
  }
  async isLocked() {
    return this.locked.length > 0;
  }
  async lockOf() {
    return this.locked.length > 0 ? ('balance' as const) : null;
  }
}

const ADAM: LockedChild = { learnerId: 'l-1', learnerName: 'Adam', reasons: ['balance'], instalmentLabel: null, overdueDueOn: null };
const LIVE_GROUP: LiveMember[] = [
  { actorId: 'teacher-1', actorKind: 'teacher', memberRole: 'teacher' },
  { actorId: 'parent-1', actorKind: 'contact', memberRole: 'parent' },
  { actorId: 'admin-1', actorKind: 'staff', memberRole: 'admin', isActive: true },
];
const KINDS = LIVE_GROUP.map((m) => m.actorKind);

function authz(lock: FakeLock) {
  return new AuthorizationService(new FakeCoverage(null), new FakeStaffScope({ 'admin-1': StaffAccessBasis.RESPONSIBLE }), lock);
}

describe('PD-30 — a group locked for payment', () => {
  const group = studentGroup({ id: 'g-1' });
  const familyGroup = conversation({ id: 'fg-1', type: 'family_group' });

  it.each([
    ['the parent', parent()],
    ['the teacher', teacher()],
  ])('refuses %s a message and a call in a locked student or family group', async (_who, actor) => {
    const a = authz(new FakeLock(true, [ADAM]));
    for (const conv of [group, familyGroup]) {
      const send = await a.canSend(actor, conv, member(actor), { visibility: 'customer' }, NOW, null, KINDS, LIVE_GROUP);
      expect(send).toMatchObject({ allowed: false, code: CommErrorCode.SUBSCRIPTION_LOCKED });
      const call = await a.canCall(actor, conv, member(actor), KINDS.map((kind) => ({ kind })) as never, NOW, null, LIVE_GROUP, CallIntent.INITIATE);
      expect(call).toMatchObject({ allowed: false, code: CommErrorCode.SUBSCRIPTION_LOCKED });
      expect(await a.refusePaymentLockFor(actor, conv)).toMatchObject({ allowed: false, code: CommErrorCode.SUBSCRIPTION_LOCKED });
    }
  });

  it('lets staff write in the locked group', async () => {
    const a = authz(new FakeLock(true, [ADAM]));
    const staff = admin();
    const send = await a.canSend(staff, group, member(staff), { visibility: 'customer' }, NOW, null, KINDS, LIVE_GROUP);
    expect(send.allowed).toBe(true);
    expect(await a.refusePaymentLockFor(staff, group)).toBeNull();
  });

  it('never consults the lock for a direct chat: the parent and their supervisor always talk', async () => {
    const lock = new FakeLock(true, [ADAM]);
    const a = authz(lock);
    const direct = conversation({ id: 'd-1', type: 'direct' });
    const p = parent();
    const send = await a.canSend(p, direct, member(p), { visibility: 'customer' }, NOW, null, ['contact', 'staff'], []);
    expect(send.allowed).toBe(true);
    expect(lock.asked).toEqual([]);
  });

  it('refuses nothing when no child is locked, or when enforcement is off', async () => {
    for (const lock of [new FakeLock(true, []), new FakeLock(false, [ADAM])]) {
      const p = parent();
      const send = await authz(lock).canSend(p, group, member(p), { visibility: 'customer' }, NOW, null, KINDS, LIVE_GROUP);
      expect(send.allowed).toBe(true);
    }
  });

  it('keeps the constitutional checks first: BR-1 admin presence still reports its own code', async () => {
    const p = parent();
    const noAdmin = LIVE_GROUP.filter((m) => m.actorKind !== 'staff');
    const send = await authz(new FakeLock(true, [ADAM])).canSend(p, group, member(p), { visibility: 'customer' }, NOW, null, ['teacher', 'contact'], noAdmin);
    expect(send).toMatchObject({ allowed: false, code: CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED });
  });
});

describe('PD-30 — who may grant or revoke an exception', () => {
  const staff = (role: string) => admin('s-1', role);
  it.each`
    role             | ops          | sales        | allowed
    ${'super_admin'} | ${null}      | ${null}      | ${true}
    ${'manager'}     | ${'manager'} | ${null}      | ${true}
    ${'admin'}       | ${null}      | ${'manager'} | ${true}
    ${'manager'}     | ${null}      | ${'manager'} | ${true}
    ${'admin'}       | ${'manager'} | ${null}      | ${false}
    ${'admin'}       | ${'member'}  | ${null}      | ${false}
    ${'coverage'}    | ${'member'}  | ${null}      | ${false}
    ${'admin'}       | ${null}      | ${'member'}  | ${false}
    ${'manager'}     | ${null}      | ${null}      | ${false}
  `('$role, Operations $ops, Sales $sales -> $allowed', ({ role, ops, sales, allowed }) => {
    expect(canGrantSubscriptionException(staff(role), ops, sales)).toBe(allowed);
  });

  it('never a teacher, a parent, an inactive or org-less staff member', () => {
    expect(canGrantSubscriptionException(teacher(), 'manager', 'manager')).toBe(false);
    expect(canGrantSubscriptionException(parent(), 'manager', 'manager')).toBe(false);
    expect(canGrantSubscriptionException({ ...staff('super_admin'), isActive: false }, null, null)).toBe(false);
    expect(canGrantSubscriptionException({ ...staff('super_admin'), organizationId: undefined }, null, null)).toBe(false);
  });
});

function sub(id: string, lessons: number, startsOn: string, over: Partial<LearnerSubscription> = {}): LearnerSubscription {
  return {
    id, organizationId: 'o', learnerId: 'l', familyId: 'f', planMonths: 3, lessonsIncluded: lessons,
    startsOn: new Date(`${startsOn}T00:00:00Z`), source: 'staff', requestId: null, planRef: null, note: null,
    createdBy: 's', createdAt: new Date(`${startsOn}T08:00:00Z`), voidedAt: null, voidedBy: null, voidReason: null,
    lessonsUsedBefore: 0, overConfirmedBy: null,
    ...over,
  };
}

describe('PD-30 — Lesson N of M', () => {
  const first = sub('a', 24, '2026-09-01');
  const second = sub('b', 8, '2026-12-01');

  it('counts within the subscription the next lesson falls in', () => {
    expect(positionOf([first], 0)).toEqual({ n: 1, m: 24 });
    expect(positionOf([first], 1)).toEqual({ n: 2, m: 24 });
    expect(positionOf([first, second], 23)).toEqual({ n: 24, m: 24 });
    expect(positionOf([first, second], 24)).toEqual({ n: 1, m: 8 });
  });

  it('a grace lesson past the last subscription stays in it: N > M', () => {
    expect(positionOf([first], 24)).toEqual({ n: 25, m: 24 });
    expect(positionOf([first], 25)).toEqual({ n: 26, m: 24 });
  });

  it('grace lessons are taken from the renewal: 26 used of 24 + 8 -> "3 of 8"', () => {
    expect(positionOf([first, second], 26)).toEqual({ n: 3, m: 8 });
  });

  it('no subscription, no M', () => {
    expect(positionOf([], 5)).toBeNull();
  });

  it('voided rows are not standing; standing ones are in start order', () => {
    const voided = sub('v', 100, '2026-08-01', { voidedAt: new Date() });
    expect(standingInOrder([second, voided, first]).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('the current subscription is the latest started, else the first to come', () => {
    expect(currentOf([first, second], '2026-10-26')!.id).toBe('a');
    expect(currentOf([first, second], '2026-12-02')!.id).toBe('b');
    expect(currentOf([second], '2026-10-26')!.id).toBe('b');
    expect(currentOf([], '2026-10-26')).toBeNull();
  });

  it('the parent never sees an exception', () => {
    const staffView: StaffChildSubscription = {
      child: { id: 'l', name: 'Adam' }, current: null, lessonsIncluded: 24, lessonsUsed: 27, lessonsLeft: 0,
      graceLeft: 0, state: 'open', lockReasons: [], overdue: null, balance: -3, excepted: ['balance'], held: false,
    };
    const shown = forParent(staffView);
    expect(shown).not.toHaveProperty('excepted');
    expect(shown).not.toHaveProperty('balance');
    expect(shown).not.toHaveProperty('held');
    expect(shown.graceLeft).toBeNull();
  });
});

describe('PD-30 — what the cards and the pay page say', () => {
  it('the report card says "Lesson 2 of 24" when it kept M, and only N without one', () => {
    const base = { learnerName: 'Adam', coveredTopics: ['revision'], lessonNumber: 2 };
    expect(renderCardBody('lesson_report', { ...base, lessonTotal: 24 }, 'en')).toContain('Lesson no.: 2 of 24');
    expect(renderCardBody('lesson_report', { ...base, lessonTotal: 24 }, 'ar')).toContain('رقم الحصة: 2 من 24');
    expect(renderCardBody('lesson_report', base, 'en')).toContain('Lesson no.: 2');
    expect(renderCardBody('lesson_report', base, 'en')).not.toContain(' of ');
  });

  it('grace, locked, paused and back-on cards', () => {
    expect(renderCardBody('subscription_grace', { learnerName: 'Adam', graceLeft: 2 }, 'en')).toContain('2 grace lessons left');
    expect(renderCardBody('subscription_grace', { learnerName: 'Adam', graceLeft: 1 }, 'en')).toContain('1 grace lesson left');
    const locked = renderCardBody('subscription_locked', {
      learnerName: 'Adam', reasons: ['balance', 'overdue'], instalmentLabel: 'Term · 2/3', overdueSince: '2026-10-27',
    }, 'en');
    expect(locked).toContain("Adam's lessons are paused");
    expect(locked).toContain('used up');
    expect(locked).toContain('Instalment Term · 2/3 overdue since 2026-10-27');
    // The group's card carries nothing financial: the teacher reads the group.
    const paused = renderCardBody('lessons_paused', { learnerName: 'Adam' }, 'en');
    expect(paused).toBe("⏸️ Adam's lessons are paused.");
    expect(renderCardBody('subscription_unlocked', { learnerName: 'Adam' }, 'ar')).toContain('عادت حصص Adam');
  });

  it('the pay page shows the package as "3 months — 24 lessons"', () => {
    const model: PayPageModel = {
      status: 'open', payerName: 'P', childFirstName: 'Adam', label: 'Renewal', purpose: 'renewal', planMonths: 3,
      lessonsIncluded: 24, periodStart: null, periodEnd: null, amountMinor: 100, paidMinor: 0, remainingMinor: 100,
    } as PayPageModel;
    const ctx = { token: 't', nonce: 'n' };
    expect(renderPayPage({ ...model, currency: 'AED' } as PayPageModel, 'en', ctx)).toContain('3 months — 24 lessons');
    expect(renderPayPage({ ...model, currency: 'AED' } as PayPageModel, 'ar', ctx)).toContain('3 أشهر — 24 حصة');
  });
});

describe('PD-30 — the SUBSCRIPTION_LOCK_ENFORCED switch', () => {
  const inherited = process.env.SUBSCRIPTION_LOCK_ENFORCED;
  afterAll(() => {
    if (inherited === undefined) delete process.env.SUBSCRIPTION_LOCK_ENFORCED;
    else process.env.SUBSCRIPTION_LOCK_ENFORCED = inherited;
  });
  it.each(['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', ' true '])('%p is on', (v) => {
    process.env.SUBSCRIPTION_LOCK_ENFORCED = v;
    expect(subscriptionLockEnforced()).toBe(true);
  });
  it.each(['false', '0', 'no', '', 'enforced', 'off'])('%p is off', (v) => {
    process.env.SUBSCRIPTION_LOCK_ENFORCED = v;
    expect(subscriptionLockEnforced()).toBe(false);
  });
  it('unset is off', () => {
    delete process.env.SUBSCRIPTION_LOCK_ENFORCED;
    expect(subscriptionLockEnforced()).toBe(false);
  });
});
