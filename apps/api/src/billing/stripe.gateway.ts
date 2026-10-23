import Stripe from 'stripe';

/**
 * PD-27: everything Chat asks of Stripe, behind one seam.
 *
 * The SDK is the only thing that talks to Stripe and the only thing that
 * verifies a webhook signature (`webhooks.constructEvent` over the RAW body):
 * hand-rolling an HMAC check with a timestamp tolerance is exactly the code
 * that is wrong in subtle ways. Tests replace the whole gateway (the
 * STRIPE_GATEWAY token) and never reach the network.
 *
 * Configuration is two secrets, both optional: without STRIPE_SECRET_KEY no
 * card option is offered and a checkout answers 503; without
 * STRIPE_WEBHOOK_SECRET the webhook answers 503 (Stripe retries for three
 * days). Nothing here logs a key, a signature or a body.
 */
export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');

export interface CheckoutInput {
  requestId: string;
  organizationId: string;
  amountMinor: number;
  currency: string;
  /** What the parent sees on Stripe's page. */
  productName: string;
  description: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Stripe refuses less than 30 minutes. */
  expiresAt: Date;
  locale: 'ar' | 'en';
  /** Stripe's own idempotency: a retried create returns the same session. */
  idempotencyKey: string;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
  /** open | complete | expired */
  status: string | null;
  /** paid | unpaid | no_payment_required */
  paymentStatus: string;
  amountTotal: number | null;
  /** Upper case, as Chat stores it. */
  currency: string | null;
  paymentIntentId: string | null;
  metadata: Record<string, string>;
  expiresAt: Date;
}

export interface RefundResult {
  id: string;
  amountMinor: number;
  status: string | null;
}

export interface StripeGateway {
  /** A secret key is configured: card payments can be offered. */
  readonly checkoutAvailable: boolean;
  /** A webhook secret is configured: Stripe's confirmations can be verified. */
  readonly webhookAvailable: boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  retrieveCheckout(sessionId: string): Promise<CheckoutSession>;
  expireCheckout(sessionId: string): Promise<void>;
  refund(paymentIntentId: string, amountMinor: number, idempotencyKey: string): Promise<RefundResult>;
  /** Throws on any signature, tolerance or parse failure. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event;
}

export class StripeSdkGateway implements StripeGateway {
  private readonly client: Stripe | null;
  private readonly webhookSecret: string | null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const key = env.STRIPE_SECRET_KEY?.trim();
    const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
    this.client = key ? new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 }) : null;
    this.webhookSecret = secret || null;
  }

  get checkoutAvailable(): boolean {
    return this.client !== null;
  }

  get webhookAvailable(): boolean {
    return this.webhookSecret !== null;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const metadata = { paymentRequestId: input.requestId, organizationId: input.organizationId };
    const session = await this.requireClient().checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: input.requestId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountMinor,
              product_data: {
                name: input.productName,
                ...(input.description ? { description: input.description } : {}),
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        locale: input.locale,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return toSession(session);
  }

  async retrieveCheckout(sessionId: string): Promise<CheckoutSession> {
    return toSession(await this.requireClient().checkout.sessions.retrieve(sessionId));
  }

  async expireCheckout(sessionId: string): Promise<void> {
    await this.requireClient().checkout.sessions.expire(sessionId);
  }

  async refund(paymentIntentId: string, amountMinor: number, idempotencyKey: string): Promise<RefundResult> {
    const refund = await this.requireClient().refunds.create(
      { payment_intent: paymentIntentId, amount: amountMinor },
      { idempotencyKey },
    );
    return { id: refund.id, amountMinor: refund.amount, status: refund.status ?? null };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    if (!this.webhookSecret) throw new Error('webhook secret not configured');
    if (!signature) throw new Error('missing signature');
    // A fresh, keyless instance is enough to verify: constructEvent only needs
    // the endpoint secret, so a deployment can verify before it can charge.
    const verifier = this.client ?? new Stripe('sk_unused_for_verification');
    return verifier.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  private requireClient(): Stripe {
    if (!this.client) throw new Error('STRIPE_SECRET_KEY is not configured');
    return this.client;
  }
}

export function toSession(s: Stripe.Checkout.Session): CheckoutSession {
  const pi = s.payment_intent;
  return {
    id: s.id,
    url: s.url ?? null,
    status: s.status ?? null,
    paymentStatus: s.payment_status,
    amountTotal: s.amount_total ?? null,
    currency: s.currency ? s.currency.toUpperCase() : null,
    paymentIntentId: typeof pi === 'string' ? pi : pi?.id ?? null,
    metadata: (s.metadata ?? {}) as Record<string, string>,
    expiresAt: new Date(s.expires_at * 1000),
  };
}
