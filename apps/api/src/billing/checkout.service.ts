import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Payment, PaymentRequest } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { todayIn } from '../leave/leave.service';
import { checkoutDescription, isPayableInApp, loadPackageFacts, notInApp } from './in-app-payability';
import { PaymentLedger, type RecordedPayment } from './payment-ledger.service';
import {
  STRIPE_GATEWAY,
  safe,
  toRefundFacts,
  toSession,
  type CheckoutSession,
  type PaymentIntentFacts,
  type RefundFacts,
  type StripeGateway,
} from './stripe.gateway';
import { WEBHOOK_REFUND_REASON } from './idempotency';
import { isUuid } from '../communication/conversations/conversation.service';
import { inReviewMode, reviewDemoUrl } from './review-mode';

const DEFAULT_TIME_ZONE = 'Africa/Cairo';
/** Stripe refuses a session that expires sooner than 30 minutes. */
const CHECKOUT_MINUTES = 45;
/** Opening Stripe's page again and again for one request is not paying; it is a loop or abuse. */
const MAX_CHECKOUTS_PER_HOUR = 10;

class DuplicateEvent extends Error {}

export type WebhookOutcome =
  | 'recorded'
  | 'duplicate'
  | 'already_recorded'
  | 'awaiting_payment'
  | 'unknown_session'
  | 'mismatch'
  | 'checkout_expired'
  | 'checkout_failed'
  | 'refund_recorded'
  /** A refund whose payment Chat has not recorded yet (it arrived first): kept, and recorded with the payment. */
  | 'refund_deferred'
  | 'refund_not_final'
  /** Stripe failed or cancelled a refund Chat had already recorded (as pending): audited and alerted, not reversed. */
  | 'refund_failed_after_record'
  /** A card was declined on Stripe's page; the attempt stays open (the parent may try again). */
  | 'payment_failed'
  /** Stripe Billing (invoices, subscriptions): Chat opens none (PD-27 / PD-30 are prepaid packages). */
  | 'ignored_not_chat'
  | 'ignored';

/** Event families Chat never creates; seen only if someone sets up Stripe Billing on the account. */
const BILLING_EVENT = /^(invoice|customer\.subscription|subscription_schedule)\./;

/**
 * PD-27: card payments through Stripe Checkout.
 *
 * OPENING. A Checkout Session is opened for what a request still owes, at the
 * moment the parent taps Pay (from the link page or the app) -- never ahead of
 * time, so the amount is always current. Before opening another, the request's
 * earlier sessions are looked at: one Stripe completed is RECORDED (its webhook
 * may be late) instead of charging again; one still open is expired, so two
 * Stripe pages for one request are never payable at once.
 *
 * CONFIRMING. Only a verified webhook confirms (the success page records
 * nothing). A payment is recorded when the event is new (chat.stripe_event,
 * primary key), the session is one WE opened (chat.payment_checkout), Stripe
 * says it is paid, and the amount and currency are exactly what we asked. The
 * session id and the payment intent are unique on chat.payment, so a second
 * event about the same session cannot record it twice either.
 *
 * Sessions Chat did not open (another product on the same Stripe account) are
 * acknowledged and ignored.
 */
@Injectable()
export class CheckoutService {
  private readonly log = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: PaymentLedger,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  get available(): boolean {
    return this.stripe.checkoutAvailable;
  }

  /** The Stripe Checkout URL for what the request still owes. */
  async open(request: PaymentRequest, opts: { locale: 'ar' | 'en'; returnUrl: string; inApp?: boolean }): Promise<string> {
    // OA-12: an App Review organization never reaches Stripe -- no session, no
    // customer, no payment_checkout row -- only the static demo page.
    if (await inReviewMode(this.prisma, request.organizationId)) return reviewDemoUrl(opts.locale);
    if (!this.stripe.checkoutAvailable) {
      throw new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, 'card payments are not configured on this deployment', 503);
    }
    this.requirePayable(request);

    const recent = await this.prisma.paymentCheckout.count({
      where: { requestId: request.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= MAX_CHECKOUTS_PER_HOUR) {
      throw new CommError(CommErrorCode.BILLING_STATE, 'too many payment attempts for this request; try again in an hour', 429);
    }

    // Earlier sessions: record a completed one, expire an open one.
    const open = await this.prisma.paymentCheckout.findMany({ where: { requestId: request.id, status: 'open' } });
    for (const c of open) {
      let session: CheckoutSession;
      try {
        session = await this.stripe.retrieveCheckout(c.stripeSessionId);
      } catch {
        continue;
      }
      if (session.status === 'complete' && session.paymentStatus === 'paid') {
        await this.confirm(session, null);
      } else if (session.status === 'open') {
        try {
          await this.stripe.expireCheckout(session.id);
        } catch {
          // Completed between the two calls: its webhook records it.
        }
        await this.prisma.paymentCheckout.update({ where: { stripeSessionId: c.stripeSessionId }, data: { status: 'expired' } });
      } else {
        await this.prisma.paymentCheckout.update({
          where: { stripeSessionId: c.stripeSessionId },
          data: { status: session.status === 'complete' ? 'complete' : 'expired' },
        });
      }
    }

    const fresh = await this.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } });
    this.requirePayable(fresh);
    const remaining = Number(fresh.amountMinor) - (await this.ledger.standingSum(this.prisma, { requestId: fresh.id }));
    if (remaining <= 0) throw new CommError(CommErrorCode.BILLING_STATE, 'this request is already paid', 409);

    const attempts = await this.prisma.paymentCheckout.count({ where: { requestId: fresh.id } });
    const lessons = isPayableInApp(fresh, await loadPackageFacts(this.prisma, { requests: [fresh] }));
    // From the app: checked again just before Stripe is asked (a package voided since).
    if (opts.inApp && !lessons) throw notInApp();
    const sep = opts.returnUrl.includes('?') ? '&' : '?';
    let customerId = await this.customerFor(fresh);
    const input = {
      requestId: fresh.id,
      organizationId: fresh.organizationId,
      amountMinor: remaining,
      currency: fresh.currency,
      productName: fresh.childName ? `${fresh.label} — ${fresh.childName}` : fresh.label,
      description: checkoutDescription(fresh, lessons, opts.locale),
      successUrl: `${opts.returnUrl}${sep}checkout=success`,
      cancelUrl: `${opts.returnUrl}${sep}checkout=cancelled`,
      expiresAt: new Date(Date.now() + CHECKOUT_MINUTES * 60_000),
      locale: opts.locale,
      idempotencyKey: `checkout:${fresh.id}:${attempts}`,
    };
    let session: CheckoutSession;
    try {
      try {
        session = await this.stripe.createCheckout({ ...input, customerId });
      } catch (e) {
        // The family's customer was deleted in the Stripe Dashboard: pay as a
        // guest rather than refuse every card payment of that family.
        const err = e as { code?: string; param?: string };
        if (!customerId || err.code !== 'resource_missing' || (err.param && err.param !== 'customer')) throw e;
        this.log.warn('stripe checkout: the family\'s Stripe customer no longer exists; paying as a guest (do not delete customers Chat created)');
        customerId = null;
        session = await this.stripe.createCheckout({ ...input, customerId, idempotencyKey: `${input.idempotencyKey}:guest` });
      }
    } catch (e) {
      // Stripe's own message never reaches a parent (it can name parameters,
      // and it is English API prose); the category is logged, never the body
      // or the key. The client offers the bank transfer instead.
      this.log.error(`stripe checkout refused: ${errorCategory(e)}`);
      throw new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, 'card payment is unavailable right now; pay by bank transfer', 503);
    }
    if (!session.url) throw new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, 'Stripe did not return a payment page', 503);
    await this.prisma.paymentCheckout.create({
      data: {
        stripeSessionId: session.id,
        organizationId: fresh.organizationId,
        requestId: fresh.id,
        amountMinor: BigInt(remaining),
        currency: fresh.currency,
        expiresAt: session.expiresAt,
        stripeCustomerId: safe.customer(session.customerId ?? customerId),
      },
    });
    return session.url;
  }

  /**
   * The family's Stripe Customer, created once (metadata only: the family and
   * academy ids -- no name, no e-mail). A trial before Assign has no family and
   * pays as a guest. Best effort: if Stripe refuses, the parent still pays (as a
   * guest), and the next checkout tries again.
   */
  private async customerFor(request: PaymentRequest): Promise<string | null> {
    const livemode = this.stripe.livemode;
    if (!request.familyId || livemode === null) return null;
    const key = { familyId_livemode: { familyId: request.familyId, livemode } };
    const known = await this.prisma.stripeCustomer.findUnique({ where: key });
    if (known) return known.stripeCustomerId;
    try {
      const id = safe.customer(
        await this.stripe.createCustomer({
          familyId: request.familyId,
          organizationId: request.organizationId,
          idempotencyKey: `customer:${request.familyId}:${livemode ? 'live' : 'test'}`,
        }),
      );
      if (!id) return null;
      // Two parents at once: one row wins; both use it (Stripe's idempotency key made it one customer).
      await this.prisma.stripeCustomer.createMany({
        data: [{ familyId: request.familyId, livemode, organizationId: request.organizationId, stripeCustomerId: id }],
        skipDuplicates: true,
      });
      return (await this.prisma.stripeCustomer.findUnique({ where: key }))?.stripeCustomerId ?? null;
    } catch (e) {
      this.log.warn(`stripe customer not created (${errorCategory(e)}); the parent pays as a guest`);
      return null;
    }
  }

  /**
   * One verified Stripe event. Always answers an outcome; throws only to make
   * Stripe retry (a database failure, or Stripe unreachable when the event
   * needs a lookup) -- the event row is written with the work, so a failed
   * attempt leaves nothing behind and the retry does it again, once.
   */
  async handleEvent(event: Stripe.Event): Promise<WebhookOutcome> {
    if (await this.prisma.stripeEvent.findUnique({ where: { id: event.id } })) return 'duplicate';
    const meta = metaOf(event);
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = toSession(event.data.object as Stripe.Checkout.Session);
        if (session.paymentStatus !== 'paid') return this.remember(await this.withOrg(meta, session.id), 'awaiting_payment');
        return this.confirm(session, meta);
      }
      case 'checkout.session.async_payment_failed':
        return this.markCheckout(meta, (event.data.object as Stripe.Checkout.Session).id, 'failed', 'checkout_failed');
      case 'checkout.session.expired':
        return this.markCheckout(meta, (event.data.object as Stripe.Checkout.Session).id, 'expired', 'checkout_expired');
      case 'payment_intent.succeeded':
        return this.intentSucceeded(meta, event.data.object as Stripe.PaymentIntent);
      case 'payment_intent.payment_failed':
        return this.intentFailed(meta, event.data.object as Stripe.PaymentIntent);
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed':
        return this.refundEvent(meta, toRefundFacts(event.data.object as Stripe.Refund));
      case 'charge.refunded':
        return this.chargeRefunded(meta, event.data.object as Stripe.Charge);
      default:
        if (BILLING_EVENT.test(event.type)) {
          this.log.warn(`stripe webhook: ${event.type} -- Chat opens no Stripe Billing subscriptions or invoices; recorded, not acted on`);
          return this.remember(meta, 'ignored_not_chat');
        }
        return this.remember(meta, 'ignored');
    }
  }

  /**
   * A second path to the same confirm: `payment_intent.succeeded` for an intent
   * a Chat checkout created. If `checkout.session.completed` was missed (or the
   * endpoint was not subscribed to it), this still records the payment; if it
   * came first, this answers already_recorded. Order does not matter.
   */
  private async intentSucceeded(meta: EventMeta, pi: Stripe.PaymentIntent): Promise<WebhookOutcome> {
    // No secret key: no lookup is possible (and Chat opened no checkout to match).
    if (!pi.metadata?.paymentRequestId || !this.stripe.checkoutAvailable) return this.remember(meta, 'ignored');
    const session = await this.stripe.findCheckoutByPaymentIntent(pi.id);
    if (!session) return this.remember(meta, 'unknown_session');
    if (session.paymentStatus !== 'paid') return this.remember(await this.withOrg(meta, session.id), 'awaiting_payment');
    return this.confirm(session, meta);
  }

  /**
   * A declined card on Stripe's page. Nothing about money changes: the attempt
   * stays open (the parent may try another card on the same page), and Chat
   * keeps how many times and Stripe's decline code -- never Stripe's message,
   * never card data -- so staff see failed attempts and the parent is told why.
   * Counted in the event's own transaction: a redelivery counts nothing.
   */
  private async intentFailed(meta: EventMeta, pi: Stripe.PaymentIntent): Promise<WebhookOutcome> {
    if (!pi.metadata?.paymentRequestId || !this.stripe.checkoutAvailable) return this.remember(meta, 'ignored');
    const session = await this.stripe.findCheckoutByPaymentIntent(pi.id);
    const checkout = session ? await this.prisma.paymentCheckout.findUnique({ where: { stripeSessionId: session.id } }) : null;
    if (!checkout) return this.remember(meta, 'unknown_session');
    const err = pi.last_payment_error;
    const code = safe.failureCode(err?.decline_code ?? err?.code ?? null) ?? 'unknown';
    try {
      await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.stripeEvent.createMany({
          data: [{ ...meta, organizationId: checkout.organizationId, outcome: 'payment_failed' }],
          skipDuplicates: true,
        });
        if (inserted.count === 0) throw new DuplicateEvent();
        await tx.paymentCheckout.update({
          where: { stripeSessionId: checkout.stripeSessionId },
          data: {
            failureCount: { increment: 1 },
            failureCode: code,
            lastFailedAt: new Date(),
            stripePaymentIntentId: safe.paymentIntent(pi.id),
          },
        });
      });
    } catch (e) {
      if (e instanceof DuplicateEvent) return 'duplicate';
      throw e;
    }
    this.log.log(`stripe webhook: card attempt declined (${code})`);
    return 'payment_failed';
  }

  private async refundEvent(meta: EventMeta, refund: RefundFacts): Promise<WebhookOutcome> {
    const payment = refund.paymentIntentId
      ? await this.prisma.payment.findUnique({ where: { stripePaymentIntentId: refund.paymentIntentId } })
      : null;
    // Its payment is not recorded yet (the refund arrived first, or the payment
    // is not Chat's): kept with its payment intent, so recording the payment
    // (and the reconciler) syncs it. Never dropped.
    if (!payment) return this.remember(meta, 'refund_deferred');
    return this.recordRefund({ ...meta, organizationId: payment.organizationId }, payment, refund);
  }

  /**
   * `charge.refunded`: the charge says money went back; Stripe's list of the
   * intent's refunds says which. Each is recorded once (unique Stripe refund
   * id), so this, `refund.created` and a sync never record one twice.
   */
  private async chargeRefunded(meta: EventMeta, charge: Stripe.Charge): Promise<WebhookOutcome> {
    const intent = safe.paymentIntent(typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null);
    const m = { ...meta, paymentIntentId: intent };
    if (!intent) return this.remember(m, 'ignored');
    const payment = await this.prisma.payment.findUnique({ where: { stripePaymentIntentId: intent } });
    // Unknown payment, or no key to list the refunds with: kept for the sync.
    if (!payment || !this.stripe.checkoutAvailable) return this.remember(payment ? { ...m, organizationId: payment.organizationId } : m, 'refund_deferred');
    const recorded = await this.syncRefunds(payment);
    return this.remember({ ...m, organizationId: payment.organizationId }, recorded > 0 ? 'refund_recorded' : 'already_recorded');
  }

  /**
   * Record every refund Stripe holds for a card payment that Chat has not. Used
   * after a card payment is recorded (refunds that arrived first), by
   * `charge.refunded`, and by reconciliation. Answers how many were new.
   */
  async syncRefunds(payment: Payment): Promise<number> {
    if (payment.method !== 'card' || !payment.stripePaymentIntentId || !this.stripe.checkoutAvailable) return 0;
    const refunds = await this.stripe.listRefunds(payment.stripePaymentIntentId);
    let recorded = 0;
    // Oldest first, so the sum check sees them in the order Stripe made them.
    for (const r of [...refunds].reverse()) {
      if (r.paymentIntentId && r.paymentIntentId !== payment.stripePaymentIntentId) continue;
      if (await this.prisma.paymentRefund.findUnique({ where: { stripeRefundId: r.id } })) continue;
      if ((await this.recordRefund(null, payment, r)) === 'refund_recorded') recorded++;
    }
    return recorded;
  }

  /**
   * Record a session Stripe says is paid. `meta` null: found while opening a new
   * checkout (no event yet); the later event then finds it already recorded.
   */
  private async confirm(session: CheckoutSession, meta: EventMeta | null): Promise<WebhookOutcome> {
    const checkout = await this.prisma.paymentCheckout.findUnique({ where: { stripeSessionId: session.id } });
    if (!checkout) return meta ? this.remember(meta, 'unknown_session') : 'unknown_session';
    if (meta) meta = { ...meta, organizationId: checkout.organizationId, paymentIntentId: meta.paymentIntentId ?? safe.paymentIntent(session.paymentIntentId) };
    if (await this.prisma.payment.findUnique({ where: { stripeCheckoutSessionId: session.id } })) {
      await this.prisma.paymentCheckout.update({ where: { stripeSessionId: session.id }, data: { status: 'complete' } });
      return meta ? this.remember(meta, 'already_recorded') : 'already_recorded';
    }
    const request = await this.prisma.paymentRequest.findUniqueOrThrow({ where: { id: checkout.requestId } });
    if (
      session.amountTotal !== Number(checkout.amountMinor) ||
      session.currency !== checkout.currency ||
      (session.metadata.paymentRequestId && session.metadata.paymentRequestId !== checkout.requestId)
    ) {
      // Not what we asked for: never recorded as a payment, always audited.
      await this.prisma.$transaction(async (tx) => {
        if (meta) await tx.stripeEvent.create({ data: { ...meta, outcome: 'mismatch' } });
        await this.audit.audit(tx, {
          action: 'payment.stripe_mismatch',
          entity: request.familyId ? 'family' : 'lesson',
          entityId: request.familyId ?? (request.trialLessonId as string),
          after: {
            requestId: request.id,
            session: session.id,
            expected: { amountMinor: Number(checkout.amountMinor), currency: checkout.currency },
            got: { amountMinor: session.amountTotal, currency: session.currency },
          },
          reason: 'a Stripe payment did not match the checkout Chat opened; not recorded',
        });
      });
      this.log.error('stripe webhook: a paid session did not match its checkout; audited, not recorded');
      return 'mismatch';
    }

    // The instalment may have been paid otherwise, or voided, while the parent paid.
    let instalmentId: string | null | undefined;
    if (request.instalmentId) {
      const inst = await this.prisma.familyInstalment.findUnique({ where: { id: request.instalmentId } });
      instalmentId = inst && !inst.paidOn && !inst.voidedAt ? inst.id : null;
    }
    const today = todayIn(await this.timeZone());
    // The charge, customer and payment method -- best effort, before the
    // transaction: Stripe being slow or down must never stop the payment
    // being recorded (it is recorded without them; reconciliation shows them).
    const facts = await this.intentFacts(session.paymentIntentId);
    let recorded: RecordedPayment;
    try {
      recorded = await this.prisma.$transaction(async (tx) => {
        if (meta) {
          const inserted = await tx.stripeEvent.createMany({ data: [{ ...meta, outcome: 'recorded' }], skipDuplicates: true });
          if (inserted.count === 0) throw new DuplicateEvent();
        }
        const r = await this.ledger.record(tx, {
          organizationId: request.organizationId,
          familyId: request.familyId,
          trialLessonId: request.trialLessonId,
          learnerId: request.learnerId,
          childName: request.childName,
          requestId: request.id,
          instalmentId,
          method: 'card',
          amountMinor: Number(checkout.amountMinor),
          currency: checkout.currency,
          paidOn: today,
          recordedBy: null,
          reference: session.paymentIntentId,
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: session.paymentIntentId,
          stripe: facts
            ? {
                customerId: facts.customerId ?? safe.customer(session.customerId ?? checkout.stripeCustomerId),
                chargeId: facts.chargeId,
                methodType: facts.methodType,
                cardBrand: facts.cardBrand,
                cardLast4: facts.cardLast4,
                cardWallet: facts.cardWallet,
              }
            : { customerId: safe.customer(session.customerId ?? checkout.stripeCustomerId), chargeId: null, methodType: null, cardBrand: null, cardLast4: null, cardWallet: null },
          auditActorId: null,
          auditReason: 'card payment confirmed by Stripe',
        });
        await tx.paymentCheckout.update({
          where: { stripeSessionId: session.id },
          data: { status: 'complete', stripePaymentIntentId: safe.paymentIntent(session.paymentIntentId) },
        });
        return r;
      });
    } catch (e) {
      if (e instanceof DuplicateEvent) return 'duplicate';
      // Two deliveries at once: the other one recorded it (unique session id).
      if ((e as { code?: string }).code === 'P2002') return 'already_recorded';
      throw e;
    }
    await this.ledger.afterRecorded(recorded);
    await this.syncDeferredRefunds(recorded.payment);
    return 'recorded';
  }

  /** Called by reconciliation: a session Stripe says is paid, with no event (it was lost). */
  async confirmFound(session: CheckoutSession): Promise<WebhookOutcome> {
    return this.confirm(session, null);
  }

  /** Refunds that arrived before this payment was recorded. Best effort: reconciliation retries. */
  private async syncDeferredRefunds(payment: Payment): Promise<void> {
    if (!payment.stripePaymentIntentId) return;
    const waiting = await this.prisma.stripeEvent.count({
      where: { paymentIntentId: payment.stripePaymentIntentId, outcome: 'refund_deferred' },
    });
    if (waiting === 0) return;
    try {
      const n = await this.syncRefunds(payment);
      this.log.log(`stripe: ${n} refund(s) that arrived before their payment recorded`);
    } catch (e) {
      this.log.warn(`stripe: deferred refunds not synced yet (${errorCategory(e)}); reconciliation retries`);
    }
  }

  private async intentFacts(paymentIntentId: string | null): Promise<PaymentIntentFacts | null> {
    if (!paymentIntentId) return null;
    try {
      return await this.stripe.paymentIntentFacts(paymentIntentId);
    } catch (e) {
      this.log.warn(`stripe: payment details not read (${errorCategory(e)}); recorded without them`);
      return null;
    }
  }

  /**
   * Record one Stripe refund of a recorded card payment. `meta` null: found by a
   * sync (no event of its own). Once per Stripe refund id.
   */
  private async recordRefund(meta: EventMeta | null, payment: Payment, refund: RefundFacts): Promise<WebhookOutcome> {
    // Recorded once the refund is on its way; a failed or cancelled one is not money given back.
    if (refund.status !== 'succeeded' && refund.status !== 'pending') {
      if (!meta) return 'refund_not_final';
      if (refund.status === 'failed' || refund.status === 'canceled') {
        const recorded = await this.prisma.paymentRefund.findUnique({ where: { stripeRefundId: refund.id } });
        if (recorded) return this.refundFailedAfterRecord(meta, payment, refund, recorded.id);
      }
      return this.remember(meta, 'refund_not_final');
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        if (meta) {
          const inserted = await tx.stripeEvent.createMany({ data: [{ ...meta, outcome: 'refund_recorded' }], skipDuplicates: true });
          if (inserted.count === 0) throw new DuplicateEvent();
        }
        // The payment's lock first, as the API's refund takes it: a refund the
        // API is recording right now is then seen below, never re-inserted
        // (whose sum check would fail as a 500).
        await tx.$queryRaw`SELECT id FROM chat.payment WHERE id = ${payment.id}::uuid FOR UPDATE`;
        if (await tx.paymentRefund.findUnique({ where: { stripeRefundId: refund.id } })) return;
        // ADMIN-001: a refund our API asked for carries the client's refundId
        // and its recorder. Recorded under that id, a retry of the submit finds
        // it even if the API's own recording was lost. Trusted only as a uuid,
        // and the recorder only as staff of the payment's organization.
        let refundKey = isUuid(refund.metadata?.refundId) ? refund.metadata!.refundId as string : null;
        if (refundKey && (await tx.paymentRefund.findUnique({ where: { id: refundKey } }))) {
          // That key is already a DIFFERENT Stripe refund (the one above would have
          // matched by its Stripe id): real money went back twice -- e.g. a retry
          // after Stripe's 24 h key expiry. Record it as its own row and alert.
          this.log.error(`stripe refund ${refund.id}: its refundId is already recorded as another Stripe refund; recorded separately -- check the payment ${payment.id}`);
          refundKey = null;
        }
        const claimed = isUuid(refund.metadata?.recordedBy) ? refund.metadata!.recordedBy as string : null;
        const recordedBy = claimed
          ? (await tx.staff.findFirst({ where: { id: claimed, organizationId: payment.organizationId }, select: { id: true } }))?.id ?? null
          : null;
        await tx.paymentRefund.create({
          data: {
            ...(refundKey ? { id: refundKey } : {}),
            organizationId: payment.organizationId,
            paymentId: payment.id,
            amountMinor: BigInt(refund.amountMinor),
            reason: refund.reason ? `${WEBHOOK_REFUND_REASON} (${refund.reason})` : WEBHOOK_REFUND_REASON,
            stripeRefundId: refund.id,
            recordedBy,
          },
        });
        await this.audit.audit(tx, {
          ...(recordedBy ? { actorId: recordedBy } : {}),
          action: 'payment.refunded',
          entity: payment.familyId ? 'family' : 'lesson',
          entityId: payment.familyId ?? (payment.trialLessonId as string),
          after: { paymentId: payment.id, amountMinor: refund.amountMinor, currency: payment.currency, stripeRefundId: refund.id },
          reason: 'refund confirmed by Stripe',
        });
      });
    } catch (e) {
      if (e instanceof DuplicateEvent) return 'duplicate';
      if ((e as { code?: string }).code === 'P2002') return 'duplicate';
      throw e;
    }
    return 'refund_recorded';
  }

  /**
   * PD-27 records a refund once it is pending, and refund rows only add up (append-only). When
   * Stripe later fails or cancels one, Chat overstates what went back until a person corrects it:
   * audited (once, with the event) and logged as an error -- never silently.
   * docs/admin/pd027-stripe-lifecycle.md §4.
   */
  private async refundFailedAfterRecord(meta: EventMeta, payment: Payment, refund: RefundFacts, refundRowId: string): Promise<WebhookOutcome> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.stripeEvent.createMany({
          data: [{ ...meta, organizationId: payment.organizationId, outcome: 'refund_failed_after_record' }],
          skipDuplicates: true,
        });
        if (inserted.count === 0) throw new DuplicateEvent();
        await this.audit.audit(tx, {
          action: 'payment.refund_failed_at_stripe',
          entity: payment.familyId ? 'family' : 'lesson',
          entityId: payment.familyId ?? (payment.trialLessonId as string),
          after: { paymentId: payment.id, refundId: refundRowId, stripeRefundId: refund.id, amountMinor: refund.amountMinor, stripeStatus: refund.status },
          reason: 'Stripe failed a refund Chat recorded as pending; the money was not given back -- correct by hand',
        });
      });
    } catch (e) {
      if (e instanceof DuplicateEvent) return 'duplicate';
      throw e;
    }
    this.log.error(`stripe refund ${refund.id} failed at Stripe after Chat recorded it (payment ${payment.id}); audited, needs a person`);
    return 'refund_failed_after_record';
  }

  private async markCheckout(meta: EventMeta, sessionId: string, status: 'expired' | 'failed', outcome: WebhookOutcome): Promise<WebhookOutcome> {
    await this.prisma.paymentCheckout.updateMany({ where: { stripeSessionId: sessionId, status: 'open' }, data: { status } });
    return this.remember(await this.withOrg(meta, sessionId), outcome);
  }

  /** The academy of a checkout Chat opened, onto the event's audit row. */
  private async withOrg(meta: EventMeta, sessionId: string): Promise<EventMeta> {
    const c = await this.prisma.paymentCheckout.findUnique({ where: { stripeSessionId: sessionId }, select: { organizationId: true } });
    return c ? { ...meta, organizationId: c.organizationId } : meta;
  }

  private async remember(meta: EventMeta, outcome: WebhookOutcome): Promise<WebhookOutcome> {
    const inserted = await this.prisma.stripeEvent.createMany({ data: [{ ...meta, outcome }], skipDuplicates: true });
    return inserted.count === 0 ? 'duplicate' : outcome;
  }

  private requirePayable(request: PaymentRequest) {
    if (request.cancelledAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this payment request was cancelled', 409);
    if (request.paidAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this request is already paid', 409);
    if (request.expiresAt <= new Date()) throw new CommError(CommErrorCode.BILLING_STATE, 'this payment link has expired', 409);
  }

  private async timeZone(): Promise<string> {
    const row = await this.prisma.config.findUnique({ where: { key: 'schedule.timezone' } });
    const tz = typeof row?.value === 'string' ? row.value : DEFAULT_TIME_ZONE;
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return tz;
    } catch {
      return DEFAULT_TIME_ZONE;
    }
  }
}

interface EventMeta {
  id: string;
  type: string;
  livemode: boolean;
  /** What the event was about (a session, intent, refund or charge id); its payment intent; Stripe's time. */
  objectId: string | null;
  paymentIntentId: string | null;
  stripeCreatedAt: Date | null;
  organizationId?: string | null;
}

/** The audit row's facts of an event -- never its body. */
function metaOf(event: Stripe.Event): EventMeta {
  const o = event.data?.object as { id?: string; object?: string; payment_intent?: string | { id: string } | null } | undefined;
  const pi = o?.object === 'payment_intent' ? o.id : typeof o?.payment_intent === 'string' ? o.payment_intent : o?.payment_intent?.id;
  return {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    objectId: safe.objectId(o?.id ?? null),
    paymentIntentId: safe.paymentIntent(pi ?? null),
    stripeCreatedAt: typeof event.created === 'number' ? new Date(event.created * 1000) : null,
  };
}

/** A Stripe error's category for a log line: type, code and status -- never its message (it can name parameters). */
export function errorCategory(e: unknown): string {
  const err = e as { type?: string; code?: string; statusCode?: number; name?: string };
  return `${err?.type ?? err?.name ?? 'error'}${err?.code ? ` (${err.code})` : ''}${err?.statusCode ? ` ${err.statusCode}` : ''}`;
}
