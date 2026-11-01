/**
 * PD-27: a Stripe stand-in for tests. Checkout Sessions and refunds live in
 * memory; webhook VERIFICATION is the real SDK's (StripeSdkGateway with a test
 * endpoint secret), and `signedEvent` signs exactly as Stripe does -- so the
 * signature path under test is the production one, not a mock of it.
 */
import Stripe from 'stripe';
import {
  StripeSdkGateway,
  type CheckoutInput,
  type CheckoutSession,
  type RefundResult,
  type StripeGateway,
} from '../../src/billing/stripe.gateway';

export const TEST_WEBHOOK_SECRET = 'whsec_pd027_integration_test_secret_0123456789';

export class FakeStripe implements StripeGateway {
  checkoutAvailable = true;
  webhookAvailable = true;
  readonly sessions = new Map<string, CheckoutSession & { input: CheckoutInput }>();
  readonly refunds: Array<{ id: string; paymentIntentId: string; amountMinor: number }> = [];
  /** Every refund CALL, as real Stripe sees it (a replayed idempotency key is a call but no new refund). */
  readonly refundCalls: Array<{ paymentIntentId: string; amountMinor: number; idempotencyKey: string; metadata: Record<string, string> }> = [];
  /** Runs inside a refund call, after Stripe made the refund and before it answers (a webhook arriving early, a slow network). */
  onRefund: ((refund: { id: string; paymentIntentId: string; amountMinor: number; metadata: Record<string, string> }) => Promise<void>) | null = null;
  private readonly refundsByKey = new Map<string, RefundResult>();
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
    const session = {
      id,
      url: `https://checkout.stripe.com/c/pay/${id}`,
      status: 'open',
      paymentStatus: 'unpaid',
      amountTotal: input.amountMinor,
      currency: input.currency,
      paymentIntentId: null,
      metadata: { paymentRequestId: input.requestId, organizationId: input.organizationId },
      expiresAt: input.expiresAt,
      input,
    };
    this.sessions.set(id, session);
    return session;
  }

  async retrieveCheckout(sessionId: string): Promise<CheckoutSession> {
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
    const known = this.refundsByKey.get(idempotencyKey);
    if (known) return known;
    const id = `re_test_${++this.n}`;
    this.refunds.push({ id, paymentIntentId, amountMinor });
    const result = { id, amountMinor, status: 'succeeded' };
    this.refundsByKey.set(idempotencyKey, result);
    if (this.onRefund) await this.onRefund({ id, paymentIntentId, amountMinor, metadata });
    return result;
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    return this.verifier.verifyWebhook(rawBody, signature);
  }

  /** Stripe completes the session: the parent paid. */
  complete(sessionId: string, over: { amountTotal?: number; currency?: string } = {}): CheckoutSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no such session');
    s.status = 'complete';
    s.paymentStatus = 'paid';
    s.paymentIntentId = `pi_test_${sessionId}`;
    if (over.amountTotal !== undefined) s.amountTotal = over.amountTotal;
    if (over.currency !== undefined) s.currency = over.currency;
    return s;
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

  signedEvent(event: Record<string, unknown>, secret = TEST_WEBHOOK_SECRET): { body: string; signature: string } {
    const body = JSON.stringify(event);
    return { body, signature: this.signer.webhooks.generateTestHeaderString({ payload: body, secret }) };
  }
}
