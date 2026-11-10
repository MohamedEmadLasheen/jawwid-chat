/**
 * PD-27: a Stripe stand-in for tests. Checkout Sessions and refunds live in
 * memory; webhook VERIFICATION is the real SDK's (StripeSdkGateway with a test
 * endpoint secret), and `signedEvent` signs exactly as Stripe does -- so the
 * signature path under test is the production one, not a mock of it.
 */
import Stripe from 'stripe';
import {
  StripeSdkGateway,
  checkoutCreateParams,
  type CheckoutInput,
  type CheckoutSession,
  type PaymentIntentFacts,
  type RefundFacts,
  type RefundResult,
  type StripeGateway,
} from '../../src/billing/stripe.gateway';

export const TEST_WEBHOOK_SECRET = 'whsec_pd027_integration_test_secret_0123456789';

export class FakeStripe implements StripeGateway {
  checkoutAvailable = true;
  webhookAvailable = true;
  livemode: boolean | null = false;
  /** Customers Chat created, by idempotency key (as Stripe: the same key answers the same customer). */
  readonly customers = new Map<string, { id: string; metadata: Record<string, string> }>();
  customerCalls = 0;
  /** The next createCustomer fails (Stripe refusing): the parent must still pay, as a guest. */
  failNextCustomer: Error | null = null;
  /** Refunds made outside Chat's API (the Stripe Dashboard): listRefunds returns them; no Chat call made them. */
  readonly dashboardRefunds: RefundFacts[] = [];
  /** Every Stripe read the reconciler or the ledger made (to prove a path does or does not call Stripe). */
  readonly reads: string[] = [];
  /** The next read (retrieve / facts / list / find) fails, as Stripe being unreachable does. */
  failNextRead: Error | null = null;
  /** Each session's create call exactly as the production gateway would send it to Stripe (checkoutCreateParams). */
  readonly sessions = new Map<string, CheckoutSession & { input: CheckoutInput; params: Stripe.Checkout.SessionCreateParams }>();
  readonly refunds: Array<{ id: string; paymentIntentId: string; amountMinor: number }> = [];
  /** Every refund CALL, as real Stripe sees it (a replayed idempotency key is a call but no new refund). */
  readonly refundCalls: Array<{ paymentIntentId: string; amountMinor: number; idempotencyKey: string; metadata: Record<string, string> }> = [];
  /** Runs inside a refund call, after Stripe made the refund and before it answers (a webhook arriving early, a slow network). */
  onRefund: ((refund: { id: string; paymentIntentId: string; amountMinor: number; metadata: Record<string, string> }) => Promise<void>) | null = null;
  private readonly refundsByKey = new Map<string, { result: RefundResult; params: string }>();
  readonly expired: string[] = [];
  /** The next createCheckout fails as real Stripe refuses a request (a StripeInvalidRequestError). */
  failNextCheckout: Error | null = null;
  private n = 0;
  private readonly verifier = new StripeSdkGateway({ STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET } as NodeJS.ProcessEnv);
  private readonly signer = new Stripe('sk_test_signing_only');

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    if (this.failNextCheckout) {
      const e = this.failNextCheckout;
      this.failNextCheckout = null;
      throw e;
    }
    const id = `cs_test_${++this.n}_${input.requestId.slice(0, 8)}`;
    const params = checkoutCreateParams(input);
    const session = {
      id,
      url: `https://checkout.stripe.com/c/pay/${id}`,
      status: 'open',
      paymentStatus: 'unpaid',
      amountTotal: input.amountMinor,
      currency: input.currency,
      paymentIntentId: null,
      metadata: { ...(params.metadata as Record<string, string>) },
      expiresAt: input.expiresAt,
      customerId: input.customerId ?? null,
      input,
      params,
    };
    this.sessions.set(id, session);
    return session;
  }

  async retrieveCheckout(sessionId: string): Promise<CheckoutSession> {
    this.read(`retrieve:${sessionId}`);
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no such session');
    return s;
  }

  async expireCheckout(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s || s.status !== 'open') throw new Error('not open');
    s.status = 'expired';
    this.expired.push(sessionId);
  }

  /** As Stripe: the same idempotency key answers the same refund and makes no new one. */
  async refund(paymentIntentId: string, amountMinor: number, idempotencyKey: string, metadata: Record<string, string> = {}): Promise<RefundResult> {
    this.refundCalls.push({ paymentIntentId, amountMinor, idempotencyKey, metadata });
    const params = JSON.stringify({ paymentIntentId, amountMinor, metadata });
    const known = this.refundsByKey.get(idempotencyKey);
    if (known) {
      // Real Stripe: a key reused with other parameters is an error, not the old answer.
      if (known.params !== params) {
        throw Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters they were first used with.'), {
          type: 'StripeIdempotencyError', statusCode: 400,
        });
      }
      return known.result;
    }
    const id = `re_test_${++this.n}`;
    this.refunds.push({ id, paymentIntentId, amountMinor });
    const result = { id, amountMinor, status: 'succeeded' };
    this.refundsByKey.set(idempotencyKey, { result, params });
    if (this.onRefund) await this.onRefund({ id, paymentIntentId, amountMinor, metadata });
    return result;
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    return this.verifier.verifyWebhook(rawBody, signature);
  }

  async createCustomer(input: { familyId: string; organizationId: string; idempotencyKey: string }): Promise<string> {
    this.customerCalls++;
    if (this.failNextCustomer) {
      const e = this.failNextCustomer;
      this.failNextCustomer = null;
      throw e;
    }
    const known = this.customers.get(input.idempotencyKey);
    if (known) return known.id;
    const id = `cus_T${++this.n}${input.familyId.replace(/-/g, '').slice(0, 12)}`;
    this.customers.set(input.idempotencyKey, { id, metadata: { familyId: input.familyId, organizationId: input.organizationId } });
    return id;
  }

  async findCheckoutByPaymentIntent(paymentIntentId: string): Promise<CheckoutSession | null> {
    this.read(`find:${paymentIntentId}`);
    return [...this.sessions.values()].find((s) => s.paymentIntentId === paymentIntentId) ?? null;
  }

  async paymentIntentFacts(paymentIntentId: string): Promise<PaymentIntentFacts> {
    this.read(`facts:${paymentIntentId}`);
    const s = [...this.sessions.values()].find((x) => x.paymentIntentId === paymentIntentId);
    if (!s) throw Object.assign(new Error('No such payment_intent'), { type: 'StripeInvalidRequestError', statusCode: 404 });
    const refunded = (await this.listRefunds(paymentIntentId, false)).filter((r) => r.status === 'succeeded' || r.status === 'pending').reduce((a, r) => a + r.amountMinor, 0);
    return {
      id: paymentIntentId,
      status: s.paymentStatus === 'paid' ? 'succeeded' : 'requires_payment_method',
      currency: (s.currency ?? 'USD').toUpperCase(),
      amountReceivedMinor: s.paymentStatus === 'paid' ? s.amountTotal ?? 0 : 0,
      amountRefundedMinor: refunded,
      chargeId: `ch_${paymentIntentId.slice(3)}`,
      customerId: s.customerId ?? null,
      methodType: 'card',
      cardBrand: 'visa',
      cardLast4: '4242',
      cardWallet: null,
    };
  }

  async listRefunds(paymentIntentId: string, record = true): Promise<RefundFacts[]> {
    if (record) this.read(`refunds:${paymentIntentId}`);
    const api = this.refunds
      .filter((r) => r.paymentIntentId === paymentIntentId)
      .map((r) => ({ id: r.id, amountMinor: r.amountMinor, status: 'succeeded', paymentIntentId, reason: null, metadata: {} }));
    const dash = this.dashboardRefunds.filter((r) => r.paymentIntentId === paymentIntentId);
    return [...api, ...dash].reverse(); // newest first, as Stripe lists
  }

  /** A refund someone made in the Stripe Dashboard (no Chat API call, no metadata). */
  dashboardRefund(paymentIntentId: string, amountMinor: number, status = 'succeeded'): RefundFacts {
    const r = { id: `re_D${++this.n}${paymentIntentId.slice(3, 15)}`, amountMinor, status, paymentIntentId, reason: 'requested_by_customer', metadata: {} };
    this.dashboardRefunds.push(r);
    return r;
  }

  private read(what: string) {
    this.reads.push(what);
    if (this.failNextRead) {
      const e = this.failNextRead;
      this.failNextRead = null;
      throw e;
    }
  }

  /** Stripe expires the session (the parent left; 45 minutes passed). */
  expireAtStripe(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no such session');
    s.status = 'expired';
  }

  /** Stripe completes the session: the parent paid. */
  complete(sessionId: string, over: { amountTotal?: number; currency?: string } = {}): CheckoutSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no such session');
    s.status = 'complete';
    s.paymentStatus = 'paid';
    s.paymentIntentId = s.paymentIntentId ?? this.intentFor(sessionId);
    if (over.amountTotal !== undefined) s.amountTotal = over.amountTotal;
    if (over.currency !== undefined) s.currency = over.currency;
    return s;
  }

  /** The payment intent Stripe makes when the parent submits a card (alphanumeric, as Stripe's ids are). */
  intentFor(sessionId: string): string {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no such session');
    if (!s.paymentIntentId) s.paymentIntentId = `pi_T${sessionId.replace(/[^A-Za-z0-9]/g, '')}`;
    return s.paymentIntentId;
  }

  /** payment_intent.succeeded / payment_intent.payment_failed for a session's intent. */
  intentEvent(
    sessionId: string,
    type: 'payment_intent.succeeded' | 'payment_intent.payment_failed',
    opts: { declineCode?: string; code?: string; eventId?: string; metadata?: Record<string, string> } = {},
  ) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no such session');
    const pi = this.intentFor(sessionId);
    return this.signedEvent({
      id: opts.eventId ?? `evt_test_${++this.n}`,
      object: 'event',
      type,
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: pi,
          object: 'payment_intent',
          amount: s.amountTotal,
          currency: s.currency?.toLowerCase(),
          status: type === 'payment_intent.succeeded' ? 'succeeded' : 'requires_payment_method',
          metadata: opts.metadata ?? s.metadata,
          last_payment_error: type === 'payment_intent.payment_failed'
            ? { type: 'card_error', code: opts.code ?? 'card_declined', decline_code: opts.declineCode, message: 'Your card has insufficient funds. 4242' }
            : null,
        },
      },
    });
  }

  /** charge.refunded for an intent (the refunds themselves are read from listRefunds, as from Stripe). */
  chargeRefundedEvent(paymentIntentId: string, eventId = `evt_test_${++this.n}`) {
    return this.signedEvent({
      id: eventId,
      object: 'event',
      type: 'charge.refunded',
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: `ch_${paymentIntentId.slice(3)}`, object: 'charge', payment_intent: paymentIntentId, refunded: true } },
    });
  }

  /** Any event, with a minimal object (e.g. a Stripe Billing invoice Chat never created). */
  plainEvent(type: string, object: Record<string, unknown>, eventId = `evt_test_${++this.n}`) {
    return this.signedEvent({ id: eventId, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
  }

  /** The webhook body Stripe would send for a completed session, and its signature header. */
  completedEvent(session: CheckoutSession, eventId = `evt_test_${++this.n}`): { body: string; signature: string } {
    return this.signedEvent({
      id: eventId,
      object: 'event',
      type: 'checkout.session.completed',
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: session.id,
          object: 'checkout.session',
          status: session.status,
          payment_status: session.paymentStatus,
          amount_total: session.amountTotal,
          currency: session.currency?.toLowerCase(),
          payment_intent: session.paymentIntentId,
          metadata: session.metadata,
          expires_at: Math.floor(session.expiresAt.getTime() / 1000),
          url: null,
          customer: session.customerId ?? null,
        },
      },
    });
  }

  refundEvent(paymentIntentId: string, refundId: string, amountMinor: number, eventId = `evt_test_${++this.n}`, metadata: Record<string, string> = {}) {
    return this.signedEvent({
      id: eventId,
      object: 'event',
      type: 'refund.created',
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: refundId, object: 'refund', amount: amountMinor, payment_intent: paymentIntentId, status: 'succeeded', reason: 'requested_by_customer', metadata } },
    });
  }

  /** A charge.dispute.* event (a chargeback) on a payment intent and its charge. */
  disputeEvent(
    type: 'created' | 'updated' | 'closed' | 'funds_withdrawn' | 'funds_reinstated',
    paymentIntentId: string | null,
    opts: { disputeId?: string; chargeId?: string; amountMinor?: number; currency?: string; status?: string; reason?: string; eventId?: string } = {},
  ) {
    return this.signedEvent({
      id: opts.eventId ?? `evt_test_${++this.n}`,
      object: 'event',
      type: `charge.dispute.${type}`,
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: opts.disputeId ?? `du_T${++this.n}`,
          object: 'dispute',
          amount: opts.amountMinor ?? 120000,
          currency: (opts.currency ?? 'aed').toLowerCase(),
          charge: opts.chargeId ?? (paymentIntentId ? `ch_${paymentIntentId.slice(3)}` : `ch_TForeign${this.n}`),
          payment_intent: paymentIntentId,
          status: opts.status ?? (type === 'closed' ? 'lost' : 'needs_response'),
          reason: opts.reason ?? 'fraudulent',
        },
      },
    });
  }

  signedEvent(event: Record<string, unknown>, secret = TEST_WEBHOOK_SECRET): { body: string; signature: string } {
    const body = JSON.stringify(event);
    return { body, signature: this.signer.webhooks.generateTestHeaderString({ payload: body, secret }) };
  }
}
