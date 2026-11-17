/**
 * Stripe launch (LR-34): two properties of Chat's webhook endpoint on the SHARED Stripe account.
 *
 * 1. API version. The Dashboard shows Chat's endpoint on the account default (2020-08-27 at launch),
 *    while the SDK pins 2026-09-30.endive for every call Chat makes. An endpoint's version only changes
 *    the shape of the payloads Stripe POSTs; Chat's handlers read a small set of stable fields from them
 *    (ids, status, amount, currency, metadata, decline code) and fetch everything else (the charge, the
 *    card, the refunds) with an SDK call. These tests feed the handlers the payload shape of BOTH versions
 *    and require the same facts, so either endpoint version is safe, and a later change of the account
 *    default cannot silently break recording.
 *
 * 2. Core on the same account. Stripe sends Chat's endpoint every subscribed event on the account,
 *    including events about objects Jawwid Core created. Each of the 15 events, about an object Chat did
 *    not create, must end as unknown_session / ignored / not_chat: no payment, no refund, no audit, no
 *    academy, and never a write to the money ledger.
 *
 * Pure: an in-memory Prisma and Stripe, as in stripe-disputes-hygiene.spec.ts.
 */
import type Stripe from 'stripe';
import { toDisputeFacts, toRefundFacts, toSession } from '../../../src/billing/stripe.gateway';
import { CheckoutService } from '../../../src/billing/checkout.service';

const ORG = '00000000-0000-4000-8000-0000000000a1';

// ---- 1. the same facts from both API versions' payloads ----------------------------------------

/** Checkout Session as 2020-08-27 delivers it, and as 2026-09-30 does (extra fields only). */
const sessionLegacy = {
  id: 'cs_live_A1', object: 'checkout.session', url: null, status: 'complete', payment_status: 'paid', amount_total: 150000,
  currency: 'aed', payment_intent: 'pi_A1', customer: 'cus_A1', expires_at: 1_800_000_000,
  metadata: { system: 'jawwid-chat', paymentRequestId: 'req_1', organizationId: ORG },
};
const sessionCurrent = { ...sessionLegacy, adaptive_pricing: null, collected_information: { shipping_details: null }, branding_settings: {} };

const refundLegacy = { id: 're_A1', object: 'refund', amount: 5000, currency: 'aed', charge: 'ch_A1', payment_intent: 'pi_A1', status: 'succeeded', reason: null, metadata: { by: 'staff' } };
const refundCurrent = { ...refundLegacy, destination_details: { type: 'card', card: { type: 'refund' } }, instructions_email: null };

const disputeLegacy = { id: 'du_A1', object: 'dispute', amount: 150000, currency: 'aed', charge: 'ch_A1', payment_intent: 'pi_A1', status: 'needs_response', reason: 'fraudulent', evidence: {} };
const disputeCurrent = { ...disputeLegacy, enhanced_eligibility_types: [], payment_method_details: { type: 'card', card: { brand: 'visa' } } };

describe('webhook payloads: the facts Chat reads are the same in 2020-08-27 and 2026-09-30 shapes', () => {
  it.each([['2020-08-27', sessionLegacy], ['2026-09-30', sessionCurrent]])('checkout session (%s)', (_v, s) => {
    expect(toSession(s as unknown as Stripe.Checkout.Session)).toEqual({
      id: 'cs_live_A1', url: null, status: 'complete', paymentStatus: 'paid', amountTotal: 150000, currency: 'AED', paymentIntentId: 'pi_A1',
      metadata: sessionLegacy.metadata, expiresAt: new Date(1_800_000_000_000), customerId: 'cus_A1',
    });
  });

  it.each([['2020-08-27', refundLegacy], ['2026-09-30', refundCurrent]])('refund (%s)', (_v, r) => {
    expect(toRefundFacts(r as unknown as Stripe.Refund)).toEqual({ id: 're_A1', amountMinor: 5000, status: 'succeeded', paymentIntentId: 'pi_A1', reason: null, metadata: { by: 'staff' } });
  });

  it.each([['2020-08-27', disputeLegacy], ['2026-09-30', disputeCurrent]])('dispute (%s)', (_v, d) => {
    expect(toDisputeFacts(d as unknown as Stripe.Dispute)).toEqual({
      id: 'du_A1', chargeId: 'ch_A1', paymentIntentId: 'pi_A1', amountMinor: 150000, currency: 'AED', status: 'needs_response', reason: 'fraudulent',
    });
  });
});

// ---- 2. events about objects Chat did not create ------------------------------------------------

function service() {
  const events: Array<Record<string, unknown>> = [];
  const audits: unknown[] = [];
  const insert = async ({ data }: { data: Array<Record<string, unknown>> }) => {
    const fresh = data.filter((d) => !events.some((e) => e.id === d.id));
    events.push(...fresh);
    return { count: fresh.length };
  };
  const prisma = {
    stripeEvent: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => events.find((e) => e.id === where.id) ?? null), createMany: jest.fn(insert) },
    payment: { findUnique: jest.fn(async () => null) },
    paymentCheckout: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 0 })) },
    paymentRequest: { findUnique: jest.fn(async () => null) },
    $transaction: jest.fn(),
  };
  const stripe = {
    checkoutAvailable: true,
    findCheckoutByPaymentIntent: jest.fn(async () => null),
    // Stripe knows the intent, tagged by Core (not Chat).
    paymentIntentSystem: jest.fn(async () => 'jawwid'),
  };
  const audit = { audit: jest.fn(async (...a: unknown[]) => { audits.push(a); }), event: jest.fn() };
  const ledger = new Proxy({}, { get: () => { throw new Error('the money ledger must not be touched'); } });
  const svc = new CheckoutService(prisma as never, ledger as never, stripe as never, audit as never);
  return { svc, events, audits, prisma, stripe };
}

let n = 0;
const ev = (type: string, object: Record<string, unknown>): Stripe.Event =>
  ({ id: `evt_core_${++n}`, object: 'event', type, livemode: true, created: 1_800_000_000, api_version: '2020-08-27', data: { object } }) as unknown as Stripe.Event;

const CORE = { system: 'jawwid', userId: '42', packageId: '7', classesNum: '8' };
const coreSession = { id: 'cs_live_CORE', object: 'checkout.session', status: 'complete', payment_status: 'paid', amount_total: 90000, currency: 'aed', payment_intent: 'pi_CORE', metadata: CORE, expires_at: 1_800_000_000 };
const coreIntent = { id: 'pi_CORE', object: 'payment_intent', status: 'succeeded', currency: 'aed', amount_received: 90000, metadata: CORE, last_payment_error: { code: 'card_declined', decline_code: 'generic_decline' } };
const coreRefund = { id: 're_CORE', object: 'refund', amount: 90000, currency: 'aed', charge: 'ch_CORE', payment_intent: 'pi_CORE', status: 'succeeded', reason: null, metadata: CORE };
const coreCharge = { id: 'ch_CORE', object: 'charge', payment_intent: 'pi_CORE', amount_refunded: 90000, metadata: CORE };
const coreDispute = { id: 'du_CORE', object: 'dispute', amount: 90000, currency: 'aed', charge: 'ch_CORE', payment_intent: 'pi_CORE', status: 'needs_response', reason: 'fraudulent' };

describe("Core's events on the shared account never act on Chat's data", () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ['checkout.session.completed', 'unknown_session', coreSession],
    ['checkout.session.async_payment_succeeded', 'unknown_session', coreSession],
    ['checkout.session.async_payment_failed', 'checkout_failed', coreSession],
    ['checkout.session.expired', 'checkout_expired', coreSession],
    ['payment_intent.succeeded', 'ignored', coreIntent],
    ['payment_intent.payment_failed', 'ignored', coreIntent],
    ['refund.created', 'not_chat', coreRefund],
    ['refund.updated', 'not_chat', coreRefund],
    ['refund.failed', 'not_chat', coreRefund],
    ['charge.refunded', 'not_chat', coreCharge],
    ['charge.dispute.created', 'not_chat', coreDispute],
    ['charge.dispute.updated', 'not_chat', coreDispute],
    ['charge.dispute.closed', 'not_chat', coreDispute],
    ['charge.dispute.funds_withdrawn', 'not_chat', coreDispute],
    ['charge.dispute.funds_reinstated', 'not_chat', coreDispute],
    // Not subscribed by Chat's endpoint, but a wider subscription must stay harmless.
    ['invoice.paid', 'ignored_not_chat', { id: 'in_CORE', object: 'invoice', metadata: CORE }],
    ['customer.subscription.updated', 'ignored_not_chat', { id: 'sub_CORE', object: 'subscription', metadata: CORE }],
  ];

  it.each(cases)('%s -> %s, one event row, no payment, no audit, no ledger', async (type, outcome, object) => {
    const { svc, events, audits, prisma } = service();
    const e = ev(type, object);
    expect(await svc.handleEvent(e)).toBe(outcome);
    expect(events).toEqual([expect.objectContaining({ id: e.id, type, outcome, livemode: true })]);
    // No organization is attached to a foreign object's row.
    expect(events[0]).not.toHaveProperty('organizationId');
    expect(audits).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // At most a no-op status update keyed by the foreign session id (nothing matches it); never a create/delete.
    const marksSession = type === 'checkout.session.async_payment_failed' || type === 'checkout.session.expired';
    expect(prisma.paymentCheckout.updateMany).toHaveBeenCalledTimes(marksSession ? 1 : 0);
    if (marksSession) expect(prisma.paymentCheckout.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { stripeSessionId: 'cs_live_CORE', status: 'open' } }));
    // Redelivery of the same event does nothing more.
    expect(await svc.handleEvent(e)).toBe('duplicate');
    expect(events).toHaveLength(1);
  });
});
