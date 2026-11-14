import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type PaymentCheckout } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { familyInScope } from './billing-access';
import { BillingService } from './billing.service';
import { CheckoutService, errorCategory } from './checkout.service';
import { STRIPE_GATEWAY, type CheckoutSession, type StripeGateway } from './stripe.gateway';

/** An attempt this old with no webhook is asked about (Stripe normally answers within seconds). */
const STALE_AFTER_MS = 10 * 60_000;
/** Attempts further back are left alone (Stripe's sessions last 45 minutes; this is history). */
const LOOK_BACK_MS = 30 * 24 * 60 * 60_000;
/** Per pass, so one slow Stripe never holds the loop for long. */
const BATCH = 25;

export interface ReconcileSweepResult {
  checked: number;
  recorded: number;
  expired: number;
  refundsRecorded: number;
  errors: number;
}

export interface PaymentReconciliation {
  paymentId: string;
  inSync: boolean;
  recordedRefunds: number;
  chat: { amountMinor: number; refundedMinor: number; currency: string };
  stripe: { status: string; amountReceivedMinor: number; amountRefundedMinor: number; currency: string };
}

/**
 * PD-27 completion: status synchronization with Stripe, for when a webhook never
 * came (the endpoint was down past Stripe's three days of retries, or was not
 * subscribed to an event). Everything goes through CheckoutService's own
 * idempotent paths, so reconciling and a late webhook can never record one
 * payment or one refund twice.
 *
 *   sweep()            the worker, every STRIPE_RECONCILE_MS: card attempts still
 *                      open 10 minutes on -> asked of Stripe (paid: recorded;
 *                      expired: marked; not found and its own expiry over an
 *                      hour past: marked expired, audited); refunds that arrived before their
 *                      payment -> synced once the payment exists.
 *   reconcileNow()     the same, now, for the actor's academy (canVerify).
 *   reconcilePayment() one card payment beside Stripe's own numbers; any refund
 *                      Stripe made that Chat lacks is recorded (canVerify).
 *
 * Logs counts and categories only -- never a body, an amount with a name, or a key.
 */
@Injectable()
export class StripeReconciler {
  private readonly log = new Logger(StripeReconciler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly billing: BillingService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  async sweep(opts: { organizationId?: string } = {}): Promise<ReconcileSweepResult> {
    const result: ReconcileSweepResult = { checked: 0, recorded: 0, expired: 0, refundsRecorded: 0, errors: 0 };
    if (!this.stripe.checkoutAvailable) return result;
    const now = Date.now();
    const stale = await this.prisma.paymentCheckout.findMany({
      where: {
        status: 'open',
        createdAt: { lt: new Date(now - STALE_AFTER_MS), gt: new Date(now - LOOK_BACK_MS) },
        ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    for (const c of stale) {
      result.checked++;
      let session: CheckoutSession;
      try {
        session = await this.stripe.retrieveCheckout(c.stripeSessionId);
      } catch (e) {
        // W76b: Stripe cannot be asked about it (it no longer has the session,
        // or is down). Closed only when its own expiry is long past and Stripe
        // can no longer take payment on it (audited); otherwise left open and
        // asked again next pass -- a transient error never closes a live page.
        // Only a failed LOOK-UP gets here: a failure recording what Stripe
        // answered (below) never closes a row.
        if (await this.closeUnconfirmed(c, e)) {
          result.expired++;
          this.log.warn(`stripe reconcile: checkout not found at Stripe (${errorCategory(e)}) and long expired; marked expired (audited)`);
        } else {
          result.errors++;
          this.log.warn(`stripe reconcile: checkout not checked (${errorCategory(e)})`);
        }
        continue;
      }
      try {
        if (session.status === 'complete' && session.paymentStatus === 'paid') {
          const outcome = await this.checkout.confirmFound(session);
          if (outcome === 'recorded') {
            result.recorded++;
            this.log.warn('stripe reconcile: a paid checkout had no webhook; recorded from Stripe');
          }
        } else if (session.status === 'expired') {
          await this.prisma.paymentCheckout.updateMany({ where: { stripeSessionId: c.stripeSessionId, status: 'open' }, data: { status: 'expired' } });
          result.expired++;
        }
        // open (the parent is still on the page) or complete-but-unpaid (a
        // delayed method): asked again next pass.
      } catch (e) {
        result.errors++;
        this.log.warn(`stripe reconcile: checkout not checked (${errorCategory(e)})`);
      }
    }

    // Refunds kept because their payment was not recorded yet, whose payment now
    // is, and that are still missing (by the refund's own id; a charge.refunded
    // is resolved once any refund of that payment was recorded after it).
    const orgFilter = opts.organizationId ? Prisma.sql`AND p.organization_id = ${opts.organizationId}::uuid` : Prisma.empty;
    const waiting = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT p.id
        FROM chat.stripe_event e
        JOIN chat.payment p ON p.stripe_payment_intent_id = e.payment_intent_id
       WHERE e.outcome = 'refund_deferred'
         AND e.received_at > now() - interval '30 days'
         ${orgFilter}
         AND NOT EXISTS (SELECT 1 FROM chat.payment_refund r WHERE r.stripe_refund_id = e.object_id)
         AND NOT (e.object_id NOT LIKE 're\\_%' AND EXISTS (
               SELECT 1 FROM chat.payment_refund r WHERE r.payment_id = p.id AND r.created_at >= e.received_at))
       LIMIT ${BATCH}`;
    for (const { id } of waiting) {
      try {
        const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id } });
        result.refundsRecorded += await this.checkout.syncRefunds(payment);
      } catch (e) {
        result.errors++;
        this.log.warn(`stripe reconcile: refunds not synced (${errorCategory(e)})`);
      }
    }
    if (result.recorded || result.refundsRecorded || result.errors) {
      this.log.log(`stripe reconcile: checked=${result.checked} recorded=${result.recorded} expired=${result.expired} refunds=${result.refundsRecorded} errors=${result.errors}`);
    }
    return result;
  }

  /** CheckoutService.closeUnconfirmed, never throwing: a database failure here is one more error of the pass. */
  private async closeUnconfirmed(c: PaymentCheckout, cause: unknown): Promise<boolean> {
    try {
      return await this.checkout.closeUnconfirmed(c, cause);
    } catch (e) {
      this.log.warn(`stripe reconcile: a long-expired checkout was not closed (${errorCategory(e)})`);
      return false;
    }
  }

  /** POST /stripe/reconcile -- the sweep, now, for the actor's own academy. */
  async reconcileNow(actorId: string): Promise<ReconcileSweepResult> {
    const { actor, access } = await this.billing.requireReader(actorId);
    if (!access.canVerify || !actor.organizationId) throw new CommError(CommErrorCode.BILLING_DENIED, 'only the super admin and the Operations Manager reconcile with Stripe', 403);
    this.requireStripe();
    return this.sweep({ organizationId: actor.organizationId });
  }

  /** POST /payments/:id/reconcile -- one card payment beside Stripe's numbers. */
  async reconcilePayment(actorId: string, paymentId: string): Promise<PaymentReconciliation> {
    const { actor, access } = await this.billing.requireReader(actorId);
    if (!access.canVerify) throw new CommError(CommErrorCode.BILLING_DENIED, 'only the super admin and the Operations Manager reconcile with Stripe', 403);
    const payment = isUuidLike(paymentId) ? await this.prisma.payment.findUnique({ where: { id: paymentId } }) : null;
    if (
      !payment ||
      payment.organizationId !== actor.organizationId ||
      (payment.familyId && !(await familyInScope(this.prisma, actor, access, payment.familyId)))
    ) {
      throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'payment not found', 404);
    }
    if (payment.method !== 'card' || !payment.stripePaymentIntentId) {
      throw new CommError(CommErrorCode.BILLING_STATE, 'only a card payment is reconciled with Stripe', 409);
    }
    this.requireStripe();
    let facts;
    let recordedRefunds = 0;
    try {
      facts = await this.stripe.paymentIntentFacts(payment.stripePaymentIntentId);
      recordedRefunds = await this.checkout.syncRefunds(payment);
    } catch (e) {
      if (e instanceof CommError) throw e;
      this.log.warn(`stripe reconcile: payment not read from Stripe (${errorCategory(e)})`);
      throw new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, 'Stripe could not be reached; try again shortly', 503);
    }
    const refunded = await this.prisma.paymentRefund.aggregate({ where: { paymentId: payment.id }, _sum: { amountMinor: true } });
    const chat = {
      amountMinor: Number(payment.amountMinor),
      refundedMinor: Number(refunded._sum.amountMinor ?? 0n),
      currency: payment.currency,
    };
    const stripe = {
      status: facts.status,
      amountReceivedMinor: facts.amountReceivedMinor,
      amountRefundedMinor: facts.amountRefundedMinor,
      currency: facts.currency,
    };
    const inSync =
      stripe.status === 'succeeded' &&
      stripe.currency === chat.currency &&
      stripe.amountReceivedMinor === chat.amountMinor &&
      stripe.amountRefundedMinor === chat.refundedMinor;
    if (!inSync) this.log.warn(`stripe reconcile: payment ${payment.id} differs from Stripe`);
    return { paymentId: payment.id, inSync, recordedRefunds, chat, stripe };
  }

  private requireStripe() {
    if (!this.stripe.checkoutAvailable) {
      throw new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, 'Stripe is not configured on this deployment', 503);
    }
  }
}

function isUuidLike(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
