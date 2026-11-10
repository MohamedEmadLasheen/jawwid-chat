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

/**
 * Every Checkout Session Chat opens, and the payment intent Stripe makes for it,
 * carries `metadata.system = 'jawwid-chat'`. Other systems on the same Stripe
 * account can then tell Chat's objects from their own, and so can a person in
 * the Stripe Dashboard. Chat itself still decides "is this mine?" from its own
 * table (chat.payment_checkout), never from metadata alone: metadata can be
 * edited in the Dashboard.
 */
export const CHAT_STRIPE_SYSTEM = 'jawwid-chat';

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
  /** The family's language; mapped to a locale Stripe has (stripeCheckoutLocale). */
  locale: 'ar' | 'en';
  /** Stripe's own idempotency: a retried create returns the same session. */
  idempotencyKey: string;
  /** The family's Stripe Customer (metadata only); null pays as a guest (a trial before Assign). */
  customerId?: string | null;
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
  customerId?: string | null;
}

/** A refund as Chat reads it, from a webhook or from Stripe's list. */
export interface RefundFacts {
  id: string;
  amountMinor: number;
  /** pending | requires_action | succeeded | failed | canceled */
  status: string | null;
  paymentIntentId: string | null;
  reason: string | null;
  metadata: Record<string, string>;
}

/**
 * A payment intent's facts for the ledger and for reconciliation: the charge,
 * the customer, the payment method (brand, last 4, wallet -- never more), and
 * what Stripe says was received and refunded. Every string is checked against
 * the database's own pattern here (`safe`), so an unexpected value from Stripe
 * is dropped rather than failing the insert (and the webhook) forever.
 */
export interface PaymentIntentFacts {
  id: string;
  status: string;
  currency: string;
  amountReceivedMinor: number;
  amountRefundedMinor: number;
  chargeId: string | null;
  customerId: string | null;
  methodType: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  cardWallet: string | null;
}

/**
 * A dispute (chargeback) as Chat reads it from a `charge.dispute.*` webhook.
 * Codes only: Stripe's status and reason codes, never the evidence or any
 * cardholder text.
 */
export interface DisputeFacts {
  id: string;
  chargeId: string | null;
  paymentIntentId: string | null;
  amountMinor: number;
  /** Upper case, as Chat stores it. */
  currency: string | null;
  /** warning_needs_response | warning_under_review | warning_closed | needs_response | under_review | won | lost | ... */
  status: string | null;
  /** fraudulent | duplicate | product_not_received | ... */
  reason: string | null;
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
  /** `metadata` travels with the refund to the webhook (refund.metadata). */
  refund(paymentIntentId: string, amountMinor: number, idempotencyKey: string, metadata?: Record<string, string>): Promise<RefundResult>;
  /** Throws on any signature, tolerance or parse failure. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event;
  /** Live or test mode of the configured key (null without one): a customer exists in one mode only. */
  readonly livemode: boolean | null;
  /** A Customer for a family: metadata only -- no name, no e-mail. */
  createCustomer(input: { familyId: string; organizationId: string; idempotencyKey: string }): Promise<string>;
  /** The Checkout Session a payment intent belongs to, or null. */
  findCheckoutByPaymentIntent(paymentIntentId: string): Promise<CheckoutSession | null>;
  paymentIntentFacts(paymentIntentId: string): Promise<PaymentIntentFacts>;
  /** Every refund of a payment intent, newest first (all pages). */
  listRefunds(paymentIntentId: string): Promise<RefundFacts[]>;
}

export class StripeSdkGateway implements StripeGateway {
  private readonly client: Stripe | null;
  private readonly webhookSecret: string | null;
  private readonly key: string | null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const key = env.STRIPE_SECRET_KEY?.trim();
    const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
    this.key = key || null;
    this.client = key ? new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 }) : null;
    this.webhookSecret = secret || null;
  }

  get checkoutAvailable(): boolean {
    return this.client !== null;
  }

  get webhookAvailable(): boolean {
    return this.webhookSecret !== null;
  }

  get livemode(): boolean | null {
    return this.key === null ? null : /^(sk|rk)_live_/.test(this.key);
  }

  async createCustomer(input: { familyId: string; organizationId: string; idempotencyKey: string }): Promise<string> {
    const customer = await this.requireClient().customers.create(
      { metadata: { familyId: input.familyId, organizationId: input.organizationId } },
      { idempotencyKey: input.idempotencyKey },
    );
    return customer.id;
  }

  async findCheckoutByPaymentIntent(paymentIntentId: string): Promise<CheckoutSession | null> {
    const page = await this.requireClient().checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
    const s = page.data[0];
    return s ? toSession(s) : null;
  }

  async paymentIntentFacts(paymentIntentId: string): Promise<PaymentIntentFacts> {
    const pi = await this.requireClient().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
    const charge = typeof pi.latest_charge === 'object' && pi.latest_charge ? pi.latest_charge : null;
    return toIntentFacts(pi, charge);
  }

  async listRefunds(paymentIntentId: string): Promise<RefundFacts[]> {
    // Every page (newest first): a payment may have more than one page of partial refunds.
    const all = await this.requireClient().refunds.list({ payment_intent: paymentIntentId, limit: 100 }).autoPagingToArray({ limit: 10_000 });
    return all.map(toRefundFacts);
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const session = await this.requireClient().checkout.sessions.create(checkoutCreateParams(input), { idempotencyKey: input.idempotencyKey });
    return toSession(session);
  }

  async retrieveCheckout(sessionId: string): Promise<CheckoutSession> {
    return toSession(await this.requireClient().checkout.sessions.retrieve(sessionId));
  }

  async expireCheckout(sessionId: string): Promise<void> {
    await this.requireClient().checkout.sessions.expire(sessionId);
  }

  async refund(paymentIntentId: string, amountMinor: number, idempotencyKey: string, metadata: Record<string, string> = {}): Promise<RefundResult> {
    const refund = await this.requireClient().refunds.create(
      { payment_intent: paymentIntentId, amount: amountMinor, metadata },
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

/**
 * Stripe Checkout has no Arabic page (its locales are a fixed list without
 * `ar`; sending one is a 400 that fails every checkout). English families get
 * English; everyone else gets `auto` -- Stripe follows the browser's language
 * and falls back to English. Our own pages stay Arabic first.
 */
export function stripeCheckoutLocale(locale: 'ar' | 'en'): 'en' | 'auto' {
  return locale === 'en' ? 'en' : 'auto';
}

/** The metadata on a Checkout Session Chat opens and on its payment intent: ids and the system tag only. */
export function checkoutMetadata(input: Pick<CheckoutInput, 'requestId' | 'organizationId'>): Record<string, string> {
  return { system: CHAT_STRIPE_SYSTEM, paymentRequestId: input.requestId, organizationId: input.organizationId };
}

/** What Chat asks Stripe for when it opens a Checkout Session (pure, so a test reads it without the network). */
export function checkoutCreateParams(input: CheckoutInput): Stripe.Checkout.SessionCreateParams {
  const metadata = checkoutMetadata(input);
  return {
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
    payment_intent_data: { metadata: { ...metadata } },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    expires_at: Math.floor(input.expiresAt.getTime() / 1000),
    locale: stripeCheckoutLocale(input.locale),
    ...(input.customerId ? { customer: input.customerId } : {}),
  };
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
    customerId: safe.customer(typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null),
  };
}

/**
 * The database's patterns (20261107120000), applied before a write: a value
 * that does not fit is dropped (null), never sent to an insert that would fail.
 */
const pattern = (re: RegExp) => (v: string | null | undefined): string | null => (typeof v === 'string' && re.test(v) ? v : null);
export const safe = {
  customer: pattern(/^cus_[A-Za-z0-9]{1,250}$/),
  charge: pattern(/^(ch|py)_[A-Za-z0-9]{1,250}$/),
  paymentIntent: pattern(/^pi_[A-Za-z0-9]{1,250}$/),
  methodType: pattern(/^[a-z_]{1,40}$/),
  brand: pattern(/^[a-z_]{1,30}$/),
  last4: pattern(/^[0-9]{4}$/),
  wallet: pattern(/^[a-z_]{1,30}$/),
  failureCode: pattern(/^[a-z0-9_]{1,64}$/),
  /** A dispute's status or reason code; short enough that `dispute_closed_<status>` stays a valid outcome filter (40). */
  disputeCode: pattern(/^[a-z_]{1,25}$/),
  objectId: (v: string | null | undefined): string | null => (typeof v === 'string' && v.length >= 1 && v.length <= 255 ? v : null),
};

export function toRefundFacts(r: Stripe.Refund): RefundFacts {
  const pi = r.payment_intent;
  return {
    id: r.id,
    amountMinor: r.amount,
    status: r.status ?? null,
    paymentIntentId: typeof pi === 'string' ? pi : pi?.id ?? null,
    reason: r.reason ?? null,
    metadata: (r.metadata ?? {}) as Record<string, string>,
  };
}

export function toDisputeFacts(d: Stripe.Dispute): DisputeFacts {
  const ch = d.charge as string | { id: string } | null | undefined;
  const pi = d.payment_intent as string | { id: string } | null | undefined;
  return {
    id: d.id,
    chargeId: safe.charge(typeof ch === 'string' ? ch : ch?.id ?? null),
    paymentIntentId: safe.paymentIntent(typeof pi === 'string' ? pi : pi?.id ?? null),
    amountMinor: typeof d.amount === 'number' ? d.amount : 0,
    currency: typeof d.currency === 'string' ? d.currency.toUpperCase() : null,
    status: safe.disputeCode(d.status ?? null),
    reason: safe.disputeCode(d.reason ?? null),
  };
}

export function toIntentFacts(pi: Stripe.PaymentIntent, charge: Stripe.Charge | null): PaymentIntentFacts {
  const details = charge?.payment_method_details ?? null;
  const card = details?.card ?? null;
  return {
    id: pi.id,
    status: pi.status,
    currency: pi.currency.toUpperCase(),
    amountReceivedMinor: pi.amount_received ?? 0,
    amountRefundedMinor: charge?.amount_refunded ?? 0,
    chargeId: safe.charge(charge?.id ?? null),
    customerId: safe.customer(typeof pi.customer === 'string' ? pi.customer : pi.customer?.id ?? null),
    methodType: safe.methodType(details?.type ?? null),
    cardBrand: safe.brand(card?.brand ?? null),
    cardLast4: safe.last4(card?.last4 ?? null),
    cardWallet: safe.wallet(card?.wallet?.type ?? null),
  };
}
