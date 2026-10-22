import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { FamilyInstalment, Invoice, Payment, PaymentRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { currentRequestOrigin } from '../platform/request-origin';
import { NotificationService } from '../communication/notifications/notification.service';
import { ReminderService } from '../communication/notifications/reminder.service';
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
    private readonly notifications: NotificationService,
    private readonly reminders: ReminderService,
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

    const payment = await tx.payment.create({
      data: {
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

    return { payment, invoice, settledInstalmentId };
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
    try {
      if (settledInstalmentId) await this.reminders.cancelForSubject(settledInstalmentId);
      if (!payment.familyId) return;
      const recipients = await this.familyParents(payment.familyId);
      for (const r of recipients) {
        await this.notifications.schedule({
          dedupeKey: `payment_received:${payment.id}:${r.id}`,
          templateKey: 'payment_received',
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
