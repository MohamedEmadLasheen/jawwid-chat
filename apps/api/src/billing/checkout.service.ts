import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Payment, PaymentCheckout, PaymentRequest } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { todayIn } from '../leave/leave.service';
import { checkoutDescription, isPayableInApp, loadPackageFacts, notInApp } from './in-app-payability';
import { PaymentLedger, type RecordedPayment } from './payment-ledger.service';
import {
  CHAT_STRIPE_SYSTEM,
  STRIPE_GATEWAY,
  safe,
  toDisputeFacts,
  toRefundFacts,
  toSession,
  type CheckoutSession,
  type DisputeFacts,
  type PaymentIntentFacts,
  type RefundFacts,
  type StripeGateway,
} from './stripe.gateway';
import { WEBHOOK_REFUND_REASON } from './idempotency';
import { isCardPaused } from './card-pause';
import { cardCurrencyRefusal, cardRefusal, cardRefusalError } from './currency-rules';
import { pendingReceiptMinor, receiptPendingRefusal } from './payments-read.service';
import { isUuid } from '../communication/conversations/conversation.service';
import { inReviewMode, reviewDemoUrl } from './review-mode';

const DEFAULT_TIME_ZONE = 'Africa/Cairo';
/** Stripe refuses a session that expires sooner than 30 minutes. */
const CHECKOUT_MINUTES = 45;
/** Opening Stripe's page again and again for one request is not paying; it is a loop or abuse. */
const MAX_CHECKOUTS_PER_HOUR = 10;
/**
 * S1: how long a claim on opening one request's page lasts unless renewed. It
 * is renewed before every Stripe call (each at most 20 s x 3 tries), so it only
 * matters when an API process dies mid-open: the request is then free again
 * after this long. Never a lock held open: see claimOpening().
 */
const OPEN_CLAIM_SECONDS = 150;
/** S1: the claim's own transactions are a few statements; they never wait for each other. */
const CLAIM_TRANSACTION = { maxWait: 5_000, timeout: 5_000 } as const;

/**
 * LR-46 (W76b): Stripe never takes a payment on a Checkout Session after its
 * expires_at. A page Stripe cannot be asked about (it no longer has it -- a
 * changed key or mode -- or it is unreachable) is treated as closed only once
 * its own expiry is at least this far behind us: room for clock skew and for a
 * payment submitted in the page's last seconds. Before that, a failed look-up
 * is a refusal (fail closed).
 */
export const UNCONFIRMED_CLOSE_MARGIN_MS = 60 * 60_000;
/** The audit action written when a page is closed that way. */
export const CHECKOUT_CLOSED_UNCONFIRMED_ACTION = 'payment.checkout_closed_unconfirmed';

/** True when a page's own expiry passed long enough ago that Stripe cannot take payment on it any more. */
export function pastPayableWindow(checkout: { expiresAt: Date }, now = Date.now()): boolean {
  return checkout.expiresAt.getTime() + UNCONFIRMED_CLOSE_MARGIN_MS <= now;
}

/**
 * LR-46 (W76b): an `open` attempt Stripe could not be asked about. Marked
 * `expired` -- with the reason audited, in one transaction -- only when
 * pastPayableWindow() says Stripe can no longer take payment on it; otherwise
 * nothing changes. Answers whether this call closed it. A page that was in
 * fact paid is still recorded by its webhook (confirm() finds the attempt by
 * session id, whatever its status). Logs categories only.
 */
export async function closeUnconfirmedCheckout(
  prisma: PrismaService,
  audit: AuditService,
  checkout: PaymentCheckout,
  cause: unknown,
): Promise<boolean> {
  if (checkout.status !== 'open' || !pastPayableWindow(checkout)) return false;
  const request = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: checkout.requestId } });
  return prisma.$transaction(async (tx) => {
    const changed = await tx.paymentCheckout.updateMany({
      where: { stripeSessionId: checkout.stripeSessionId, status: 'open' },
      data: { status: 'expired' },
    });
    if (changed.count !== 1) return false;
    await audit.audit(tx, {
      action: CHECKOUT_CLOSED_UNCONFIRMED_ACTION,
      entity: request.familyId ? 'family' : 'lesson',
      entityId: request.familyId ?? (request.trialLessonId as string),
      after: {
        requestId: request.id,
        session: checkout.stripeSessionId,
        expiresAt: checkout.expiresAt.toISOString(),
        stripeError: errorCategory(cause),
      },
      reason: 'Stripe could not be asked about a card payment page whose expiry passed over an hour ago; Stripe takes no payment after expiry, so it was marked expired',
    });
    return true;
  });
}

/** S1: the chat.config row that says one opener is opening this request's page (holder, until). */
export function checkoutClaimKey(requestId: string): string {
  return `checkout.opening:${requestId}`;
}

/** S1: another tap is opening this request's page right now. Not "paid": try again. */
function alreadyOpening(): CommError {
  return new CommError(CommErrorCode.CHECKOUT_OPENING, 'a payment page is already opening; try again', 409);
}

/** Card payment cannot go ahead right now; the client offers the bank transfer instead. */
function cardUnavailable(): CommError {
  return new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, 'card payment is unavailable right now; pay by bank transfer', 503);
}

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
  /**
   * Stripe Billing (invoices, subscriptions, recurring charges): Chat opens none (PD-27 / PD-30 are
   * prepaid packages). Another system on the same Stripe account may; recorded, never acted on.
   */
  | 'ignored_not_chat'
  /** A refund or dispute about a payment Chat did not take (another system on the same Stripe account): recorded, never acted on. */
  | 'not_chat'
  /** A dispute (chargeback) on one of Chat's card payments: audited and alerted; the money ledger is NOT changed (flag only). */
  | 'dispute_opened'
  | 'dispute_updated'
  | `dispute_closed_${string}`
  | 'dispute_funds_withdrawn'
  | 'dispute_funds_reinstated'
  | 'ignored';

/**
 * Event families Chat never creates; seen when Stripe Billing is used on the
 * account (by another system: Chat's recurring charges do not exist).
 */
const BILLING_EVENT = /^(invoice|customer\.subscription|subscription_schedule)\./;

const DISPUTE_EVENTS = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
]);

/** The outcome of a `charge.dispute.*` event on one of Chat's payments. */
export function disputeOutcome(type: string, status: string | null): WebhookOutcome {
  switch (type) {
    case 'charge.dispute.created':
      return 'dispute_opened';
    case 'charge.dispute.closed':
      return `dispute_closed_${safe.disputeCode(status) ?? 'unknown'}`;
    case 'charge.dispute.funds_withdrawn':
      return 'dispute_funds_withdrawn';
    case 'charge.dispute.funds_reinstated':
      return 'dispute_funds_reinstated';
    default:
      return 'dispute_updated';
  }
}

/** The generic line when a request has no usable label (in-app-payability.ts wording). */
const LESSONS_LINE = 'Live one-to-one Quran lessons';

/**
 * S6: what the parent (and anyone reading the Stripe Dashboard, receipts or
 * exports) sees as the line item: the request's label only, never the child's
 * name. The label is what staff named the request; the period and "live
 * one-to-one lessons" wording travel in the description (checkoutDescription).
 */
export function checkoutProductName(request: { label: string }): string {
  return request.label.trim() || LESSONS_LINE;
}

/**
 * PD-27: card payments through Stripe Checkout.
 *
 * OPENING. A Checkout Session is opened for what a request still owes, at the
 * moment the parent taps Pay (from the link page or the app) -- never ahead of
 * time, so the amount is always current. Before opening another, the request's
 * earlier sessions are looked at: one Stripe completed is RECORDED (its webhook
 * may be late) instead of charging again; one still open is expired, so two
 * Stripe pages for one request are never payable at once. If Stripe cannot
 * confirm an earlier page is closed, no new one is opened (503, bank transfer)
 * -- unless that page's own expiry passed over an hour ago (Stripe takes no
 * payment after it): it is then marked expired, audited (W76b).
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
    // W63: the operator's pause (card-pause.ts) comes first and wins everywhere, App Review mode
    // included. Only new payments stop; webhooks and the reconciler go on.
    if (await isCardPaused(this.prisma)) throw new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, 'card payments are paused; pay by bank transfer', 503);
    // OA-12: an App Review organization never reaches Stripe -- no session, no
    // customer, no payment_checkout row -- only the static demo page.
    if (await inReviewMode(this.prisma, request.organizationId)) return reviewDemoUrl(opts.locale);
    if (!this.stripe.checkoutAvailable) {
      throw new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, 'card payments are not configured on this deployment', 503);
    }
    this.requirePayable(request);
    // S5: a currency Stripe takes no card in (or counts in other minor units): refused before any claim or Stripe call.
    const byCurrency = cardCurrencyRefusal(request.currency);
    if (byCurrency) throw cardRefusalError(byCurrency);

    // A loop or abuse is refused first: one plain read, before any claim or Stripe call.
    const recent = await this.prisma.paymentCheckout.count({
      where: { requestId: request.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= MAX_CHECKOUTS_PER_HOUR) {
      throw new CommError(CommErrorCode.BILLING_STATE, 'too many payment attempts for this request; try again in an hour', 429);
    }

    // S1: one opener per request at a time. Two taps (two devices, a double
    // submit) would otherwise both find no open session and both create one --
    // two payable Stripe pages for one request. The first tap CLAIMS the
    // request in a short transaction; a second tap meanwhile is refused at once
    // (409 CHECKOUT_OPENING) instead of waiting. No transaction is open and no
    // connection is held while Stripe is asked.
    const holder = await this.claimOpening(request.id);
    try {
      return await this.openClaimed(request, opts, holder);
    } finally {
      await this.releaseOpening(request.id, holder);
    }
  }

  /**
   * S1: claim the right to open this request's page. A short transaction: a
   * non-blocking advisory lock (a concurrent claimer is refused, never queued),
   * then a chat.config row naming this opener until a time. A claim whose time
   * has passed (its API process died) is taken over. Answers the holder id.
   */
  private async claimOpening(requestId: string): Promise<string> {
    const key = checkoutClaimKey(requestId);
    const holder = randomUUID();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
      if (lock?.locked !== true) return false;
      const rows = await tx.$queryRaw<Array<{ key: string }>>`
        INSERT INTO chat.config AS c (key, value, scope, description)
        VALUES (${key},
                jsonb_build_object('holder', ${holder}::text, 'until', now() + ${OPEN_CLAIM_SECONDS}::int * interval '1 second'),
                'checkout', 'PD-27 S1: a Stripe Checkout page is being opened for this request (removed when done).')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         WHERE (c.value ->> 'until')::timestamptz <= now()
        RETURNING key`;
      return rows.length === 1;
    }, CLAIM_TRANSACTION);
    if (!claimed) throw alreadyOpening();
    return holder;
  }

  /**
   * S1: still ours? Renewed before every Stripe call. If another opener took
   * the request over (ours ran past its time), nothing more is done: no Stripe
   * call is ever made without the claim.
   */
  private async holdOpening(requestId: string, holder: string): Promise<void> {
    const renewed = await this.prisma.$executeRaw`
      UPDATE chat.config
         SET value = jsonb_build_object('holder', ${holder}::text, 'until', now() + ${OPEN_CLAIM_SECONDS}::int * interval '1 second'),
             updated_at = now()
       WHERE key = ${checkoutClaimKey(requestId)} AND value ->> 'holder' = ${holder}`;
    if (renewed !== 1) {
      this.log.warn('stripe checkout: this opener\'s claim was taken over; stopping before Stripe is asked');
      throw alreadyOpening();
    }
  }

  /**
   * An earlier page, looked up at Stripe while opening. Answers Stripe's
   * session, or null when the look-up failed but the page's own expiry is long
   * past and it was just marked expired (closeUnconfirmedCheckout). Any other
   * failure (timeout, 5xx, not found, anything) is never turned into a local
   * change: it is the bank-transfer answer (503). Stripe's own message is never
   * shown; the category is logged. A claim taken over is still the 409.
   */
  private async lookUpEarlier(c: PaymentCheckout, requestId: string, holder: string, what: string): Promise<CheckoutSession | null> {
    try {
      return await this.stripe.retrieveCheckout(c.stripeSessionId);
    } catch (e) {
      if (pastPayableWindow(c)) {
        await this.holdOpening(requestId, holder);
        if (await closeUnconfirmedCheckout(this.prisma, this.audit, c, e)) {
          this.log.warn(`stripe checkout: could not ${what} (${errorCategory(e)}); its expiry is long past, so it was marked expired (audited)`);
          return null;
        }
      }
      this.log.error(`stripe checkout: could not ${what} (${errorCategory(e)}); no new page is opened`);
      throw cardUnavailable();
    }
  }

  /** S1: the claim is given up (only our own; a later opener's is never removed). Best effort: it expires anyway. */
  private async releaseOpening(requestId: string, holder: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        DELETE FROM chat.config WHERE key = ${checkoutClaimKey(requestId)} AND value ->> 'holder' = ${holder}`;
    } catch (e) {
      this.log.warn(`stripe checkout: claim not released (${errorCategory(e)}); it expires in ${OPEN_CLAIM_SECONDS} s`);
    }
  }

  /** open(), holding the request's claim. Every Stripe call runs with no transaction open. */
  private async openClaimed(
    request: PaymentRequest,
    opts: { locale: 'ar' | 'en'; returnUrl: string; inApp?: boolean },
    holder: string,
  ): Promise<string> {
    // Earlier sessions: record a completed one, expire an open one. FAIL CLOSED
    // (LR-46 P2-1): a row changes only on what Stripe answered. If Stripe cannot
    // say an earlier page is closed (it is unreachable, or refuses to expire a
    // page that is still open), no new page is created -- the earlier one may
    // still be payable, and two payable pages charge a parent twice. The parent
    // is offered the bank transfer (503) and the next tap tries again; such a
    // tap creates no session, so the hourly cap (MAX_CHECKOUTS_PER_HOUR) does
    // not count it -- each costs one or two Stripe look-ups. The one exception
    // (W76b): a page Stripe cannot be asked about whose own expiry passed long
    // ago (pastPayableWindow) cannot take payment any more; it is marked
    // expired with an audited reason, so it never blocks card payment forever.
    const open = await this.prisma.paymentCheckout.findMany({ where: { requestId: request.id, status: 'open' } });
    for (const c of open) {
      await this.holdOpening(request.id, holder);
      let session = await this.lookUpEarlier(c, request.id, holder, 'look up an earlier page');
      if (!session) continue;
      if (session.status === 'open') {
        await this.holdOpening(request.id, holder);
        try {
          await this.stripe.expireCheckout(session.id);
          session = { ...session, status: 'expired' };
        } catch (e) {
          // Paid or expired between the two calls, or Stripe failed: ask Stripe
          // which. Only its answer closes the row; still open is a refusal.
          this.log.warn(`stripe checkout: an earlier page was not expired (${errorCategory(e)}); asking Stripe again`);
          await this.holdOpening(request.id, holder);
          session = await this.lookUpEarlier(c, request.id, holder, 'look up an earlier page again');
          if (!session) continue;
          if (session.status === 'open') {
            this.log.error('stripe checkout: an earlier page is still payable and could not be expired; no new page is opened');
            throw cardUnavailable();
          }
        }
      }
      await this.holdOpening(request.id, holder);
      if (session.status === 'complete' && session.paymentStatus === 'paid') {
        await this.confirm(session, null);
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
    // W61 S2: transfer receipts the academy has not checked yet already cover the rest -- a card would charge twice.
    const pendingMinor = await pendingReceiptMinor(this.prisma, fresh);
    if (pendingMinor >= remaining) throw receiptPendingRefusal(pendingMinor, remaining);
    // S5: what is charged is what is LEFT; below Stripe's minimum it is never sent (bank transfer only).
    const refusal = cardRefusal(fresh.currency, remaining);
    if (refusal) throw cardRefusalError(refusal);

    const attempts = await this.prisma.paymentCheckout.count({ where: { requestId: fresh.id } });
    const lessons = isPayableInApp(fresh, await loadPackageFacts(this.prisma, { requests: [fresh] }));
    // From the app: checked again just before Stripe is asked (a package voided since).
    if (opts.inApp && !lessons) throw notInApp();
    const sep = opts.returnUrl.includes('?') ? '&' : '?';
    await this.holdOpening(fresh.id, holder);
    let customerId = await this.customerFor(fresh);
    const input = {
      requestId: fresh.id,
      organizationId: fresh.organizationId,
      amountMinor: remaining,
      currency: fresh.currency,
      productName: checkoutProductName(fresh),
      description: checkoutDescription(fresh, lessons, opts.locale),
      successUrl: `${opts.returnUrl}${sep}checkout=success`,
      cancelUrl: `${opts.returnUrl}${sep}checkout=cancelled`,
      expiresAt: new Date(Date.now() + CHECKOUT_MINUTES * 60_000),
      locale: opts.locale,
      idempotencyKey: `checkout:${fresh.id}:${attempts}`,
    };
    let session: CheckoutSession;
    await this.holdOpening(fresh.id, holder);
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
        await this.holdOpening(fresh.id, holder);
        session = await this.stripe.createCheckout({ ...input, customerId, idempotencyKey: `${input.idempotencyKey}:guest` });
      }
    } catch (e) {
      // Our claim was taken over: the same 409, never "card payments are unavailable".
      if (e instanceof CommError && e.code === CommErrorCode.CHECKOUT_OPENING) throw e;
      // Stripe's own message never reaches a parent (it can name parameters,
      // and it is English API prose); the category is logged, never the body
      // or the key. The client offers the bank transfer instead.
      this.log.error(`stripe checkout refused: ${errorCategory(e)}`);
      throw cardUnavailable();
    }
    if (!session.url) throw new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, 'Stripe did not return a payment page', 503);
    // The session is recorded whatever happens next (so a later opener, the
    // webhook and the reconciler all know it), and in the same short
    // transaction we look whether the claim is still ours.
    let held: boolean;
    try {
      held = await this.prisma.$transaction(async (tx) => {
        const mine = await tx.$queryRaw<Array<{ key: string }>>`
          SELECT key FROM chat.config WHERE key = ${checkoutClaimKey(fresh.id)} AND value ->> 'holder' = ${holder} FOR UPDATE`;
        await tx.paymentCheckout.create({
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
        return mine.length === 1;
      }, CLAIM_TRANSACTION);
    } catch (e) {
      // S1: the same Stripe session is already recorded -- Stripe answered a
      // replayed idempotency key with the session another open() recorded. A
      // replay, not a failure: the same page, never a 500.
      if ((e as { code?: string }).code !== 'P2002') throw e;
      const known = await this.prisma.paymentCheckout.findUnique({ where: { stripeSessionId: session.id } });
      if (!known || known.requestId !== fresh.id) throw e;
      this.log.warn('stripe checkout: the session was already recorded (a replayed open); answering the same page');
      return session.url;
    }
    if (!held) {
      // Stripe took longer than the claim and another opener took the request
      // over: it may be creating its own page right now. Ours is never handed
      // out; it is expired, so at most one page stays payable.
      this.log.warn('stripe checkout: the claim was taken over while Stripe answered; this page is expired, not handed out');
      try {
        await this.stripe.expireCheckout(session.id);
        await this.prisma.paymentCheckout.updateMany({ where: { stripeSessionId: session.id, status: 'open' }, data: { status: 'expired' } });
      } catch {
        // Recorded open: the next opener expires it, or its webhook records it.
      }
      throw alreadyOpening();
    }
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
        if (DISPUTE_EVENTS.has(event.type)) return this.disputeEvent(meta, event.type, toDisputeFacts(event.data.object as Stripe.Dispute));
        if (BILLING_EVENT.test(event.type)) {
          // Expected when another system bills on the same Stripe account; not a warning about Chat.
          this.log.log(`stripe webhook: ${event.type} -- Stripe Billing is not Chat's (Chat opens no subscriptions or invoices); recorded, not acted on`);
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
    // Its payment is not recorded. A payment Chat did not take (another system
    // on the same Stripe account) is not_chat: recorded, never acted on. One of
    // Chat's checkouts whose payment is not recorded yet (the refund arrived
    // first), or one Chat cannot tell, is kept with its payment intent, so
    // recording the payment (and the reconciler) syncs it. Never dropped.
    if (!payment) return this.unrecordedRefund(meta, refund.paymentIntentId);
    return this.recordRefund({ ...meta, organizationId: payment.organizationId }, payment, refund);
  }

  /** A refund (or charge.refunded) whose payment Chat has not recorded: not_chat, or kept as refund_deferred. */
  private async unrecordedRefund(meta: EventMeta, paymentIntentId: string | null): Promise<WebhookOutcome> {
    let checkout: PaymentCheckout | null | undefined;
    try {
      const found = await this.lookUpChatCheckout(paymentIntentId);
      checkout = found.checkout;
      // No Chat checkout, but Stripe says the object is Chat's (the tag on the
      // session or its payment intent): Chat's own row is missing, or Stripe's
      // session list came back empty. Kept as refund_deferred, so the reconciler
      // and the payment's recording still sync it; not_chat would lose it silently.
      if (checkout === null && paymentIntentId && (await this.taggedChat(paymentIntentId, found.session))) {
        this.log.warn('stripe webhook: a refund on a payment intent tagged jawwid-chat has no Chat checkout; kept as deferred (check it in the Stripe Dashboard)');
        checkout = undefined;
      }
    } catch (e) {
      // Stripe unreachable: kept (the reconciler syncs it once the payment exists); harmless if foreign.
      this.log.warn(`stripe webhook: a refund's payment was not looked up (${errorCategory(e)}); kept as deferred`);
      checkout = undefined;
    }
    if (checkout === null) return this.remember(meta, 'not_chat');
    return this.remember(checkout ? { ...meta, organizationId: checkout.organizationId } : meta, 'refund_deferred');
  }

  /** The session or its payment intent carries Chat's system tag. A hint for keeping a refund, never proof of ownership. */
  private async taggedChat(paymentIntentId: string, session: CheckoutSession | null): Promise<boolean> {
    if (session?.metadata?.system === CHAT_STRIPE_SYSTEM) return true;
    return (await this.stripe.paymentIntentSystem(paymentIntentId)) === CHAT_STRIPE_SYSTEM;
  }

  /**
   * S3: the checkout Chat opened for a payment intent -- from Chat's own table,
   * never from metadata alone. null: not Chat's (no payment intent; or Stripe
   * knows no checkout for it, or one Chat did not open). undefined: Chat cannot
   * tell (no secret key to ask Stripe with). Throws when Stripe is unreachable.
   */
  private async chatCheckoutFor(paymentIntentId: string | null): Promise<PaymentCheckout | null | undefined> {
    return (await this.lookUpChatCheckout(paymentIntentId)).checkout;
  }

  /** chatCheckoutFor, plus the Stripe session it asked about (null when none was asked for or found). */
  private async lookUpChatCheckout(
    paymentIntentId: string | null,
  ): Promise<{ checkout: PaymentCheckout | null | undefined; session: CheckoutSession | null }> {
    if (!paymentIntentId) return { checkout: null, session: null };
    const local = await this.prisma.paymentCheckout.findFirst({ where: { stripePaymentIntentId: paymentIntentId } });
    if (local) return { checkout: local, session: null };
    if (!this.stripe.checkoutAvailable) return { checkout: undefined, session: null };
    const session = await this.stripe.findCheckoutByPaymentIntent(paymentIntentId);
    if (!session) return { checkout: null, session: null };
    const checkout = await this.prisma.paymentCheckout.findUnique({ where: { stripeSessionId: session.id } });
    return { checkout: checkout ?? null, session };
  }

  /**
   * M2: a dispute (chargeback) on a card payment. Chat's own payments only --
   * matched by payment intent, else by charge, to chat.payment (or to a checkout
   * Chat opened whose payment is not recorded yet). Anything else is not_chat.
   *
   * FLAG ONLY. The money ledger is not changed: no refund row, no void, the
   * package stands. The event row and an audit row are written together (once
   * per event), and opened / funds withdrawn log an error so a person responds
   * in the Stripe Dashboard before Stripe's evidence deadline.
   * docs/admin/pd027-stripe-lifecycle.md §4.
   */
  private async disputeEvent(meta: EventMeta, type: string, dispute: DisputeFacts): Promise<WebhookOutcome> {
    const m: EventMeta = { ...meta, paymentIntentId: meta.paymentIntentId ?? dispute.paymentIntentId };
    const owner = await this.disputedPayment(dispute);
    if (!owner) return this.remember(m, 'not_chat');

    const outcome = disputeOutcome(type, dispute.status);
    try {
      await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.stripeEvent.createMany({ data: [{ ...m, organizationId: owner.organizationId, outcome }], skipDuplicates: true });
        if (inserted.count === 0) throw new DuplicateEvent();
        await this.audit.audit(tx, {
          // payment.dispute_opened | _updated | _closed | _funds_withdrawn | _funds_reinstated
          action: `payment.${outcome.startsWith('dispute_closed_') ? 'dispute_closed' : outcome}`,
          entity: owner.familyId ? 'family' : 'lesson',
          entityId: (owner.familyId ?? owner.trialLessonId) as string,
          after: {
            paymentId: owner.paymentId,
            requestId: owner.requestId,
            disputeId: safe.objectId(dispute.id),
            chargeId: dispute.chargeId,
            paymentIntentId: dispute.paymentIntentId,
            amountMinor: dispute.amountMinor,
            currency: dispute.currency,
            stripeStatus: dispute.status,
            stripeReason: dispute.reason,
            outcome,
          },
          reason: 'a Stripe dispute on a Chat card payment; recorded and flagged, the money ledger is not changed -- respond in the Stripe Dashboard',
        });
      });
    } catch (e) {
      if (e instanceof DuplicateEvent) return 'duplicate';
      throw e;
    }
    const line = `stripe dispute ${dispute.id}: ${outcome} on ${owner.paymentId ? `payment ${owner.paymentId}` : `request ${owner.requestId} (payment not recorded yet)`}; audited, ledger unchanged`;
    if (outcome === 'dispute_opened' || outcome === 'dispute_funds_withdrawn') this.log.error(`${line} -- needs a person`);
    else this.log.warn(line);
    return outcome;
  }

  /** The Chat payment (or, before it is recorded, the Chat request) a dispute is about; null when it is not Chat's. */
  private async disputedPayment(dispute: DisputeFacts): Promise<DisputeOwner | null> {
    let payment: Payment | null = null;
    if (dispute.paymentIntentId) payment = await this.prisma.payment.findUnique({ where: { stripePaymentIntentId: dispute.paymentIntentId } });
    if (!payment && dispute.chargeId) payment = await this.prisma.payment.findUnique({ where: { stripeChargeId: dispute.chargeId } });
    if (payment) {
      return payment.familyId || payment.trialLessonId
        ? { organizationId: payment.organizationId, familyId: payment.familyId, trialLessonId: payment.trialLessonId, paymentId: payment.id, requestId: payment.requestId }
        : null;
    }
    // Rare: disputed before Chat recorded the payment (its webhook lost). Throws
    // if Stripe is unreachable: the webhook answers 500 and Stripe retries.
    const checkout = await this.chatCheckoutFor(dispute.paymentIntentId);
    const request = checkout ? await this.prisma.paymentRequest.findUnique({ where: { id: checkout.requestId } }) : null;
    if (!request || (!request.familyId && !request.trialLessonId)) return null;
    return { organizationId: request.organizationId, familyId: request.familyId, trialLessonId: request.trialLessonId, paymentId: null, requestId: request.id };
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
    // Not Chat's payment: not_chat. Chat's but not recorded yet: kept for the sync.
    if (!payment) return this.unrecordedRefund(m, intent);
    // No key to list the refunds with: kept for the sync.
    if (!this.stripe.checkoutAvailable) return this.remember({ ...m, organizationId: payment.organizationId }, 'refund_deferred');
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

  /** W76b: closeUnconfirmedCheckout() for the reconciler (an attempt Stripe could not be asked about). */
  closeUnconfirmed(checkout: PaymentCheckout, cause: unknown): Promise<boolean> {
    return closeUnconfirmedCheckout(this.prisma, this.audit, checkout, cause);
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

interface DisputeOwner {
  organizationId: string;
  familyId: string | null;
  trialLessonId: string | null;
  paymentId: string | null;
  requestId: string | null;
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
