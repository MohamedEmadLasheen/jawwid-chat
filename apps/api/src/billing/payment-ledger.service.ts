import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { FamilyInstalment, Invoice, Payment, PaymentRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { currentRequestOrigin } from '../platform/request-origin';
import { NotificationService } from '../communication/notifications/notification.service';
import { ReminderService } from '../communication/notifications/reminder.service';
import { NotificationPipeline } from '../communication/notifications/notification-pipeline.service';
import { GENERIC_PUSH_TEMPLATE, lockScreenTemplate } from './lock-screen-push';
import { formatMajor } from './money';
import { dateOnly, day } from './validate';

type Tx = Prisma.TransactionClient;

export const PAYMENT_METHODS = ['card', 'bank_transfer', 'cash', 'invoice'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const REQUEST_PURPOSES = ['subscription', 'renewal', 'instalment', 'balance', 'other'] as const;
export type RequestPurpose = (typeof REQUEST_PURPOSES)[number];

/** chat.config keys PD-27 reads (written through /billing/settings). */
export const BANK_ACCOUNT_KEY = 'billing.bank_account';
export const INVOICE_ISSUER_KEY = 'billing.invoice_issuer';

export interface RecordPaymentInput {
  /** ADMIN-001: the client's idempotency key, used as the payment's id (gen_random_uuid() otherwise). */
  id?: string;
  organizationId: string;
  familyId: string | null;
  trialLessonId: string | null;
  learnerId: string | null;
  childName: string | null;
  requestId: string | null;
  /** undefined = the request's own instalment (if any); null = none. */
  instalmentId?: string | null;
  method: PaymentMethod;
  amountMinor: number;
  currency: string;
  paidOn: string;
  /** null only for a card payment (Stripe confirmed it). */
  recordedBy: string | null;
  reference: string | null;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  /** 20261107120000: a card payment's Stripe references and payment method (checked by `safe`). */
  stripe?: {
    customerId: string | null;
    chargeId: string | null;
    methodType: string | null;
    cardBrand: string | null;
    cardLast4: string | null;
    cardWallet: string | null;
  } | null;
  receiptId?: string | null;
  /** The audit row's actor (null = the system: a Stripe confirmation). */
  auditActorId: string | null;
  auditReason: string;
}

export interface RecordedPayment {
  payment: Payment;
  invoice: Invoice;
  /** The instalment this payment completed, if it did. */
  settledInstalmentId: string | null;
  /** M3: money beyond what was owed when it arrived (recorded all the same), or null. */
  overpayment?: Overpayment | null;
}

/** M3 audit action: money recorded on something already paid, cancelled or covered. */
export const OVERPAYMENT_ACTION = 'payment.overpayment_detected';
/** M3: the staff notice's event type (chat.notification.event_type). */
export const OVERPAYMENT_EVENT = 'payment_overpaid';

/**
 * Why the money was more than owed:
 *  request_paid       the request was already paid (two payments, e.g. a bank
 *                     transfer approved and then a late card webhook);
 *  request_cancelled  the request was cancelled (replaced, or its instalment paid);
 *  instalment_closed  its instalment was already paid another way, or voided;
 *  more_than_owed     open, but this payment is larger than what was still owed.
 */
export type OverpaymentWhy = 'request_paid' | 'request_cancelled' | 'instalment_closed' | 'more_than_owed';

export interface Overpayment {
  why: OverpaymentWhy;
  requestId: string | null;
  instalmentId: string | null;
  /** What was still owed when this payment arrived (0 when nothing was). */
  owedMinor: number;
  /** amountMinor - owedMinor: what to refund or credit. */
  overpaidMinor: number;
}

/** What an invoice prints, frozen at issue (chat.invoice.snapshot). */
export interface InvoiceSnapshot {
  v: 1;
  billedTo: string;
  family: string | null;
  child: string | null;
  label: string;
  purpose: RequestPurpose | null;
  planMonths: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  method: PaymentMethod;
  amountMinor: number;
  currency: string;
  paidOn: string;
  reference: string | null;
  issuer: { name: string; address: string | null; taxId: string | null } | null;
}

/**
 * PD-27: THE ONE PLACE money is written.
 *
 * Every way a payment arrives -- a verified Stripe webhook, a verifier
 * approving a bank-transfer receipt, staff recording cash or a transfer, PD-17's
 * "mark this instalment paid" -- ends in `record`, inside the caller's
 * transaction: the payment, its invoice (numbered by the database), the request
 * marked paid when its payments cover it, the instalment marked paid when its
 * payments cover it, and the audit row. One implementation, so the four routes
 * cannot disagree about what "paid" means.
 *
 * Paid is the sum of the STANDING payments (not voided) against the request or
 * the instalment, so a family may pay in parts and by different methods. A
 * refund does not reopen anything: money given back is shown on the payment and
 * the invoice, and a family that must pay again is asked again.
 */
@Injectable()
export class PaymentLedger {
  private readonly log = new Logger(PaymentLedger.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    // Optional only for suites that build the billing services by hand; the
    // module always provides both, and without them no push is sent.
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly reminders?: ReminderService,
    // Lock-screen names (lock-screen-push.ts). Without it every push is the generic one.
    @Optional() private readonly pipeline?: NotificationPipeline,
  ) {}

  /** 32 random bytes, base64url: 43 characters, the whole capability of a link. */
  static newToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** PAYMENT_LINK_BASE_URL (absolute, ending in the API prefix), else this request's origin + /api/v1. */
  static linkFor(token: string): string {
    const configured = process.env.PAYMENT_LINK_BASE_URL?.trim();
    const base = configured ? configured.replace(/\/+$/, '') : `${currentRequestOrigin() ?? ''}/api/v1`;
    return `${base}/pay/${token}`;
  }

  async record(tx: Tx, input: RecordPaymentInput): Promise<RecordedPayment> {
    // Serialize payments against one request / one instalment, so two arriving
    // together both see each other when deciding "covered".
    let request: PaymentRequest | null = null;
    if (input.requestId) {
      await tx.$queryRaw`SELECT id FROM chat.payment_request WHERE id = ${input.requestId}::uuid FOR UPDATE`;
      request = await tx.paymentRequest.findUniqueOrThrow({ where: { id: input.requestId } });
    }
    let instalment: FamilyInstalment | null = null;
    // undefined: the request's instalment; null: apply to no instalment (it was
    // paid otherwise or voided before this money arrived).
    const instalmentId = input.instalmentId === undefined ? request?.instalmentId ?? null : input.instalmentId;
    if (instalmentId) {
      await tx.$queryRaw`SELECT id FROM chat.family_instalment WHERE id = ${instalmentId}::uuid FOR UPDATE`;
      instalment = await tx.familyInstalment.findUniqueOrThrow({ where: { id: instalmentId } });
    }
    // M3: what this money was owed against, read BEFORE it is recorded (under
    // the locks above). It never changes what is recorded: money taken is
    // recorded; money beyond what was owed is flagged for a refund or a credit.
    const owed = await this.owedBefore(tx, input, request, instalment);

    const payment = await tx.payment.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        organizationId: input.organizationId,
        familyId: input.familyId,
        trialLessonId: input.familyId ? null : input.trialLessonId,
        learnerId: input.learnerId,
        childName: input.childName,
        requestId: input.requestId,
        instalmentId,
        method: input.method,
        amountMinor: BigInt(input.amountMinor),
        currency: input.currency,
        paidOn: dateOnly(input.paidOn),
        recordedBy: input.recordedBy,
        reference: input.reference,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
        stripePaymentIntentId: input.stripePaymentIntentId ?? null,
        ...(input.method === 'card' && input.stripe
          ? {
              stripeCustomerId: input.stripe.customerId,
              stripeChargeId: input.stripe.chargeId,
              paymentMethodType: input.stripe.methodType,
              cardBrand: input.stripe.cardBrand,
              cardLast4: input.stripe.cardLast4,
              cardWallet: input.stripe.cardWallet,
            }
          : {}),
        receiptId: input.receiptId ?? null,
      },
    });

    const snapshot = await this.snapshot(tx, payment, request, instalment);
    const invoice = await tx.invoice.create({
      data: {
        organizationId: input.organizationId,
        paymentId: payment.id,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    if (request && !request.paidAt && !request.cancelledAt) {
      const paid = await this.standingSum(tx, { requestId: request.id });
      if (paid >= Number(request.amountMinor)) {
        await tx.paymentRequest.update({ where: { id: request.id }, data: { paidAt: new Date() } });
      }
    }

    let settledInstalmentId: string | null = null;
    if (instalment && !instalment.paidOn && !instalment.voidedAt) {
      const paid = await this.standingSum(tx, { instalmentId: instalment.id });
      if (paid >= Number(instalment.amountMinor)) {
        await tx.familyInstalment.update({
          where: { id: instalment.id },
          data: {
            paidOn: dateOnly(input.paidOn),
            paidMethod: input.method,
            paidReference: input.reference,
            paidRecordedBy: input.recordedBy,
            paidRecordedAt: new Date(),
          },
        });
        settledInstalmentId = instalment.id;
        // PD-17's audit event, kept: the instalment is paid (by this payment and any before it).
        await this.audit.audit(tx, {
          actorId: input.auditActorId ?? undefined,
          action: 'instalment.paid',
          entity: 'family',
          entityId: instalment.familyId,
          after: { instalmentId: instalment.id, paidOn: input.paidOn, method: input.method, amountMinor: Number(instalment.amountMinor), currency: instalment.currency },
          reason: 'payment recorded',
        });
        // Another live link for this instalment would now ask for money that is not owed.
        await tx.paymentRequest.updateMany({
          where: { instalmentId: instalment.id, paidAt: null, cancelledAt: null, id: { not: request?.id ?? undefined } },
          data: { cancelledAt: new Date(), cancelReason: 'the instalment was paid' },
        });
      }
    }

    await this.audit.audit(tx, {
      actorId: input.auditActorId ?? undefined,
      action: 'payment.recorded',
      entity: input.familyId ? 'family' : 'lesson',
      entityId: input.familyId ?? (input.trialLessonId as string),
      after: {
        paymentId: payment.id,
        invoice: invoice.number,
        method: input.method,
        amountMinor: input.amountMinor,
        currency: input.currency,
        paidOn: input.paidOn,
        requestId: input.requestId,
        instalmentId,
        receiptId: input.receiptId ?? null,
      },
      reason: input.auditReason,
    });

    let overpayment: Overpayment | null = null;
    if (owed && input.amountMinor > owed.owedMinor) {
      overpayment = { ...owed, overpaidMinor: input.amountMinor - owed.owedMinor };
      await this.audit.audit(tx, {
        actorId: input.auditActorId ?? undefined,
        action: OVERPAYMENT_ACTION,
        entity: 'payment',
        entityId: payment.id,
        after: {
          paymentId: payment.id,
          invoice: invoice.number,
          method: input.method,
          amountMinor: input.amountMinor,
          owedMinor: overpayment.owedMinor,
          overpaidMinor: overpayment.overpaidMinor,
          currency: input.currency,
          why: overpayment.why,
          requestId: overpayment.requestId,
          instalmentId: overpayment.instalmentId,
        },
        reason: 'money recorded beyond what was owed (already paid, cancelled or covered): refund or credit it',
      });
      this.log.warn(`payment ${payment.id} recorded beyond what was owed (${overpayment.why}); flagged for a refund or a credit`);
    }

    return { payment, invoice, settledInstalmentId, overpayment };
  }

  /**
   * M3: what the request or instalment this money is for still owed before it
   * arrived; null when it is for neither (money recorded against the family
   * alone, which is never "too much"). Read inside `record`, after its locks.
   */
  private async owedBefore(
    tx: Tx,
    input: RecordPaymentInput,
    request: PaymentRequest | null,
    instalment: FamilyInstalment | null,
  ): Promise<Omit<Overpayment, 'overpaidMinor'> | null> {
    // A receipt approved after its instalment was paid otherwise is recorded
    // against no request (PaymentsService.approveReceipt); the receipt still
    // names the request the parent paid.
    let forRequest = request;
    if (!forRequest && input.receiptId) {
      const receipt = await tx.paymentReceipt.findUnique({ where: { id: input.receiptId }, select: { requestId: true } });
      if (receipt?.requestId) forRequest = await tx.paymentRequest.findUnique({ where: { id: receipt.requestId } });
    }
    const requestId = forRequest?.id ?? null;
    if (instalment) {
      if (instalment.paidOn || instalment.voidedAt) return { why: 'instalment_closed', requestId, instalmentId: instalment.id, owedMinor: 0 };
      const paid = await this.standingSum(tx, { instalmentId: instalment.id });
      return { why: 'more_than_owed', requestId, instalmentId: instalment.id, owedMinor: Math.max(0, Number(instalment.amountMinor) - paid) };
    }
    if (!forRequest) return null;
    if (forRequest.instalmentId) {
      // The request's instalment was not applied: the caller found it paid another way, or voided.
      const inst = await tx.familyInstalment.findUnique({ where: { id: forRequest.instalmentId }, select: { paidOn: true, voidedAt: true } });
      if (!inst || inst.paidOn || inst.voidedAt) return { why: 'instalment_closed', requestId, instalmentId: forRequest.instalmentId, owedMinor: 0 };
    }
    const instalmentId = forRequest.instalmentId ?? null;
    if (forRequest.paidAt) return { why: 'request_paid', requestId, instalmentId, owedMinor: 0 };
    if (forRequest.cancelledAt) return { why: 'request_cancelled', requestId, instalmentId, owedMinor: 0 };
    const paid = await this.standingSum(tx, { requestId: forRequest.id });
    return { why: 'more_than_owed', requestId, instalmentId, owedMinor: Math.max(0, Number(forRequest.amountMinor) - paid) };
  }

  /**
   * Void a payment recorded by mistake (never a card payment: that is refunded).
   * Its invoice is voided with it. Refused once the payment completed its
   * instalment: PD-17's rule -- that correction is voiding the instalment.
   */
  async voidPayment(tx: Tx, payment: Payment, voidedBy: string, reason: string, opts: { cascadeFromInstalment?: boolean } = {}) {
    await tx.payment.update({
      where: { id: payment.id },
      data: { voidedAt: new Date(), voidedBy, voidReason: reason },
    });
    await tx.invoice.updateMany({ where: { paymentId: payment.id, voidedAt: null }, data: { voidedAt: new Date() } });
    // The request it paid is owed again if what stands no longer covers it.
    if (payment.requestId) {
      const request = await tx.paymentRequest.findUniqueOrThrow({ where: { id: payment.requestId } });
      if (request.paidAt && (await this.standingSum(tx, { requestId: request.id })) < Number(request.amountMinor)) {
        await tx.paymentRequest.update({ where: { id: request.id }, data: { paidAt: null } });
      }
    }
    await this.audit.audit(tx, {
      actorId: voidedBy,
      action: 'payment.voided',
      entity: payment.familyId ? 'family' : 'lesson',
      entityId: payment.familyId ?? (payment.trialLessonId as string),
      before: { paymentId: payment.id, method: payment.method, amountMinor: Number(payment.amountMinor), currency: payment.currency },
      reason: opts.cascadeFromInstalment ? `instalment voided: ${reason}` : reason,
    });
  }

  /**
   * PD-16 Assign: everything a trial's family paid (or was asked to pay) before
   * the family existed now belongs to it -- and to the child, when the trial had
   * one. In Assign's own transaction, so an enrolment never exists without its
   * payments.
   */
  async attachTrial(tx: Tx, trialLessonId: string, familyId: string, learnerIds: string[]): Promise<number> {
    const learnerId = learnerIds.length === 1 ? learnerIds[0] : null;
    const requests = await tx.paymentRequest.updateMany({
      where: { trialLessonId, familyId: null },
      data: { familyId, ...(learnerId ? { learnerId } : {}) },
    });
    const payments = await tx.payment.updateMany({
      where: { trialLessonId, familyId: null },
      data: { familyId, ...(learnerId ? { learnerId } : {}) },
    });
    await tx.invoice.updateMany({ where: { trialLessonId, familyId: null }, data: { familyId } });
    if (requests.count + payments.count > 0) {
      await this.audit.audit(tx, {
        action: 'payment.attached_at_assign',
        entity: 'family',
        entityId: familyId,
        after: { trialLessonId, requests: requests.count, payments: payments.count, learnerId },
        reason: 'trial assigned (PD-16)',
      });
    }
    return requests.count + payments.count;
  }

  /**
   * The live request (link) for an open instalment: the one it has, or a fresh
   * one for what it still owes. An expired one is cancelled first (the database
   * allows one live request per instalment). `createdBy` null = the system, for
   * a parent paying in the app.
   */
  async ensureInstalmentRequest(tx: Tx, instalment: FamilyInstalment, createdBy: string | null, expiresInDays = 14): Promise<PaymentRequest> {
    const live = await tx.paymentRequest.findFirst({
      where: { instalmentId: instalment.id, paidAt: null, cancelledAt: null },
    });
    if (live && live.expiresAt > new Date()) return live;
    if (live) {
      await tx.paymentRequest.update({
        where: { id: live.id },
        data: { cancelledAt: new Date(), cancelReason: 'expired; replaced by a new link' },
      });
    }
    const remaining = Number(instalment.amountMinor) - (await this.standingSum(tx, { instalmentId: instalment.id }));
    const learner = instalment.learnerId
      ? await tx.learner.findUnique({ where: { id: instalment.learnerId }, select: { name: true } })
      : null;
    const request = await tx.paymentRequest.create({
      data: {
        organizationId: instalment.organizationId,
        token: PaymentLedger.newToken(),
        familyId: instalment.familyId,
        learnerId: instalment.learnerId,
        childName: learner?.name ?? null,
        instalmentId: instalment.id,
        purpose: 'instalment',
        label: instalment.label,
        amountMinor: BigInt(Math.max(1, remaining)),
        currency: instalment.currency,
        expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
        createdBy,
      },
    });
    await this.audit.audit(tx, {
      actorId: createdBy ?? undefined,
      action: 'payment_request.created',
      entity: 'family',
      entityId: instalment.familyId,
      after: { requestId: request.id, instalmentId: instalment.id, amountMinor: Number(request.amountMinor), currency: request.currency },
      reason: createdBy ? 'payment link for an instalment' : 'opened by a parent paying in the app',
    });
    return request;
  }

  /** Sum of the standing (not voided) payments against a request or an instalment. */
  async standingSum(tx: Tx | PrismaService, where: { requestId?: string; instalmentId?: string }): Promise<number> {
    const agg = await tx.payment.aggregate({ where: { ...where, voidedAt: null }, _sum: { amountMinor: true } });
    return Number(agg._sum.amountMinor ?? 0n);
  }

  // ------------------------------------------------------------------
  // After the transaction: tell the family
  // ------------------------------------------------------------------

  /** "We received your payment" to every active parent of the family; and stop the instalment's reminders. */
  async afterRecorded(recorded: RecordedPayment): Promise<void> {
    const { payment, invoice, settledInstalmentId } = recorded;
    if (recorded.overpayment) await this.notifyOverpayment(payment, invoice, recorded.overpayment);
    try {
      if (settledInstalmentId) await this.reminders?.cancelForSubject(settledInstalmentId);
      if (!payment.familyId || !this.notifications) return;
      const recipients = await this.familyParents(payment.familyId);
      for (const r of recipients) {
        await this.notifications.schedule({
          dedupeKey: `payment_received:${payment.id}:${r.id}`,
          // The amount and the invoice number stay in the Center entry
          // (inbox.payment_received); the lock screen shows them only to
          // someone who turned names on.
          templateKey: await lockScreenTemplate(this.pipeline, r.id, 'payment_received'),
          eventType: 'payment_received',
          recipientId: r.id,
          locale: r.locale,
          priority: 'normal',
          familyId: payment.familyId,
          variables: {
            amount: formatMajor(Number(payment.amountMinor), payment.currency),
            currency: payment.currency,
            invoice_number: invoice.number,
          },
          scheduledAt: new Date(),
        });
      }
    } catch (e) {
      // The payment is recorded; a push is a courtesy and must not undo it.
      this.log.error(`payment notification failed: ${(e as Error).name}`);
    }
  }

  /**
   * M3: tell the staff who refund and reconcile (canVerify: the super admin and
   * the Operations Manager of the payment's academy) that money arrived beyond
   * what was owed. Through NotificationService.schedule, as other staff notices
   * are (organization checked, quiet hours kept), once per payment and person
   * (dedupe key). The push is the generic one: an amount and an invoice number
   * stay behind sign-in. Best effort: the audit row is the record.
   */
  private async notifyOverpayment(payment: Payment, invoice: Invoice, over: Overpayment): Promise<void> {
    if (!this.notifications) return;
    try {
      const recipients = await this.prisma.$queryRaw<Array<{ id: string; locale: string | null }>>`
        SELECT s.id::text AS id,
               (SELECT dt.locale FROM chat.device_token dt WHERE dt.actor_id = s.id AND dt.is_active
                 ORDER BY dt.last_seen_at DESC LIMIT 1) AS locale
          FROM chat.staff s
         WHERE s.organization_id = ${payment.organizationId}::uuid AND s.is_active AND s.left_at IS NULL
           AND (s.role = 'super_admin' OR (s.role = 'manager' AND chat.operations_department_role(s.id) = 'manager'))`;
      for (const r of recipients) {
        await this.notifications.schedule({
          dedupeKey: `${OVERPAYMENT_EVENT}:${payment.id}:${r.id}`,
          templateKey: GENERIC_PUSH_TEMPLATE,
          eventType: OVERPAYMENT_EVENT,
          recipientId: r.id,
          locale: r.locale === 'en' ? 'en' : 'ar',
          priority: 'normal',
          familyId: payment.familyId,
          variables: {
            payment_id: payment.id,
            invoice_number: invoice.number,
            amount: formatMajor(over.overpaidMinor, payment.currency),
            currency: payment.currency,
            why: over.why,
          },
          scheduledAt: new Date(),
        });
      }
    } catch (e) {
      // The payment and its flag are recorded; the notice must not undo them.
      this.log.error(`overpayment notice failed: ${(e as Error).name}`);
    }
  }

  async familyParents(familyId: string): Promise<{ id: string; locale: 'ar' | 'en' }[]> {
    const family = await this.prisma.family.findUnique({ where: { id: familyId }, select: { language: true } });
    const locale = family?.language === 'en' ? 'en' : 'ar';
    const contacts = await this.prisma.contact.findMany({ where: { familyId, isActive: true }, select: { id: true } });
    return contacts.map((c) => ({ id: c.id, locale }));
  }

  private async snapshot(tx: Tx, payment: Payment, request: PaymentRequest | null, instalment: FamilyInstalment | null): Promise<InvoiceSnapshot> {
    let family: { displayName: string; primaryContactId: string | null } | null = null;
    let parentName: string | null = null;
    if (payment.familyId) {
      family = await tx.family.findUnique({ where: { id: payment.familyId }, select: { displayName: true, primaryContactId: true } });
      if (family?.primaryContactId) {
        parentName = (await tx.contact.findUnique({ where: { id: family.primaryContactId }, select: { name: true } }))?.name ?? null;
      }
    }
    let child = payment.childName ?? request?.childName ?? null;
    const learnerId = payment.learnerId ?? instalment?.learnerId ?? null;
    if (!child && learnerId) child = (await tx.learner.findUnique({ where: { id: learnerId }, select: { name: true } }))?.name ?? null;
    const issuerRow = await tx.config.findUnique({ where: { key: INVOICE_ISSUER_KEY } });
    return {
      v: 1,
      billedTo: request?.payerName ?? parentName ?? family?.displayName ?? '',
      family: family?.displayName ?? null,
      child,
      label: request?.label ?? instalment?.label ?? 'Payment',
      purpose: (request?.purpose as RequestPurpose | undefined) ?? (instalment ? 'instalment' : null),
      planMonths: request?.planMonths ?? null,
      periodStart: request?.periodStart ? day(request.periodStart) : null,
      periodEnd: request?.periodEnd ? day(request.periodEnd) : null,
      method: payment.method as PaymentMethod,
      amountMinor: Number(payment.amountMinor),
      currency: payment.currency,
      paidOn: day(payment.paidOn),
      reference: payment.reference,
      issuer: parseIssuer(issuerRow?.value),
    };
  }
}

export function parseIssuer(value: unknown): InvoiceSnapshot['issuer'] {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || !v.name.trim()) return null;
  return {
    name: v.name,
    address: typeof v.address === 'string' && v.address.trim() ? v.address : null,
    taxId: typeof v.taxId === 'string' && v.taxId.trim() ? v.taxId : null,
  };
}
