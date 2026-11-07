/**
 * PD-27 completion, the pure parts (docs/admin/pd027-stripe-lifecycle.md):
 * the database's patterns applied before a write, the payment-intent facts, the
 * parent's decline wording, the transaction filters and cursors.
 */
import type Stripe from 'stripe';
import { safe, toIntentFacts, toRefundFacts, StripeSdkGateway } from '../../../src/billing/stripe.gateway';
import { cardFailureKind, cardFailureText } from '../../../src/billing/card-failure';
import { encodeCursor, parseCursor, parseTransactionFilters, transactionStatus } from '../../../src/billing/transactions.service';
import { errorCategory } from '../../../src/billing/checkout.service';
import { CommError } from '../../../src/platform/errors';

describe('safe: a value Stripe sends that the database would refuse is dropped, never inserted', () => {
  it('accepts real Stripe id shapes', () => {
    expect(safe.customer('cus_NffrFeUfNV2Hib')).toBe('cus_NffrFeUfNV2Hib');
    expect(safe.charge('ch_3MmlLrLkdIwHu7ix0snN0B15')).toBe('ch_3MmlLrLkdIwHu7ix0snN0B15');
    expect(safe.charge('py_3MmlLrLkdIwHu7ix0snN0B15')).toBe('py_3MmlLrLkdIwHu7ix0snN0B15');
    expect(safe.paymentIntent('pi_3MtwBwLkdIwHu7ix28a3tqPa')).toBe('pi_3MtwBwLkdIwHu7ix28a3tqPa');
    expect(safe.last4('4242')).toBe('4242');
    expect(safe.brand('eftpos_au')).toBe('eftpos_au');
    expect(safe.wallet('apple_pay')).toBe('apple_pay');
    expect(safe.failureCode('insufficient_funds')).toBe('insufficient_funds');
  });

  it('drops anything else -- so a webhook can never fail forever on a check constraint', () => {
    expect(safe.customer('cus_with space')).toBeNull();
    expect(safe.customer(null)).toBeNull();
    expect(safe.charge('re_123')).toBeNull();
    expect(safe.paymentIntent('pi_test_with_underscores')).toBeNull();
    expect(safe.last4('424')).toBeNull();
    expect(safe.last4('4242 4242 4242 4242')).toBeNull();
    expect(safe.brand('Visa')).toBeNull();
    expect(safe.failureCode('Your card was declined.')).toBeNull();
    expect(safe.failureCode('x'.repeat(65))).toBeNull();
    expect(safe.objectId('x'.repeat(256))).toBeNull();
    expect(safe.objectId('')).toBeNull();
  });
});

describe('toIntentFacts: brand, last 4 and wallet -- never more', () => {
  const pi = {
    id: 'pi_3Abc', status: 'succeeded', currency: 'usd', amount_received: 12000, customer: 'cus_Abc',
  } as unknown as Stripe.PaymentIntent;

  it('reads the charge, customer, method and refunded amount', () => {
    const charge = {
      id: 'ch_3Abc', amount_refunded: 2000,
      payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', wallet: { type: 'apple_pay' }, fingerprint: 'fp_secretish', exp_month: 4, exp_year: 2030 } },
    } as unknown as Stripe.Charge;
    const f = toIntentFacts(pi, charge);
    expect(f).toEqual({
      id: 'pi_3Abc', status: 'succeeded', currency: 'USD', amountReceivedMinor: 12000, amountRefundedMinor: 2000,
      chargeId: 'ch_3Abc', customerId: 'cus_Abc', methodType: 'card', cardBrand: 'visa', cardLast4: '4242', cardWallet: 'apple_pay',
    });
    // Nothing else of the card (fingerprint, expiry) is carried.
    expect(JSON.stringify(f)).not.toMatch(/fp_secretish|2030/);
  });

  it('without a charge (Stripe did not expand it) answers nulls, not a throw', () => {
    const f = toIntentFacts(pi, null);
    expect(f.chargeId).toBeNull();
    expect(f.cardLast4).toBeNull();
    expect(f.amountRefundedMinor).toBe(0);
  });
});

describe('toRefundFacts', () => {
  it('reads a refund whose payment_intent is an id or an expanded object', () => {
    expect(toRefundFacts({ id: 're_1', amount: 500, status: 'succeeded', payment_intent: 'pi_1', reason: null, metadata: {} } as unknown as Stripe.Refund))
      .toEqual({ id: 're_1', amountMinor: 500, status: 'succeeded', paymentIntentId: 'pi_1', reason: null, metadata: {} });
    expect(toRefundFacts({ id: 're_2', amount: 1, status: 'pending', payment_intent: { id: 'pi_2' }, metadata: null } as unknown as Stripe.Refund).paymentIntentId).toBe('pi_2');
  });
});

describe('StripeSdkGateway.livemode follows the key, never a guess', () => {
  it('live, test, none', () => {
    expect(new StripeSdkGateway({ STRIPE_SECRET_KEY: 'rk_live_x' } as NodeJS.ProcessEnv).livemode).toBe(true);
    expect(new StripeSdkGateway({ STRIPE_SECRET_KEY: 'sk_live_x' } as NodeJS.ProcessEnv).livemode).toBe(true);
    expect(new StripeSdkGateway({ STRIPE_SECRET_KEY: 'sk_test_x' } as NodeJS.ProcessEnv).livemode).toBe(false);
    expect(new StripeSdkGateway({} as NodeJS.ProcessEnv).livemode).toBeNull();
  });
});

describe('the parent is told why a card failed, in words they can act on', () => {
  it('maps Stripe codes; alarming ones read as a plain decline', () => {
    expect(cardFailureKind('insufficient_funds')).toBe('insufficient_funds');
    expect(cardFailureKind('expired_card')).toBe('expired_card');
    expect(cardFailureKind('invalid_cvc')).toBe('incorrect_cvc');
    expect(cardFailureKind('payment_intent_authentication_failure')).toBe('authentication');
    for (const code of ['stolen_card', 'lost_card', 'fraudulent', 'do_not_honor', 'unknown', null, undefined]) {
      expect(cardFailureKind(code)).toBe('declined');
    }
  });

  it('Arabic first, English too; always offers the next step', () => {
    expect(cardFailureText('insufficient_funds', 'ar')).toContain('لعدم كفاية الرصيد');
    expect(cardFailureText('insufficient_funds', 'ar')).toContain('التحويل البنكي');
    expect(cardFailureText('stolen_card', 'en')).toBe('Your last card payment did not go through: your bank declined the card. Try another card, or pay by bank transfer.');
    expect(cardFailureText('stolen_card', 'en')).not.toMatch(/stolen/i);
  });
});

describe('transaction filters', () => {
  it('defaults', () => {
    expect(parseTransactionFilters({})).toEqual({
      status: null, method: null, purpose: null, planMonths: null, from: null, to: null, familyId: null, q: null, cursor: null, limit: 50,
    });
  });

  it('accepts every documented filter', () => {
    const f = parseTransactionFilters({
      status: 'partially_refunded', method: 'card', purpose: 'renewal', planMonths: '3', from: '2026-10-01', to: '2026-10-31',
      familyId: '0b6c3c1e-6f4b-4b55-9a59-2d0c1f6f9a10', q: ' JW-2026 ', limit: '100',
    });
    expect(f).toMatchObject({ status: 'partially_refunded', method: 'card', purpose: 'renewal', planMonths: 3, from: '2026-10-01', to: '2026-10-31', q: 'JW-2026', limit: 100 });
  });

  it.each([
    [{ status: 'paid' }, 'status'],
    [{ method: 'crypto' }, 'method'],
    [{ purpose: 'gift' }, 'purpose'],
    [{ planMonths: '2' }, 'planMonths'],
    [{ from: '2026-13-01' }, 'from'],
    [{ to: '01/10/2026' }, 'to'],
    [{ from: '2026-11-02', to: '2026-11-01' }, 'from is after to'],
    [{ familyId: "1' or 1=1" }, 'familyId'],
    [{ q: 'x'.repeat(101) }, 'q'],
    [{ limit: '0' }, 'limit'],
    [{ limit: '101' }, 'limit'],
    [{ limit: '1.5' }, 'limit'],
    [{ cursor: 'not-a-cursor' }, 'cursor'],
    // Review finding: a decodable cursor whose id is not a payment's uuid is a 400, never a failed ::uuid cast (500).
    [{ cursor: Buffer.from('2026-11-07T00:00:00Z|not-a-uuid').toString('base64url') }, 'cursor'],
  ])('refuses %j (400 naming %s)', (query, name) => {
    let err: unknown;
    try {
      parseTransactionFilters(query as Record<string, unknown>);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CommError);
    expect((err as CommError).status).toBe(400);
    expect((err as CommError).message).toContain(name);
  });

  it('a cursor round-trips', () => {
    const at = new Date('2026-11-07T10:11:12.345Z');
    expect(parseCursor(encodeCursor(at, 'cs_test_a1|'.slice(0, 9)))).toEqual({ at: at.toISOString(), id: 'cs_test_a' });
    expect(() => parseCursor(Buffer.from('2026-11-07T00:00:00Z|a|b').toString('base64url'))).toThrow(CommError);
  });
});

describe('transaction status', () => {
  it('standing, partially refunded, refunded, voided', () => {
    expect(transactionStatus(1000, 0, false)).toBe('standing');
    expect(transactionStatus(1000, 1, false)).toBe('partially_refunded');
    expect(transactionStatus(1000, 1000, false)).toBe('refunded');
    expect(transactionStatus(1000, 0, true)).toBe('voided');
  });
});

describe('errorCategory: a log line names the kind of Stripe error, never its message', () => {
  it('type, code and status only', () => {
    const e = Object.assign(new Error('No such customer: cus_secret; card 4242'), { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404 });
    expect(errorCategory(e)).toBe('StripeInvalidRequestError (resource_missing) 404');
    expect(errorCategory(e)).not.toMatch(/cus_secret|4242/);
    expect(errorCategory(undefined)).toBe('error');
  });
});

describe('rate limiting', () => {
  it('a parent opening Stripe Checkout is rate limited per actor; the webhook is not (Stripe bursts)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RATE_LIMITED_ACTION, ActionScope } = require('../../../src/platform/auth/action-throttle.guard');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PaymentsController } = require('../../../src/billing/payments.controller');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { StripeWebhookController } = require('../../../src/billing/stripe-webhook.controller');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { COMMUNICATION_CONFIG_DEFAULTS } = require('../../../src/platform/app-config.service');
    expect(Reflect.getMetadata(RATE_LIMITED_ACTION, PaymentsController.prototype.checkout)).toBe(ActionScope.CHECKOUT_START);
    expect(Reflect.getMetadata(RATE_LIMITED_ACTION, StripeWebhookController.prototype.webhook)).toBeUndefined();
    expect(COMMUNICATION_CONFIG_DEFAULTS[`abuse.throttle.${ActionScope.CHECKOUT_START}`]).toBe(10);
  });
});
