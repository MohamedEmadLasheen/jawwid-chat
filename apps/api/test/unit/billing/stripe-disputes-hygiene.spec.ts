/**
 * W59: Stripe disputes (M2), cross-talk hygiene with other systems on the same
 * Stripe account (S3), and no child's name on Stripe (S6).
 * docs/admin/pd027-stripe-lifecycle.md §3.2 and §4.
 *
 * The pure parts, and CheckoutService.handleEvent over an in-memory Prisma and
 * Stripe: which outcome each event gets, that a dispute is audited once and
 * never touches the money ledger, and that objects Chat did not create are
 * recorded as not_chat and never acted on.
 */
import type Stripe from 'stripe';
import {
  CHAT_STRIPE_SYSTEM,
  checkoutCreateParams,
  checkoutMetadata,
  toDisputeFacts,
  type CheckoutInput,
} from '../../../src/billing/stripe.gateway';
import { CheckoutService, checkoutProductName, disputeOutcome } from '../../../src/billing/checkout.service';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const FAMILY = '00000000-0000-4000-8000-0000000000f1';
const PAYMENT = '00000000-0000-4000-8000-0000000000b1';
const REQUEST = '00000000-0000-4000-8000-0000000000c1';

describe('S3: every Checkout Session Chat opens says it is Chat\'s', () => {
  const input: CheckoutInput = {
    requestId: REQUEST, organizationId: ORG, amountMinor: 150000, currency: 'AED', productName: 'Quran — renewal', description: null,
    successUrl: 'https://x/s', cancelUrl: 'https://x/c', expiresAt: new Date(1_900_000_000_000), locale: 'ar', idempotencyKey: 'k',
  };

  it('the session and its payment intent both carry system jawwid-chat, beside the request and academy ids', () => {
    const params = checkoutCreateParams(input);
    const expected = { system: 'jawwid-chat', paymentRequestId: REQUEST, organizationId: ORG };
    expect(CHAT_STRIPE_SYSTEM).toBe('jawwid-chat');
    expect(checkoutMetadata(input)).toEqual(expected);
    expect(params.metadata).toEqual(expected);
    expect(params.payment_intent_data?.metadata).toEqual(expected);
    // Two objects, so a later change to one can never silently change the other.
    expect(params.payment_intent_data?.metadata).not.toBe(params.metadata);
  });

  it('keeps everything else as before: amount, currency, locale, product name', () => {
    const params = checkoutCreateParams(input);
    expect(params.mode).toBe('payment');
    expect(params.client_reference_id).toBe(REQUEST);
    expect(params.locale).toBe('auto');
    expect(params.line_items?.[0]?.price_data).toMatchObject({ currency: 'aed', unit_amount: 150000, product_data: { name: 'Quran — renewal' } });
    expect(params.customer).toBeUndefined();
    expect(checkoutCreateParams({ ...input, customerId: 'cus_A1' }).customer).toBe('cus_A1');
  });
});

describe('S6: the Stripe line item never carries the child\'s name', () => {
  it('is the request\'s label only', () => {
    expect(checkoutProductName({ label: 'Quran — renewal', childName: 'Amina Example-Surname' } as { label: string })).toBe('Quran — renewal');
    expect(checkoutProductName({ label: '  3-month subscription  ' })).toBe('3-month subscription');
  });

  it('a blank label falls back to the generic lessons line', () => {
    expect(checkoutProductName({ label: '   ' })).toBe('Live one-to-one Quran lessons');
  });
});

describe('M2: dispute outcomes', () => {
  it('maps each charge.dispute event', () => {
    expect(disputeOutcome('charge.dispute.created', 'needs_response')).toBe('dispute_opened');
    expect(disputeOutcome('charge.dispute.updated', 'under_review')).toBe('dispute_updated');
    expect(disputeOutcome('charge.dispute.funds_withdrawn', 'needs_response')).toBe('dispute_funds_withdrawn');
    expect(disputeOutcome('charge.dispute.funds_reinstated', 'won')).toBe('dispute_funds_reinstated');
    expect(disputeOutcome('charge.dispute.closed', 'won')).toBe('dispute_closed_won');
    expect(disputeOutcome('charge.dispute.closed', 'lost')).toBe('dispute_closed_lost');
    expect(disputeOutcome('charge.dispute.closed', 'warning_closed')).toBe('dispute_closed_warning_closed');
  });

  it('a closed status Chat cannot trust reads as unknown; every outcome stays a valid webhook-log filter', () => {
    expect(disputeOutcome('charge.dispute.closed', null)).toBe('dispute_closed_unknown');
    expect(disputeOutcome('charge.dispute.closed', 'Won; DROP')).toBe('dispute_closed_unknown');
    expect(disputeOutcome('charge.dispute.closed', 'x'.repeat(26))).toBe('dispute_closed_unknown');
    expect(disputeOutcome('charge.dispute.closed', 'y'.repeat(25))).toMatch(/^[a-z_]{1,40}$/);
  });

  it('toDisputeFacts reads ids (string or expanded) and codes only', () => {
    const d = toDisputeFacts({
      id: 'du_1', object: 'dispute', amount: 5000, currency: 'aed', charge: { id: 'ch_A1' }, payment_intent: 'pi_A1',
      status: 'needs_response', reason: 'fraudulent', evidence: { customer_name: 'Someone' },
    } as unknown as Stripe.Dispute);
    expect(d).toEqual({ id: 'du_1', chargeId: 'ch_A1', paymentIntentId: 'pi_A1', amountMinor: 5000, currency: 'AED', status: 'needs_response', reason: 'fraudulent' });
    const odd = toDisputeFacts({ id: 'du_2', object: 'dispute', charge: 'bad id', payment_intent: null, status: 'Weird Status', reason: null } as unknown as Stripe.Dispute);
    expect(odd).toMatchObject({ chargeId: null, paymentIntentId: null, amountMinor: 0, currency: null, status: null, reason: null });
  });
});

// ---- CheckoutService.handleEvent over an in-memory Prisma and Stripe --------------------------

interface World {
  payments: Array<Record<string, unknown>>;
  checkouts: Array<{ stripeSessionId: string; organizationId: string; requestId: string; stripePaymentIntentId: string | null }>;
  requests: Array<Record<string, unknown>>;
  stripeSessions: Array<{ id: string; paymentIntentId: string; metadata?: Record<string, string> }>;
  /** metadata.system on payment intents Stripe knows (by id). */
  intentSystems?: Record<string, string>;
  checkoutAvailable?: boolean;
  stripeDown?: boolean;
}

function service(world: World) {
  const events: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const insertEvents = async ({ data }: { data: Array<Record<string, unknown>> }) => {
    const fresh = data.filter((d) => !events.some((e) => e.id === d.id));
    events.push(...fresh);
    return { count: fresh.length };
  };
  const tx = { stripeEvent: { createMany: jest.fn(insertEvents) } };
  // Only what these paths may touch: any ledger write (payment.update, paymentRefund.*) would throw.
  const prisma = {
    stripeEvent: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => events.find((e) => e.id === where.id) ?? null),
      createMany: jest.fn(insertEvents),
    },
    payment: {
      findUnique: jest.fn(async ({ where }: { where: { stripePaymentIntentId?: string; stripeChargeId?: string } }) =>
        world.payments.find((p) =>
          (where.stripePaymentIntentId !== undefined && p.stripePaymentIntentId === where.stripePaymentIntentId) ||
          (where.stripeChargeId !== undefined && p.stripeChargeId === where.stripeChargeId)) ?? null),
    },
    paymentCheckout: {
      findFirst: jest.fn(async ({ where }: { where: { stripePaymentIntentId: string } }) =>
        world.checkouts.find((c) => c.stripePaymentIntentId === where.stripePaymentIntentId) ?? null),
      findUnique: jest.fn(async ({ where }: { where: { stripeSessionId: string } }) =>
        world.checkouts.find((c) => c.stripeSessionId === where.stripeSessionId) ?? null),
    },
    paymentRequest: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => world.requests.find((r) => r.id === where.id) ?? null),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const stripe = {
    checkoutAvailable: world.checkoutAvailable ?? true,
    findCheckoutByPaymentIntent: jest.fn(async (pi: string) => {
      if (world.stripeDown) throw Object.assign(new Error('connect ETIMEDOUT'), { type: 'StripeConnectionError' });
      const s = world.stripeSessions.find((x) => x.paymentIntentId === pi);
      return s ? { id: s.id, paymentIntentId: s.paymentIntentId, metadata: s.metadata ?? {} } : null;
    }),
    paymentIntentSystem: jest.fn(async (pi: string) => {
      if (world.stripeDown) throw Object.assign(new Error('connect ETIMEDOUT'), { type: 'StripeConnectionError' });
      return world.intentSystems?.[pi] ?? null;
    }),
  };
  const audit = { audit: jest.fn(async (_tx: unknown, input: Record<string, unknown>) => { audits.push(input); }), event: jest.fn() };
  const ledger = new Proxy({}, { get: () => { throw new Error('the money ledger must not be touched'); } });
  const svc = new CheckoutService(prisma as never, ledger as never, stripe as never, audit as never);
  return { svc, events, audits, prisma, stripe };
}

let n = 0;
function event(type: string, object: Record<string, unknown>): Stripe.Event {
  return { id: `evt_unit_${++n}`, object: 'event', type, livemode: false, created: 1_800_000_000, data: { object } } as unknown as Stripe.Event;
}
const dispute = (over: Record<string, unknown> = {}) => ({
  id: 'du_U1', object: 'dispute', amount: 120000, currency: 'aed', charge: 'ch_U1', payment_intent: 'pi_U1', status: 'needs_response', reason: 'fraudulent', ...over,
});
const recordedPayment = { id: PAYMENT, organizationId: ORG, familyId: FAMILY, trialLessonId: null, requestId: REQUEST, stripePaymentIntentId: 'pi_U1', stripeChargeId: 'ch_U1', method: 'card' };
const empty = (): World => ({ payments: [], checkouts: [], requests: [], stripeSessions: [] });

describe('CheckoutService: disputes on Chat\'s payments are flagged and audited, never booked', () => {
  it.each([
    ['charge.dispute.created', 'needs_response', 'dispute_opened', 'payment.dispute_opened'],
    ['charge.dispute.updated', 'under_review', 'dispute_updated', 'payment.dispute_updated'],
    ['charge.dispute.funds_withdrawn', 'needs_response', 'dispute_funds_withdrawn', 'payment.dispute_funds_withdrawn'],
    ['charge.dispute.funds_reinstated', 'won', 'dispute_funds_reinstated', 'payment.dispute_funds_reinstated'],
    ['charge.dispute.closed', 'lost', 'dispute_closed_lost', 'payment.dispute_closed'],
  ])('%s (%s) -> %s, one audit row %s', async (type, status, outcome, action) => {
    const { svc, events, audits } = service({ ...empty(), payments: [recordedPayment] });
    const ev = event(type, dispute({ status }));
    expect(await svc.handleEvent(ev)).toBe(outcome);
    expect(events).toEqual([expect.objectContaining({ id: ev.id, type, outcome, organizationId: ORG, objectId: 'du_U1', paymentIntentId: 'pi_U1' })]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action, entity: 'family', entityId: FAMILY,
      after: { paymentId: PAYMENT, requestId: REQUEST, disputeId: 'du_U1', chargeId: 'ch_U1', amountMinor: 120000, currency: 'AED', stripeStatus: status, stripeReason: 'fraudulent', outcome },
    });
    // A redelivery does nothing more.
    expect(await svc.handleEvent(ev)).toBe('duplicate');
    expect(audits).toHaveLength(1);
  });

  it('matches by the charge when the dispute has no payment intent', async () => {
    const { svc, audits } = service({ ...empty(), payments: [recordedPayment] });
    expect(await svc.handleEvent(event('charge.dispute.created', dispute({ payment_intent: null })))).toBe('dispute_opened');
    expect(audits[0]).toMatchObject({ entityId: FAMILY, after: { paymentId: PAYMENT } });
  });

  it('a dispute on a Chat checkout whose payment is not recorded yet is still flagged, against its request', async () => {
    const { svc, events, audits } = service({
      ...empty(),
      checkouts: [{ stripeSessionId: 'cs_U1', organizationId: ORG, requestId: REQUEST, stripePaymentIntentId: null }],
      requests: [{ id: REQUEST, organizationId: ORG, familyId: FAMILY, trialLessonId: null }],
      stripeSessions: [{ id: 'cs_U1', paymentIntentId: 'pi_U1' }],
    });
    expect(await svc.handleEvent(event('charge.dispute.created', dispute()))).toBe('dispute_opened');
    expect(events[0]).toMatchObject({ organizationId: ORG });
    expect(audits[0]).toMatchObject({ entityId: FAMILY, after: { paymentId: null, requestId: REQUEST } });
  });

  it('a dispute on a payment Chat did not take is not_chat: no audit, no academy, nothing else', async () => {
    const { svc, events, audits, prisma } = service(empty());
    expect(await svc.handleEvent(event('charge.dispute.created', dispute()))).toBe('not_chat');
    expect(await svc.handleEvent(event('charge.dispute.funds_withdrawn', dispute({ payment_intent: null, charge: 'ch_Other' })))).toBe('not_chat');
    expect(events.map((e) => [e.outcome, e.organizationId ?? null])).toEqual([['not_chat', null], ['not_chat', null]]);
    expect(audits).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('Stripe unreachable while classifying an unmatched dispute: the webhook fails (Stripe retries), nothing is recorded', async () => {
    const { svc, events, audits } = service({ ...empty(), stripeDown: true });
    const ev = event('charge.dispute.created', dispute());
    await expect(svc.handleEvent(ev)).rejects.toThrow('connect ETIMEDOUT');
    expect(events).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('a session Stripe knows for the intent but Chat never opened is not Chat\'s', async () => {
    const { svc, audits } = service({ ...empty(), stripeSessions: [{ id: 'cs_OtherSystem', paymentIntentId: 'pi_U1' }] });
    expect(await svc.handleEvent(event('charge.dispute.created', dispute()))).toBe('not_chat');
    expect(audits).toHaveLength(0);
  });
});

describe('CheckoutService: refunds Chat cannot match', () => {
  const refund = (pi: string | null) => ({ id: 're_U1', object: 'refund', amount: 5000, payment_intent: pi, status: 'succeeded', metadata: {} });

  it('a refund (or charge.refunded) on a payment Chat did not take is not_chat, not refund_deferred', async () => {
    const { svc, events } = service(empty());
    expect(await svc.handleEvent(event('refund.created', refund('pi_Other1')))).toBe('not_chat');
    expect(await svc.handleEvent(event('charge.refunded', { id: 'ch_Other1', object: 'charge', payment_intent: 'pi_Other1' }))).toBe('not_chat');
    expect(await svc.handleEvent(event('refund.created', refund(null)))).toBe('not_chat');
    expect(events.every((e) => e.outcome === 'not_chat' && !e.organizationId)).toBe(true);
  });

  it('a refund on Chat\'s checkout that arrived before its payment is kept (refund_deferred), with its academy', async () => {
    const { svc, events } = service({
      ...empty(),
      checkouts: [{ stripeSessionId: 'cs_U2', organizationId: ORG, requestId: REQUEST, stripePaymentIntentId: null }],
      stripeSessions: [{ id: 'cs_U2', paymentIntentId: 'pi_U2' }],
    });
    expect(await svc.handleEvent(event('refund.created', refund('pi_U2')))).toBe('refund_deferred');
    expect(events[0]).toMatchObject({ outcome: 'refund_deferred', organizationId: ORG, paymentIntentId: 'pi_U2' });
  });

  it('known locally (a declined attempt saved the intent): deferred without asking Stripe', async () => {
    const { svc, stripe } = service({ ...empty(), checkouts: [{ stripeSessionId: 'cs_U3', organizationId: ORG, requestId: REQUEST, stripePaymentIntentId: 'pi_U3' }] });
    expect(await svc.handleEvent(event('refund.created', refund('pi_U3')))).toBe('refund_deferred');
    expect(stripe.findCheckoutByPaymentIntent).not.toHaveBeenCalled();
  });

  it('a Chat-tagged payment intent with no session Stripe lists is kept (refund_deferred) with a warning, never not_chat', async () => {
    const { svc, events, stripe } = service({ ...empty(), intentSystems: { pi_U5: CHAT_STRIPE_SYSTEM } });
    const warn = jest.spyOn((svc as unknown as { log: { warn: (m: string) => void } }).log, 'warn').mockImplementation(() => undefined);
    expect(await svc.handleEvent(event('refund.created', refund('pi_U5')))).toBe('refund_deferred');
    expect(await svc.handleEvent(event('charge.refunded', { id: 'ch_U5', object: 'charge', payment_intent: 'pi_U5' }))).toBe('refund_deferred');
    expect(events.map((e) => [e.outcome, e.paymentIntentId, e.organizationId ?? null])).toEqual([
      ['refund_deferred', 'pi_U5', null],
      ['refund_deferred', 'pi_U5', null],
    ]);
    expect(stripe.paymentIntentSystem).toHaveBeenCalledWith('pi_U5');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toMatch(/tagged jawwid-chat has no Chat checkout; kept as deferred/);
  });

  it('a Chat-tagged session Chat has no row for is kept (refund_deferred) without asking for the payment intent', async () => {
    const { svc, stripe } = service({ ...empty(), stripeSessions: [{ id: 'cs_U6', paymentIntentId: 'pi_U6', metadata: { system: CHAT_STRIPE_SYSTEM } }] });
    const warn = jest.spyOn((svc as unknown as { log: { warn: (m: string) => void } }).log, 'warn').mockImplementation(() => undefined);
    expect(await svc.handleEvent(event('refund.created', refund('pi_U6')))).toBe('refund_deferred');
    expect(stripe.paymentIntentSystem).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('an untagged foreign payment intent (another system\'s tag, or none) is not_chat, with no warning', async () => {
    const { svc, events } = service({
      ...empty(),
      intentSystems: { pi_Other7: 'recurring-billing' },
      stripeSessions: [{ id: 'cs_Other8', paymentIntentId: 'pi_Other8', metadata: { system: 'other' } }],
    });
    const warn = jest.spyOn((svc as unknown as { log: { warn: (m: string) => void } }).log, 'warn').mockImplementation(() => undefined);
    expect(await svc.handleEvent(event('refund.created', refund('pi_Other7')))).toBe('not_chat');
    expect(await svc.handleEvent(event('refund.created', refund('pi_Other8')))).toBe('not_chat');
    expect(await svc.handleEvent(event('refund.created', refund('pi_Other9')))).toBe('not_chat');
    expect(events.every((e) => e.outcome === 'not_chat' && !e.organizationId)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('the tag never makes a dispute Chat\'s: a tagged intent with no Chat checkout stays not_chat', async () => {
    const { svc, audits } = service({ ...empty(), intentSystems: { pi_U1: CHAT_STRIPE_SYSTEM } });
    expect(await svc.handleEvent(event('charge.dispute.created', dispute()))).toBe('not_chat');
    expect(audits).toHaveLength(0);
  });

  it('when Chat cannot tell (no key, or Stripe unreachable) the refund is kept, never dropped', async () => {
    expect(await service({ ...empty(), checkoutAvailable: false }).svc.handleEvent(event('refund.created', refund('pi_U4')))).toBe('refund_deferred');
    expect(await service({ ...empty(), stripeDown: true }).svc.handleEvent(event('refund.created', refund('pi_U4')))).toBe('refund_deferred');
  });
});

describe('CheckoutService: Stripe Billing (recurring) events stay ignored_not_chat', () => {
  it.each(['invoice.paid', 'customer.subscription.updated', 'subscription_schedule.created'])('%s', async (type) => {
    const { svc, events, audits } = service(empty());
    expect(await svc.handleEvent(event(type, { id: 'in_1', object: 'invoice' }))).toBe('ignored_not_chat');
    expect(events[0]).toMatchObject({ outcome: 'ignored_not_chat' });
    expect(audits).toHaveLength(0);
  });
});
