import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PaymentRequest } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { todayIn } from '../leave/leave.service';
import { PaymentLedger, type RecordedPayment } from './payment-ledger.service';
import { STRIPE_GATEWAY, toSession, type CheckoutSession, type StripeGateway } from './stripe.gateway';

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
  | 'refund_unknown_payment'
  | 'refund_not_final'
  | 'ignored';

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
  async open(request: PaymentRequest, opts: { locale: 'ar' | 'en'; returnUrl: string }): Promise<string> {
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
    const sep = opts.returnUrl.includes('?') ? '&' : '?';
    let session: CheckoutSession;
    try {
      session = await this.stripe.createCheckout({
        requestId: fresh.id,
        organizationId: fresh.organizationId,
        amountMinor: remaining,
        currency: fresh.currency,
        productName: fresh.childName ? `${fresh.label} — ${fresh.childName}` : fresh.label,
        description: fresh.periodStart && fresh.periodEnd
          ? `${fresh.periodStart.toISOString().slice(0, 10)} → ${fresh.periodEnd.toISOString().slice(0, 10)}`
          : null,
        successUrl: `${opts.returnUrl}${sep}checkout=success`,
        cancelUrl: `${opts.returnUrl}${sep}checkout=cancelled`,
        expiresAt: new Date(Date.now() + CHECKOUT_MINUTES * 60_000),
        locale: opts.locale,
        idempotencyKey: `checkout:${fresh.id}:${attempts}`,
      });
    } catch (e) {
      // Stripe's own message never reaches a parent (it can name parameters,
      // and it is English API prose); the category is logged, never the body
      // or the key. The client offers the bank transfer instead.
      const err = e as { type?: string; code?: string; statusCode?: number; name?: string };
      this.log.error(`stripe checkout refused: ${err.type ?? err.name ?? 'error'}${err.code ? ` (${err.code})` : ''}${err.statusCode ? ` ${err.statusCode}` : ''}`);
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
      },
    });
    return session.url;
  }

  /** One verified Stripe event. Always answers an outcome; throws only to make Stripe retry. */
  async handleEvent(event: Stripe.Event): Promise<WebhookOutcome> {
    if (await this.prisma.stripeEvent.findUnique({ where: { id: event.id } })) return 'duplicate';
    const meta = { id: event.id, type: event.type, livemode: event.livemode };
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = toSession(event.data.object as Stripe.Checkout.Session);
        if (session.paymentStatus !== 'paid') return this.remember(meta, 'awaiting_payment');
        return this.confirm(session, meta);
      }
      case 'checkout.session.async_payment_failed':
        return this.markCheckout(meta, (event.data.object as Stripe.Checkout.Session).id, 'failed', 'checkout_failed');
      case 'checkout.session.expired':
        return this.markCheckout(meta, (event.data.object as Stripe.Checkout.Session).id, 'expired', 'checkout_expired');
      case 'refund.created':
      case 'refund.updated':
        return this.recordStripeRefund(meta, event.data.object as Stripe.Refund);
      default:
        return this.remember(meta, 'ignored');
    }
  }

  /**
   * Record a session Stripe says is paid. `meta` null: found while opening a new
   * checkout (no event yet); the later event then finds it already recorded.
   */
  private async confirm(session: CheckoutSession, meta: EventMeta | null): Promise<WebhookOutcome> {
    const checkout = await this.prisma.paymentCheckout.findUnique({ where: { stripeSessionId: session.id } });
    if (!checkout) return meta ? this.remember(meta, 'unknown_session') : 'unknown_session';
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
          auditActorId: null,
          auditReason: 'card payment confirmed by Stripe',
        });
        await tx.paymentCheckout.update({ where: { stripeSessionId: session.id }, data: { status: 'complete' } });
        return r;
      });
    } catch (e) {
      if (e instanceof DuplicateEvent) return 'duplicate';
      // Two deliveries at once: the other one recorded it (unique session id).
      if ((e as { code?: string }).code === 'P2002') return 'already_recorded';
      throw e;
    }
    await this.ledger.afterRecorded(recorded);
    return 'recorded';
  }

  private async recordStripeRefund(meta: EventMeta, refund: Stripe.Refund): Promise<WebhookOutcome> {
    const intent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id ?? null;
    const payment = intent ? await this.prisma.payment.findUnique({ where: { stripePaymentIntentId: intent } }) : null;
    if (!payment) return this.remember(meta, 'refund_unknown_payment');
    // Recorded once the refund is on its way; a failed or cancelled one is not money given back.
    if (refund.status !== 'succeeded' && refund.status !== 'pending') return this.remember(meta, 'refund_not_final');
    try {
      await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.stripeEvent.createMany({ data: [{ ...meta, outcome: 'refund_recorded' }], skipDuplicates: true });
        if (inserted.count === 0) throw new DuplicateEvent();
        if (await tx.paymentRefund.findUnique({ where: { stripeRefundId: refund.id } })) return;
        await tx.paymentRefund.create({
          data: {
            organizationId: payment.organizationId,
            paymentId: payment.id,
            amountMinor: BigInt(refund.amount),
            reason: refund.reason ? `refunded in Stripe (${refund.reason})` : 'refunded in Stripe',
            stripeRefundId: refund.id,
          },
        });
        await this.audit.audit(tx, {
          action: 'payment.refunded',
          entity: payment.familyId ? 'family' : 'lesson',
          entityId: payment.familyId ?? (payment.trialLessonId as string),
          after: { paymentId: payment.id, amountMinor: refund.amount, currency: payment.currency, stripeRefundId: refund.id },
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

  private async markCheckout(meta: EventMeta, sessionId: string, status: 'expired' | 'failed', outcome: WebhookOutcome): Promise<WebhookOutcome> {
    await this.prisma.paymentCheckout.updateMany({ where: { stripeSessionId: sessionId, status: 'open' }, data: { status } });
    return this.remember(meta, outcome);
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
}
