import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type Payment, type PaymentReceipt, type PaymentRequest } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import type { BillingAccess } from '../platform/pd012-policy';
import { MediaUrlSigner } from '../platform/media-url';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { NotificationService } from '../communication/notifications/notification.service';
import { SUBSCRIPTION_PLAN_MONTHS } from '../communication/contracts/vocab';
import { todayIn } from '../leave/leave.service';
import { BillingService, mapPaymentRefusal, parseBankAccount, type BankAccount } from './billing.service';
import { BANK_ACCOUNT_KEY, INVOICE_ISSUER_KEY, PaymentLedger, REQUEST_PURPOSES, parseIssuer, type RequestPurpose } from './payment-ledger.service';
import { PaymentsReadService } from './payments-read.service';
import { familyInScopeSql } from './billing-access';
import { dashboardTile, type DashboardTile } from '../dashboard/dashboard-tile';
import { PAYMENT_DUE_EVENT } from './payment-reminders.service';
import { STRIPE_GATEWAY, type StripeGateway } from './stripe.gateway';
import { formatMajor, minorDigits } from './money';
import type { TrialFormPayer } from '../new-students/new-students.service';
import {
  dateOnly,
  invalid,
  optionalDate,
  optionalText,
  optionalUuid,
  requireAmount,
  requireCurrency,
  requireDate,
  requireText,
} from './validate';

const RECEIPT_STATUSES = ['pending', 'approved', 'rejected'] as const;
/** The receipts list's page size; the Dashboard tile caps at it too (PD-44). */
const RECEIPTS_LIMIT = 200;
const DEFAULT_EXPIRY_DAYS = 14;
const INVOICE_LINK_TTL_SECONDS = 5 * 60;

/** What a trial's request needs from Sales' form -- never its phone or e-mail. */
export interface TrialPayer {
  trialLessonId: string;
  organizationId: string;
  payerName: string;
  /** The child, when the form has exactly one. */
  childName: string | null;
  currency: string;
  /** The form's package prices, in minor units. */
  suggestedAmountMinor: number | null;
  /** Already assigned: the request belongs on the family now. */
  enrolledFamilyId: string | null;
}

/**
 * PD-27, the staff side: payment requests (links), cash and bank transfers
 * recorded by hand, voids and refunds, the receipts queue, the settings, and
 * the signed invoice link. Who may do what is billingAccessOf: PD-17 / PD-20's
 * recorders (Operations in reach, Sales, the Operations Manager, the super
 * admin) record, void and decide receipts, as they already recorded payments;
 * `canVerify` -- the super admin and the Operations Manager -- refunds and sets
 * the bank account the parents pay into.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);
  private readonly signer = new MediaUrlSigner();

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly billing: BillingService,
    private readonly ledger: PaymentLedger,
    private readonly reads: PaymentsReadService,
    private readonly notifications: NotificationService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Payment requests
  // ------------------------------------------------------------------

  /**
   * { purpose, label, amountMinor?, currency?, learnerId?, instalmentId?,
   *   planMonths?, periodStart?, periodEnd?, expiresInDays? }
   * With instalmentId: the instalment's live link (made for what it still owes
   * if it has none) -- the other fields are the instalment's own.
   */
  async createRequest(actorId: string, familyId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireRecorder(actorId);
    const family = await this.billing.requireFamily(actor, access, familyId);
    const expiresInDays = expiryDays(body.expiresInDays);
    const instalmentId = optionalUuid('instalmentId', body.instalmentId);

    let request: PaymentRequest;
    if (instalmentId) {
      const inst = await this.prisma.familyInstalment.findFirst({ where: { id: instalmentId, familyId: family.id } });
      if (!inst) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'instalment not found');
      if (inst.paidOn || inst.voidedAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this instalment is already paid or voided', 409);
      request = await this.prisma.$transaction(async (tx) => {
        await this.conversations.assertActorLive(tx, actor);
        return this.ledger.ensureInstalmentRequest(tx, inst, actor.actorId, expiresInDays);
      });
    } else {
      const terms = this.requestTerms(body);
      const learnerId = optionalUuid('learnerId', body.learnerId);
      let childName: string | null = null;
      if (learnerId) {
        const child = await this.prisma.learner.findFirst({ where: { id: learnerId, familyId: family.id }, select: { name: true } });
        if (!child) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'that child is not in this family');
        childName = child.name;
      }
      const familyCurrency = (await this.prisma.familyBilling.findUnique({ where: { familyId: family.id } }))?.currency ?? null;
      const currency = body.currency === undefined || body.currency === null ? familyCurrency : requireCurrency(body.currency);
      if (!currency) throw invalid('currency: set the family\'s currency, or send one');
      const amountMinor = requireAmount('amountMinor', body.amountMinor);
      request = await this.prisma.$transaction(async (tx) => {
        await this.conversations.assertActorLive(tx, actor);
        const created = await tx.paymentRequest.create({
          data: {
            organizationId: actor.organizationId as string,
            token: PaymentLedger.newToken(),
            familyId: family.id,
            learnerId,
            childName,
            ...terms,
            amountMinor: BigInt(amountMinor),
            currency,
            expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
            createdBy: actor.actorId,
          },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'payment_request.created',
          entity: 'family',
          entityId: family.id,
          after: { requestId: created.id, purpose: terms.purpose, amountMinor, currency, learnerId, planMonths: terms.planMonths, lessonsIncluded: terms.lessonsIncluded },
          reason: 'payment link created',
        });
        return created;
      });
    }
    return {
      request: await this.reads.presentOneRequest(request, true),
      billing: await this.billing.presentFamily(actor, access, family.id),
    };
  }

  /**
   * The trial as a payer, from the confined form (src/new-students reads it and
   * hands over only the name, child, currency and package prices).
   */
  async trialPayer(
    actorId: string,
    trialId: string,
    source: (organizationId: string, lessonId: string) => Promise<TrialFormPayer | null>,
  ): Promise<TrialPayer> {
    const actor = await this.conversations.requireActor(actorId);
    if (!isUuid(trialId) || !actor.organizationId) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'trial not found');
    const form = await source(actor.organizationId, trialId.toLowerCase());
    if (!form) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'no subscription form for this trial');
    return {
      trialLessonId: trialId.toLowerCase(),
      organizationId: actor.organizationId,
      payerName: form.parentName,
      childName: form.childName,
      currency: form.currency,
      suggestedAmountMinor: form.packageTotal === null ? null : Math.round(form.packageTotal * 10 ** minorDigits(form.currency)),
      enrolledFamilyId: form.enrolledFamilyId,
    };
  }

  /** A trial's request before Assign (PD-16): Sales, the Operations Manager or the super admin. */
  async createTrialRequest(actorId: string, payer: TrialPayer, body: Record<string, unknown>) {
    const { actor } = await this.requireTrialRecorder(actorId, payer);
    if (payer.enrolledFamilyId) {
      throw new CommError(CommErrorCode.BILLING_STATE, 'this student is enrolled; request the payment from the family\'s Parent Profile', 409);
    }
    const terms = this.requestTerms({ purpose: 'subscription', ...body });
    const amountMinor = requireAmount('amountMinor', body.amountMinor);
    const currency = body.currency === undefined || body.currency === null ? payer.currency : requireCurrency(body.currency);
    const expiresInDays = expiryDays(body.expiresInDays);
    const request = await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const created = await tx.paymentRequest.create({
        data: {
          organizationId: payer.organizationId,
          token: PaymentLedger.newToken(),
          trialLessonId: payer.trialLessonId,
          childName: payer.childName,
          payerName: payer.payerName,
          ...terms,
          amountMinor: BigInt(amountMinor),
          currency,
          expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
          createdBy: actor.actorId,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'payment_request.created',
        entity: 'lesson',
        entityId: payer.trialLessonId,
        after: { requestId: created.id, purpose: terms.purpose, amountMinor, currency, planMonths: terms.planMonths, lessonsIncluded: terms.lessonsIncluded },
        reason: 'payment link created for a trial before Assign',
      });
      return created;
    });
    return { request: await this.reads.presentOneRequest(request, true) };
  }

  async trialRequests(actorId: string, payer: TrialPayer) {
    const { actor } = await this.requireTrialRecorder(actorId, payer);
    const view = await this.reads.forTrial(payer.trialLessonId, payer.organizationId, actor.actorId);
    return { ...view, suggestedAmountMinor: payer.suggestedAmountMinor, currency: payer.currency, enrolledFamilyId: payer.enrolledFamilyId };
  }

  /** { reason } */
  async cancelRequest(actorId: string, requestId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireRecorder(actorId);
    const request = await this.requireRequest(actor, access, requestId);
    const reason = requireText('reason', body.reason, 500);
    if (request.paidAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this request is already paid', 409);
    if (request.cancelledAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this request is already cancelled', 409);
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const changed = await tx.paymentRequest.updateMany({
        where: { id: request.id, paidAt: null, cancelledAt: null },
        data: { cancelledAt: new Date(), cancelledBy: actor.actorId, cancelReason: reason },
      });
      if (changed.count !== 1) throw new CommError(CommErrorCode.BILLING_STATE, 'this request was just paid or cancelled', 409);
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'payment_request.cancelled',
        entity: request.familyId ? 'family' : 'lesson',
        entityId: request.familyId ?? (request.trialLessonId as string),
        before: { requestId: request.id, amountMinor: Number(request.amountMinor), currency: request.currency },
        reason,
      });
    });
    // Close any Stripe page still open for it, so the link cannot be paid after all.
    await this.expireOpenCheckouts(request.id);
    if (!request.familyId) {
      return { request: await this.reads.presentOneRequest(await this.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } }), true) };
    }
    return this.billing.presentFamily(actor, access, request.familyId);
  }

  // ------------------------------------------------------------------
  // Money recorded by hand: cash, a bank transfer
  // ------------------------------------------------------------------

  /** { method: cash | bank_transfer, amountMinor, paidOn, requestId? | instalmentId?, learnerId?, reference?, currency? } */
  async recordManual(actorId: string, familyId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireRecorder(actorId);
    const family = await this.billing.requireFamily(actor, access, familyId);
    const method = body.method;
    if (method !== 'cash' && method !== 'bank_transfer') throw invalid('method: cash | bank_transfer');
    const amountMinor = requireAmount('amountMinor', body.amountMinor);
    const paidOn = requireDate('paidOn', body.paidOn);
    if (paidOn > todayIn(await this.billing.timeZone())) throw invalid('paidOn: a payment is recorded once it arrived, not ahead of time');
    const reference = optionalText('reference', body.reference, 120);
    const requestId = optionalUuid('requestId', body.requestId);
    const instalmentId = optionalUuid('instalmentId', body.instalmentId);
    if (requestId && instalmentId) throw invalid('requestId or instalmentId, not both');

    let learnerId = optionalUuid('learnerId', body.learnerId);
    let currency: string | null = body.currency === undefined || body.currency === null ? null : requireCurrency(body.currency);
    let owed: number | null = null;
    let request: PaymentRequest | null = null;
    if (requestId) {
      request = await this.prisma.paymentRequest.findFirst({ where: { id: requestId, familyId: family.id } });
      if (!request) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'payment request not found');
      if (request.cancelledAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this request is cancelled', 409);
      owed = Number(request.amountMinor) - (await this.ledger.standingSum(this.prisma, { requestId: request.id }));
      learnerId = request.learnerId ?? learnerId;
      currency = request.currency;
    }
    if (instalmentId) {
      const inst = await this.prisma.familyInstalment.findFirst({ where: { id: instalmentId, familyId: family.id } });
      if (!inst) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'instalment not found');
      if (inst.paidOn || inst.voidedAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this instalment is already paid or voided', 409);
      owed = Number(inst.amountMinor) - (await this.ledger.standingSum(this.prisma, { instalmentId: inst.id }));
      learnerId = inst.learnerId ?? learnerId;
      currency = inst.currency;
    }
    if (owed !== null && amountMinor > owed) throw invalid(`amountMinor: at most what is still owed (${owed})`);
    if (!currency) currency = (await this.prisma.familyBilling.findUnique({ where: { familyId: family.id } }))?.currency ?? null;
    if (!currency) throw invalid('currency: set the family\'s currency, or send one');
    let childName: string | null = null;
    if (learnerId) {
      const child = await this.prisma.learner.findFirst({ where: { id: learnerId, familyId: family.id }, select: { name: true } });
      if (!child) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'that child is not in this family');
      childName = child.name;
    }

    const recorded = await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      return this.ledger.record(tx, {
        organizationId: actor.organizationId as string,
        familyId: family.id,
        trialLessonId: null,
        learnerId,
        childName,
        requestId: request?.id ?? null,
        instalmentId: instalmentId ?? request?.instalmentId ?? null,
        method,
        amountMinor,
        currency: currency as string,
        paidOn,
        recordedBy: actor.actorId,
        reference,
        auditActorId: actor.actorId,
        auditReason: method === 'cash' ? 'cash received' : 'bank transfer confirmed',
      });
    }).catch((e) => { throw mapPaymentRefusal(e); });
    await this.ledger.afterRecorded(recorded);
    return this.billing.presentFamily(actor, access, family.id);
  }

  // ------------------------------------------------------------------
  // Corrections: void, refund
  // ------------------------------------------------------------------

  /** { reason } -- a payment recorded by mistake. Never a card payment. */
  async voidPayment(actorId: string, paymentId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireRecorder(actorId);
    const payment = await this.requirePayment(actor, access, paymentId);
    const reason = requireText('reason', body.reason, 500);
    if (payment.voidedAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this payment is already voided', 409);
    if (payment.method === 'card') {
      throw new CommError(CommErrorCode.BILLING_STATE, 'a card payment is refunded, not voided', 409);
    }
    if (payment.instalmentId) {
      const inst = await this.prisma.familyInstalment.findUniqueOrThrow({ where: { id: payment.instalmentId } });
      if (inst.paidOn) {
        throw new CommError(CommErrorCode.BILLING_STATE, 'this payment completed its instalment; void the instalment instead', 409);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      await this.ledger.voidPayment(tx, payment, actor.actorId, reason);
    }).catch((e) => { throw mapPaymentRefusal(e); });
    return this.presentAfter(actor, access, payment);
  }

  /** { amountMinor, reason } -- a card payment is refunded through Stripe. */
  async refund(actorId: string, paymentId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.requireVerifier(actorId);
    const payment = await this.requirePayment(actor, access, paymentId);
    const amountMinor = requireAmount('amountMinor', body.amountMinor);
    const reason = requireText('reason', body.reason, 500);
    if (payment.voidedAt) throw new CommError(CommErrorCode.BILLING_STATE, 'a voided payment is not refunded', 409);
    const refunded = Number((await this.prisma.paymentRefund.aggregate({ where: { paymentId: payment.id }, _sum: { amountMinor: true } }))._sum.amountMinor ?? 0n);
    if (refunded + amountMinor > Number(payment.amountMinor)) {
      throw new CommError(CommErrorCode.BILLING_STATE, `at most ${Number(payment.amountMinor) - refunded} is left to refund`, 409);
    }

    let stripeRefundId: string | null = null;
    if (payment.method === 'card') {
      if (!this.stripe.checkoutAvailable) {
        throw new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, 'card payments are not configured on this deployment', 503);
      }
      if (!payment.stripePaymentIntentId) throw new CommError(CommErrorCode.BILLING_STATE, 'this card payment has no Stripe payment to refund', 409);
      try {
        const r = await this.stripe.refund(payment.stripePaymentIntentId, amountMinor, `refund:${payment.id}:${refunded}:${amountMinor}`);
        stripeRefundId = r.id;
      } catch (e) {
        this.log.warn(`stripe refund refused: ${(e as Error).name}`);
        throw new CommError(CommErrorCode.BILLING_STATE, 'Stripe did not accept the refund; check the payment in the Stripe Dashboard', 409);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      // The webhook may have recorded Stripe's refund already (unique id): then this is it.
      if (stripeRefundId && (await tx.paymentRefund.findUnique({ where: { stripeRefundId } }))) return;
      await tx.paymentRefund.create({
        data: {
          organizationId: payment.organizationId,
          paymentId: payment.id,
          amountMinor: BigInt(amountMinor),
          reason,
          stripeRefundId,
          recordedBy: actor.actorId,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'payment.refunded',
        entity: payment.familyId ? 'family' : 'lesson',
        entityId: payment.familyId ?? (payment.trialLessonId as string),
        after: { paymentId: payment.id, amountMinor, currency: payment.currency, stripeRefundId },
        reason,
      });
    }).catch((e) => { throw mapPaymentRefusal(e); });
    return this.presentAfter(actor, access, payment);
  }

  // ------------------------------------------------------------------
  // Bank-transfer receipts
  // ------------------------------------------------------------------

  async receipts(actorId: string, statusQuery?: string) {
    const { actor, access } = await this.billing.requireReader(actorId);
    const status = (statusQuery ?? 'pending') as (typeof RECEIPT_STATUSES)[number];
    if (!RECEIPT_STATUSES.includes(status)) throw invalid('status: pending | approved | rejected');
    const org = actor.organizationId as string;
    const familyFilter = access.scope === 'reach'
      ? (await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT f.id FROM chat.family f
           WHERE f.organization_id = ${org}::uuid
             AND chat.staff_reaches_family(${actor.actorId}::uuid, f.id) IS NOT NULL`).map((r) => r.id)
      : access.scope === 'owned'
        ? (await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT f.id FROM chat.family f
             WHERE f.organization_id = ${org}::uuid
               AND chat.staff_owns_family(${actor.actorId}::uuid, f.id)`).map((r) => r.id)
        : null;
    const where = { organizationId: org, ...(familyFilter ? { familyId: { in: familyFilter } } : {}) };
    const [rows, grouped] = await Promise.all([
      this.prisma.paymentReceipt.findMany({ where: { ...where, status }, orderBy: { uploadedAt: status === 'pending' ? 'asc' : 'desc' }, take: RECEIPTS_LIMIT }),
      this.prisma.paymentReceipt.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const g of grouped) counts[g.status as keyof typeof counts] = g._count._all;
    // PD-17 / PD-20: whoever records the family's payments decides its receipts.
    return { items: await this.reads.presentReceipts(rows, actor.actorId), counts, canDecide: access.canRecord };
  }

  /**
   * PD-44: the Dashboard's receipts tile -- `receipts`' own counts.pending, in
   * one statement over the same families (every receipt of the organization
   * for the `all` scope; those of the families in scope otherwise -- the
   * shared predicate, equivalent to `receipts`' two-step family filter), and
   * capped like that list at RECEIPTS_LIMIT. Staff who read no family's money
   * get no tile; non-staff are refused.
   */
  async dashboardCounts(actorId: string): Promise<DashboardTile[]> {
    const reader = await this.billing.readerOrNone(actorId);
    if (!reader) return [];
    const { actor, access } = reader;
    const all = access.scope === 'all';
    const [r] = await this.prisma.$queryRaw<Array<{ pending: number; oldest: Date | null }>>`
      SELECT count(*)::int AS pending, min(r.uploaded_at) AS oldest
        FROM chat.payment_receipt r
       WHERE r.organization_id = ${actor.organizationId as string}::uuid
         AND r.status = 'pending'
         AND (${all}::boolean OR (r.family_id IS NOT NULL AND ${familyInScopeSql(actor.actorId, access.scope, Prisma.sql`r.family_id`)}))`;
    const pending = r?.pending ?? 0;
    return [dashboardTile('receipts.pending', Math.min(pending, RECEIPTS_LIMIT), r?.oldest ?? null, pending > RECEIPTS_LIMIT)];
  }

  /** { amountMinor?, paidOn? } -- the verifier saw the money arrive. */
  async approveReceipt(actorId: string, receiptId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireRecorder(actorId);
    const receipt = await this.requireReceipt(actor, access, receiptId);
    if (receipt.status !== 'pending') throw new CommError(CommErrorCode.BILLING_STATE, 'this receipt is already decided', 409);
    const amountMinor = body.amountMinor === undefined || body.amountMinor === null ? Number(receipt.amountMinor) : requireAmount('amountMinor', body.amountMinor);
    const paidOn = optionalDate('paidOn', body.paidOn) ?? receipt.transferredOn.toISOString().slice(0, 10);
    if (paidOn > todayIn(await this.billing.timeZone())) throw invalid('paidOn: a payment is recorded once it arrived, not ahead of time');
    const request = await this.prisma.paymentRequest.findUniqueOrThrow({ where: { id: receipt.requestId } });
    let instalmentId = request.instalmentId;
    if (instalmentId) {
      const inst = await this.prisma.familyInstalment.findUniqueOrThrow({ where: { id: instalmentId } });
      // Paid meanwhile by other means: the money is still recorded, against the family.
      if (inst.voidedAt || inst.paidOn) instalmentId = null;
    }
    const recorded = await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const r = await this.ledger.record(tx, {
        organizationId: receipt.organizationId,
        familyId: receipt.familyId,
        trialLessonId: null,
        learnerId: request.learnerId,
        childName: request.childName,
        requestId: instalmentId === request.instalmentId ? request.id : null,
        instalmentId,
        method: 'bank_transfer',
        amountMinor,
        currency: receipt.currency,
        paidOn,
        recordedBy: actor.actorId,
        reference: receipt.note ? receipt.note.slice(0, 120) : null,
        receiptId: receipt.id,
        auditActorId: actor.actorId,
        auditReason: 'bank-transfer receipt approved',
      });
      const changed = await tx.paymentReceipt.updateMany({
        where: { id: receipt.id, status: 'pending' },
        data: { status: 'approved', reviewedBy: actor.actorId, reviewedAt: new Date(), paymentId: r.payment.id },
      });
      if (changed.count !== 1) throw new CommError(CommErrorCode.BILLING_STATE, 'this receipt was just decided', 409);
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'receipt.approved',
        entity: 'family',
        entityId: receipt.familyId,
        after: { receiptId: receipt.id, paymentId: r.payment.id, amountMinor, claimedMinor: Number(receipt.amountMinor), paidOn },
        reason: 'bank-transfer receipt approved',
      });
      return r;
    }).catch((e) => { throw mapPaymentRefusal(e); });
    await this.ledger.afterRecorded(recorded);
    return { receipt: await this.presentReceipt(receipt.id, actor.actorId) };
  }

  /** { reason } -- shown to the parent. */
  async rejectReceipt(actorId: string, receiptId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireRecorder(actorId);
    const receipt = await this.requireReceipt(actor, access, receiptId);
    const reason = requireText('reason', body.reason, 500);
    if (receipt.status !== 'pending') throw new CommError(CommErrorCode.BILLING_STATE, 'this receipt is already decided', 409);
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const changed = await tx.paymentReceipt.updateMany({
        where: { id: receipt.id, status: 'pending' },
        data: { status: 'rejected', reviewedBy: actor.actorId, reviewedAt: new Date(), rejectReason: reason },
      });
      if (changed.count !== 1) throw new CommError(CommErrorCode.BILLING_STATE, 'this receipt was just decided', 409);
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'receipt.rejected',
        entity: 'family',
        entityId: receipt.familyId,
        before: { receiptId: receipt.id, amountMinor: Number(receipt.amountMinor), currency: receipt.currency },
        reason,
      });
    });
    try {
      const recipients = await this.ledger.familyParents(receipt.familyId);
      for (const r of recipients) {
        await this.notifications.schedule({
          dedupeKey: `payment_receipt_rejected:${receipt.id}:${r.id}`,
          templateKey: 'payment_receipt_rejected',
          eventType: 'payment_receipt_rejected',
          recipientId: r.id,
          locale: r.locale,
          priority: 'normal',
          familyId: receipt.familyId,
          variables: { amount: formatMajor(Number(receipt.amountMinor), receipt.currency), currency: receipt.currency, reason },
          scheduledAt: new Date(),
        });
      }
    } catch (e) {
      this.log.error(`receipt rejection notification failed: ${(e as Error).name}`);
    }
    return { receipt: await this.presentReceipt(receipt.id, actor.actorId) };
  }

  // ------------------------------------------------------------------
  // Invoices
  // ------------------------------------------------------------------

  /** A signed PDF link for this staff member. */
  async invoiceLink(actorId: string, invoiceId: string) {
    const { actor, access } = await this.billing.requireReader(actorId);
    const invoice = await this.findInvoice(invoiceId, actor.organizationId as string);
    await this.requirePayerInScope(actor, access, invoice.familyId);
    return { url: this.signer.url('invoices', invoice.id, 'o', actor.actorId, INVOICE_LINK_TTL_SECONDS) };
  }

  // ------------------------------------------------------------------
  // Settings: bank details, invoice issuer, reminder policy
  // ------------------------------------------------------------------

  async settings(actorId: string) {
    const { access } = await this.billing.requireReader(actorId);
    return this.presentSettings(access.canAssign);
  }

  /** { bankAccount?, issuer?, reminders?: [{key, enabled}] } -- the super admin or the Operations Manager. */
  async setSettings(actorId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireReader(actorId);
    if (!access.canAssign) throw new CommError(CommErrorCode.BILLING_DENIED, 'payment settings are set by the super admin or the Operations Manager');
    const before = await this.presentSettings(true);
    const writes: Array<{ key: string; value: unknown }> = [];
    if ('bankAccount' in body) writes.push({ key: BANK_ACCOUNT_KEY, value: body.bankAccount === null ? null : validateBankAccount(body.bankAccount) });
    if ('issuer' in body) writes.push({ key: INVOICE_ISSUER_KEY, value: body.issuer === null ? null : validateIssuer(body.issuer) });
    let reminders: Array<{ key: string; enabled: boolean }> = [];
    if ('reminders' in body) {
      if (!Array.isArray(body.reminders)) throw invalid('reminders: [{ key, enabled }]');
      const known = new Set(before.reminders.map((r) => r.key));
      reminders = body.reminders.map((raw, i) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        if (typeof r.key !== 'string' || !known.has(r.key)) throw invalid(`reminders[${i}].key: one of ${[...known].join(', ')}`);
        if (typeof r.enabled !== 'boolean') throw invalid(`reminders[${i}].enabled: true or false`);
        return { key: r.key, enabled: r.enabled };
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      for (const w of writes) {
        if (w.value === null) await tx.config.deleteMany({ where: { key: w.key } });
        else await tx.config.upsert({ where: { key: w.key }, create: { key: w.key, value: w.value as object }, update: { value: w.value as object } });
      }
      for (const r of reminders) await tx.notificationRule.update({ where: { key: r.key }, data: { enabled: r.enabled } });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'billing.settings_set',
        entity: 'organization',
        entityId: actor.organizationId as string,
        before: { bankAccount: before.bankAccount, issuer: before.issuer, reminders: before.reminders },
        after: { ...Object.fromEntries(writes.map((w) => [w.key, w.value])), reminders },
        reason: 'payment settings changed',
      });
    });
    return this.presentSettings(true);
  }

  private async presentSettings(canEdit: boolean) {
    const [bank, issuer, rules] = await Promise.all([
      this.prisma.config.findUnique({ where: { key: BANK_ACCOUNT_KEY } }),
      this.prisma.config.findUnique({ where: { key: INVOICE_ISSUER_KEY } }),
      this.prisma.notificationRule.findMany({ where: { eventType: PAYMENT_DUE_EVENT }, orderBy: { offsetSeconds: 'asc' } }),
    ]);
    return {
      bankAccount: parseBankAccount(bank?.value),
      issuer: parseIssuer(issuer?.value),
      cardAvailable: this.stripe.checkoutAvailable,
      webhookConfigured: this.stripe.webhookAvailable,
      reminders: rules.map((r) => ({ key: r.key, offsetDays: Math.round(r.offsetSeconds / 86_400), enabled: r.enabled })),
      canEdit,
    };
  }

  // ------------------------------------------------------------------
  // Read rules for the signed media links
  // ------------------------------------------------------------------

  /** The family's parents, and staff who read that family's money. */
  async authorizeReceiptRead(receiptId: string, actorId: string): Promise<{ objectKey: string }> {
    if (!isUuid(receiptId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'not found');
    const receipt = await this.prisma.paymentReceipt.findUnique({ where: { id: receiptId } });
    if (!receipt) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'not found');
    await this.requireReaderOfPayer(actorId, receipt.organizationId, receipt.familyId);
    return { objectKey: receipt.objectKey };
  }

  /** The same readers, for an invoice. Returns what the PDF prints. */
  async authorizeInvoiceRead(invoiceId: string, actorId: string) {
    if (!isUuid(invoiceId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'not found');
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'not found');
    const viewer = await this.requireReaderOfPayer(actorId, invoice.organizationId, invoice.familyId);
    // A parent never opens a voided invoice.
    if (viewer === 'parent' && invoice.voidedAt) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'not found');
    const refunded = Number((await this.prisma.paymentRefund.aggregate({ where: { paymentId: invoice.paymentId }, _sum: { amountMinor: true } }))._sum.amountMinor ?? 0n);
    return { invoice, refundedMinor: refunded };
  }

  private async requireReaderOfPayer(actorId: string, organizationId: string, familyId: string | null): Promise<'parent' | 'staff'> {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.organizationId !== organizationId) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'not found');
    if (actor.kind === 'contact') {
      const contact = await this.prisma.contact.findUnique({ where: { id: actor.actorId }, select: { familyId: true, isActive: true } });
      if (!familyId || !contact?.isActive || contact.familyId !== familyId) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'not found');
      return 'parent';
    }
    const access = await this.billing.accessOf(actor);
    if (access.scope === null) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'not found');
    await this.requirePayerInScope(actor, access, familyId);
    return 'staff';
  }

  // ------------------------------------------------------------------

  private requestTerms(body: Record<string, unknown>) {
    const purpose = body.purpose as RequestPurpose;
    if (!REQUEST_PURPOSES.includes(purpose)) throw invalid(`purpose: ${REQUEST_PURPOSES.join(' | ')}`);
    const label = requireText('label', body.label, 120);
    let planMonths: number | null = null;
    if (body.planMonths !== undefined && body.planMonths !== null) {
      if (!(SUBSCRIPTION_PLAN_MONTHS as readonly unknown[]).includes(body.planMonths)) throw invalid('planMonths: 1, 3, 6 or 12');
      planMonths = body.planMonths as number;
    }
    const periodStart = optionalDate('periodStart', body.periodStart);
    const periodEnd = optionalDate('periodEnd', body.periodEnd);
    if (periodStart && periodEnd && periodEnd < periodStart) throw invalid('periodEnd: on or after periodStart');
    // PD-30: a subscription or renewal says how many lessons it buys; the
    // child's ledger is credited when it is paid in full (a database trigger).
    let lessonsIncluded: number | null = null;
    if (body.lessonsIncluded !== undefined && body.lessonsIncluded !== null) {
      const n = body.lessonsIncluded;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 1000) throw invalid('lessonsIncluded: an integer from 1 to 1000');
      if (purpose !== 'subscription' && purpose !== 'renewal') throw invalid('lessonsIncluded: only a subscription or a renewal buys lessons');
      lessonsIncluded = n;
    }
    return {
      purpose,
      label,
      planMonths,
      lessonsIncluded,
      periodStart: periodStart ? dateOnly(periodStart) : null,
      periodEnd: periodEnd ? dateOnly(periodEnd) : null,
    };
  }

  /** PD-27: money going back out (a refund) is the super admin's or the Operations Manager's. */
  private async requireVerifier(actorId: string): Promise<{ actor: Actor; access: BillingAccess }> {
    const { actor, access } = await this.billing.requireReader(actorId);
    if (!access.canVerify) {
      throw new CommError(CommErrorCode.BILLING_DENIED, 'refunds are made by the super admin or the Operations Manager');
    }
    return { actor, access };
  }

  /**
   * Trials have no family to reach: only staff who see every family (Sales, the
   * Operations Manager, the super admin). PD-42: a Sales member limited to the
   * families they own ('owned') still works the trial desk.
   */
  private async requireTrialRecorder(actorId: string, payer: TrialPayer) {
    const { actor, access } = await this.billing.requireRecorder(actorId);
    if ((access.scope !== 'all' && access.scope !== 'owned') || actor.organizationId !== payer.organizationId) {
      throw new CommError(CommErrorCode.BILLING_DENIED, 'a trial\'s payment is requested by Sales or the Operations Manager');
    }
    return { actor, access };
  }

  private async requirePayerInScope(actor: Actor, access: BillingAccess, familyId: string | null) {
    if (familyId) {
      await this.billing.requireFamily(actor, access, familyId);
    } else if (access.scope !== 'all' && access.scope !== 'owned') {
      // A trial's money, before Assign: no family for a supervisor to reach
      // (PD-42: trials stay every Sales member's).
      throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'not found');
    }
  }

  private async requireRequest(actor: Actor, access: BillingAccess, requestId: string): Promise<PaymentRequest> {
    if (!isUuid(requestId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'payment request not found');
    const request = await this.prisma.paymentRequest.findFirst({ where: { id: requestId.toLowerCase(), organizationId: actor.organizationId as string } });
    if (!request) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'payment request not found');
    await this.requirePayerInScope(actor, access, request.familyId);
    return request;
  }

  private async requirePayment(actor: Actor, access: BillingAccess, paymentId: string): Promise<Payment> {
    if (!isUuid(paymentId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'payment not found');
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId.toLowerCase(), organizationId: actor.organizationId as string } });
    if (!payment) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'payment not found');
    await this.requirePayerInScope(actor, access, payment.familyId);
    return payment;
  }

  private async requireReceipt(actor: Actor, access: BillingAccess, receiptId: string): Promise<PaymentReceipt> {
    if (!isUuid(receiptId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'receipt not found');
    const receipt = await this.prisma.paymentReceipt.findFirst({ where: { id: receiptId.toLowerCase(), organizationId: actor.organizationId as string } });
    if (!receipt) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'receipt not found');
    await this.billing.requireFamily(actor, access, receipt.familyId);
    return receipt;
  }

  private async findInvoice(invoiceId: string, organizationId: string) {
    if (!isUuid(invoiceId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'invoice not found');
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId.toLowerCase(), organizationId } });
    if (!invoice) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'invoice not found');
    return invoice;
  }

  private async presentReceipt(receiptId: string, viewerActorId: string) {
    const row = await this.prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    return (await this.reads.presentReceipts([row], viewerActorId))[0];
  }

  /** After a void or refund: the family's money, or the trial's requests. */
  private async presentAfter(actor: Actor, access: BillingAccess, payment: Payment) {
    if (payment.familyId) return this.billing.presentFamily(actor, access, payment.familyId);
    return this.reads.forTrial(payment.trialLessonId as string, payment.organizationId, actor.actorId);
  }

  async expireOpenCheckouts(requestId: string): Promise<void> {
    if (!this.stripe.checkoutAvailable) return;
    const open = await this.prisma.paymentCheckout.findMany({ where: { requestId, status: 'open' } });
    for (const c of open) {
      try {
        await this.stripe.expireCheckout(c.stripeSessionId);
        await this.prisma.paymentCheckout.update({ where: { stripeSessionId: c.stripeSessionId }, data: { status: 'expired' } });
      } catch {
        // Already completed or expired at Stripe; the webhook settles which.
      }
    }
  }
}

function expiryDays(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_EXPIRY_DAYS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 90) throw invalid('expiresInDays: 1 to 90');
  return value;
}

function validateBankAccount(raw: unknown): BankAccount {
  if (!raw || typeof raw !== 'object') throw invalid('bankAccount: { accountName, bankName?, iban?, accountNumber?, swift?, note? }');
  const v = raw as Record<string, unknown>;
  return {
    accountName: requireText('bankAccount.accountName', v.accountName, 120),
    bankName: optionalText('bankAccount.bankName', v.bankName, 120),
    iban: optionalText('bankAccount.iban', v.iban, 64),
    accountNumber: optionalText('bankAccount.accountNumber', v.accountNumber, 64),
    swift: optionalText('bankAccount.swift', v.swift, 32),
    note: optionalText('bankAccount.note', v.note, 300),
  };
}

function validateIssuer(raw: unknown) {
  if (!raw || typeof raw !== 'object') throw invalid('issuer: { name, address?, taxId? }');
  const v = raw as Record<string, unknown>;
  return {
    name: requireText('issuer.name', v.name, 120),
    address: optionalText('issuer.address', v.address, 300),
    taxId: optionalText('issuer.taxId', v.taxId, 64),
  };
}
