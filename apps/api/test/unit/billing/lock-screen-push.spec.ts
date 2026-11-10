/**
 * The lock screen of family notices scheduled outside the PD-34 pipeline:
 * PD-30's subscription pushes and PD-27's "payment received". The push names
 * the generic template ("Jawwid" / "You have a new notification.", no
 * variables) unless the recipient turned lock-screen names on; the delivery
 * row keeps its event type, dedupe key and variables, from which the Center
 * entry (behind sign-in) is rendered with the details, as before.
 *
 * The receipt-rejected push (a staff member's free text) is always generic:
 * pd027-payments-http.spec.ts renders it.
 */
import type { PrismaService } from '@platform/prisma.service';
import type { NotificationService, ScheduleInput } from '@communication/notifications/notification.service';
import { GENERIC_PUSH_TEMPLATE, lockScreenTemplate } from '../../../src/billing/lock-screen-push';
import { PaymentLedger, type RecordedPayment } from '../../../src/billing/payment-ledger.service';
import { SubscriptionEffects } from '../../../src/subscriptions/subscription-effects.service';
import type { NotificationPipeline } from '@communication/notifications/notification-pipeline.service';

const PARENT = '11111111-1111-4111-8111-111111111111';
const SUPERVISOR = '22222222-2222-4222-8222-222222222222';
const FAMILY = '33333333-3333-4333-8333-333333333333';
const LEARNER = '44444444-4444-4444-8444-444444444444';

function namesOn(on: Set<string>): NotificationPipeline {
  return { showsNames: jest.fn(async (id: string) => on.has(id)) } as unknown as NotificationPipeline;
}

function scheduler(): { service: NotificationService; calls: ScheduleInput[] } {
  const calls: ScheduleInput[] = [];
  const service = { schedule: jest.fn(async (input: ScheduleInput) => { calls.push(input); return 'delivery'; }) };
  return { service: service as unknown as NotificationService, calls };
}

function prisma(): PrismaService {
  return {
    contact: { findMany: jest.fn(async () => [{ id: PARENT }]) },
    family: { findUnique: jest.fn(async () => ({ language: 'en' })) },
    $queryRaw: jest.fn(async () => [{ id: SUPERVISOR }]),
  } as unknown as PrismaService;
}

describe('lockScreenTemplate', () => {
  it('is the generic template unless the recipient turned names on', async () => {
    const pipeline = namesOn(new Set([PARENT]));
    expect(await lockScreenTemplate(pipeline, PARENT, 'subscription_locked')).toBe('subscription_locked');
    expect(await lockScreenTemplate(pipeline, SUPERVISOR, 'subscription_locked')).toBe(GENERIC_PUSH_TEMPLATE);
  });

  it('is generic when there is no named variant (free text), even for names on', async () => {
    expect(await lockScreenTemplate(namesOn(new Set([PARENT])), PARENT, null)).toBe(GENERIC_PUSH_TEMPLATE);
  });

  it('is generic without a pipeline, or when the setting cannot be read', async () => {
    expect(await lockScreenTemplate(undefined, PARENT, 'subscription_locked')).toBe(GENERIC_PUSH_TEMPLATE);
    const broken = { showsNames: jest.fn(async () => { throw new Error('down'); }) } as unknown as NotificationPipeline;
    expect(await lockScreenTemplate(broken, PARENT, 'subscription_locked')).toBe(GENERIC_PUSH_TEMPLATE);
  });

  it('the generic template is the one PD-34 seeded without variables', () => {
    expect(GENERIC_PUSH_TEMPLATE).toBe('inbox.generic');
  });
});

describe('SubscriptionEffects pushes', () => {
  function effects(notifications: NotificationService, pipeline?: NotificationPipeline): SubscriptionEffects {
    const none = undefined as never;
    return new SubscriptionEffects(prisma(), none, none, none, notifications, none, none, none, pipeline);
  }
  const push = (e: SubscriptionEffects) =>
    (e as unknown as {
      pushFamily(d: string, l: { id: string; name: string; familyId: string }, t: string, v: Record<string, string>): Promise<void>;
    }).pushFamily('2026-11-01', { id: LEARNER, name: 'Adam Example', familyId: FAMILY }, 'subscription_locked', { reason: 'an instalment is overdue' });

  it('names-off recipients get the generic push; the row keeps the event, the dedupe key and the details for the Center', async () => {
    const { service, calls } = scheduler();
    await push(effects(service, namesOn(new Set())));
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.templateKey).toBe(GENERIC_PUSH_TEMPLATE);
      expect(c.eventType).toBe('subscription_locked');
      expect(c.dedupeKey).toBe(`subscription_locked:2026-11-01:${c.recipientId}`);
      expect(c.variables).toEqual({ learner: 'Adam Example', reason: 'an instalment is overdue' });
    }
  });

  it('a recipient who turned names on gets the detailed template; the other does not', async () => {
    const { service, calls } = scheduler();
    await push(effects(service, namesOn(new Set([PARENT]))));
    expect(Object.fromEntries(calls.map((c) => [c.recipientId, c.templateKey]))).toEqual({
      [PARENT]: 'subscription_locked',
      [SUPERVISOR]: GENERIC_PUSH_TEMPLATE,
    });
  });

  it('without a pipeline every push is generic', async () => {
    const { service, calls } = scheduler();
    await push(effects(service));
    expect(calls.map((c) => c.templateKey)).toEqual([GENERIC_PUSH_TEMPLATE, GENERIC_PUSH_TEMPLATE]);
  });
});

describe('PaymentLedger "payment received" push', () => {
  const recorded = {
    payment: { id: 'pay-1', familyId: FAMILY, amountMinor: 150000n, currency: 'AED' },
    invoice: { number: 'INV-2026-0001' },
    settledInstalmentId: null,
  } as unknown as RecordedPayment;
  const audit = undefined as never;

  it('the amount and invoice number stay off a names-off lock screen, and stay on the row for the Center', async () => {
    const { service, calls } = scheduler();
    await new PaymentLedger(prisma(), audit, service, undefined, namesOn(new Set())).afterRecorded(recorded);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      templateKey: GENERIC_PUSH_TEMPLATE,
      eventType: 'payment_received',
      dedupeKey: `payment_received:pay-1:${PARENT}`,
      variables: { amount: '1,500.00', currency: 'AED', invoice_number: 'INV-2026-0001' },
    });
  });

  it('names on: the detailed template, as payment reminders do', async () => {
    const { service, calls } = scheduler();
    await new PaymentLedger(prisma(), audit, service, undefined, namesOn(new Set([PARENT]))).afterRecorded(recorded);
    expect(calls[0]!.templateKey).toBe('payment_received');
  });
});
