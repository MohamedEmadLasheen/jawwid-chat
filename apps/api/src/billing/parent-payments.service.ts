import { Inject, Injectable } from '@nestjs/common';
import type { PaymentRequest } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, OBJECT_STORAGE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { MediaUrlSigner } from '../platform/media-url';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { sniffCertificateFile } from '../certificates/certificate-file';
import { todayIn } from '../leave/leave.service';
import { BillingService } from './billing.service';
import { CheckoutService } from './checkout.service';
import { PaymentLedger } from './payment-ledger.service';
import { dateOnly, invalid, optionalText, optionalUuid, requireAmount, requireDate } from './validate';
import { assertReplay, isoDay, lockIdempotencyKey } from './idempotency';

export const RECEIPT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
/** A family with this many receipts waiting has not lost one; it is a loop or abuse. */
const MAX_PENDING_RECEIPTS = 5;
const INVOICE_LINK_TTL_SECONDS = 5 * 60;

/**
 * PD-27, the parent side (any active parent of the family, PD-17's rule): pay
 * a request or an instalment by card, send a bank-transfer receipt, open an
 * invoice. The family is always the caller's own; nothing here takes one.
 */
@Injectable()
export class ParentPaymentsService {
  private readonly signer = new MediaUrlSigner();

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly billing: BillingService,
    private readonly ledger: PaymentLedger,
    private readonly checkout: CheckoutService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** { requestId } | { instalmentId } -> { url } (Stripe Checkout). */
  async startCheckout(actorId: string, body: Record<string, unknown>) {
    const { actor, contact } = await this.billing.requireParent(actorId);
    if (!this.checkout.available) {
      throw new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, 'card payments are not available; pay by bank transfer', 503);
    }
    const request = await this.payable(actor.actorId, contact.familyId, body);
    const family = await this.prisma.family.findUnique({ where: { id: contact.familyId }, select: { language: true } });
    const url = await this.checkout.open(request, {
      locale: family?.language === 'en' ? 'en' : 'ar',
      returnUrl: PaymentLedger.linkFor(request.token),
    });
    return { url };
  }

  /** { mimeType, byteSize } -> a signed PUT for the receipt file. */
  async authorizeReceiptUpload(actorId: string, body: Record<string, unknown>) {
    const { contact } = await this.billing.requireParent(actorId);
    const { mimeType, byteSize } = validateReceiptFile(body.mimeType, body.byteSize);
    const grant = await this.storage.authorizeUpload({ prefix: `payment-receipts/${contact.familyId}`, mimeType, byteSize });
    return { objectKey: grant.objectKey, uploadUrl: grant.uploadUrl, method: grant.method, headers: grant.headers, expiresAt: grant.expiresAt };
  }

  /** { objectKey, requestId | instalmentId, amountMinor, transferredOn, note? } -> GET /me/billing. */
  async submitReceipt(actorId: string, body: Record<string, unknown>) {
    const { actor, contact } = await this.billing.requireParent(actorId);
    const objectKey = typeof body.objectKey === 'string' ? body.objectKey : '';
    if (!objectKey.startsWith(`payment-receipts/${contact.familyId}/`) || objectKey.includes('..')) {
      throw invalid('objectKey: that upload does not belong to this family');
    }
    const amountMinor = requireAmount('amountMinor', body.amountMinor);
    const transferredOn = requireDate('transferredOn', body.transferredOn);
    if (transferredOn > todayIn(await this.billing.timeZone())) throw invalid('transferredOn: not after today');
    const note = optionalText('note', body.note, 500);

    // ADMIN-001: one uploaded file is one receipt (object_key is unique), so the
    // file's key is this submit's idempotency key: the same submit again (a retry,
    // a double tap) gets the first answer; another use of the file is refused.
    const sameReceipt = (r: { familyId: string | null; uploadedBy: string | null; amountMinor: bigint; transferredOn: Date; note: string | null }) =>
      r.familyId === contact.familyId && r.uploadedBy === contact.id && Number(r.amountMinor) === amountMinor
      && isoDay(r.transferredOn) === transferredOn && (r.note ?? null) === (note ?? null);
    const prior = await this.prisma.paymentReceipt.findUnique({ where: { objectKey } });
    if (prior) {
      assertReplay('receipt', sameReceipt(prior));
      return this.billing.mine(actorId);
    }

    // The file must be there, and be what storage was told it is.
    const stored = await this.storage.readHead(objectKey, 16);
    if (!stored) throw new CommError(CommErrorCode.BILLING_STATE, 'the receipt file has not been uploaded', 409);
    const sniffed = sniffCertificateFile(stored.head);
    if (!sniffed || sniffed !== stored.contentType || stored.byteSize > MAX_RECEIPT_BYTES) {
      await this.storage.delete(objectKey).catch(() => undefined);
      throw invalid('the receipt must be a JPEG, PNG, WebP or PDF file of at most 10 MB');
    }
    const pending = await this.prisma.paymentReceipt.count({ where: { familyId: contact.familyId, status: 'pending' } });
    if (pending >= MAX_PENDING_RECEIPTS) {
      throw new CommError(CommErrorCode.BILLING_STATE, 'several receipts are already waiting to be checked; we will confirm them soon', 409);
    }

    const request = await this.payable(actor.actorId, contact.familyId, body, { allowExpired: true });
    const remaining = Number(request.amountMinor) - (await this.ledger.standingSum(this.prisma, { requestId: request.id }));
    if (amountMinor > Math.max(remaining, 0)) throw invalid(`amountMinor: at most what is still owed (${Math.max(remaining, 0)})`);

    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      await lockIdempotencyKey(tx, objectKey);
      const concurrent = await tx.paymentReceipt.findUnique({ where: { objectKey } });
      if (concurrent) {
        assertReplay('receipt', sameReceipt(concurrent));
        return; // a concurrent duplicate: the first one wrote it
      }
      const receipt = await tx.paymentReceipt.create({
        data: {
          organizationId: contact.organizationId,
          familyId: contact.familyId,
          requestId: request.id,
          amountMinor: BigInt(amountMinor),
          currency: request.currency,
          transferredOn: dateOnly(transferredOn),
          note,
          objectKey,
          mimeType: sniffed,
          byteSize: stored.byteSize,
          uploadedBy: contact.id,
        },
      });
      await this.audit.audit(tx, {
        // audit_log.actor_id is a staff id; the parent is named in the payload.
        action: 'receipt.uploaded',
        entity: 'family',
        entityId: contact.familyId,
        after: { receiptId: receipt.id, requestId: request.id, amountMinor, currency: request.currency, transferredOn, contactId: contact.id },
        reason: 'bank-transfer receipt sent by a parent',
      });
    });
    return this.billing.mine(actorId);
  }

  /** A signed PDF link, for an invoice of the caller's family that stands. */
  async invoiceLink(actorId: string, invoiceId: string) {
    const { contact } = await this.billing.requireParent(actorId);
    if (!isUuid(invoiceId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'invoice not found');
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId.toLowerCase(), familyId: contact.familyId, voidedAt: null },
      select: { id: true },
    });
    if (!invoice) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'invoice not found');
    return { url: this.signer.url('invoices', invoice.id, 'o', actorId, INVOICE_LINK_TTL_SECONDS) };
  }

  /**
   * The request the parent is paying: one of their family's (open), or the live
   * link of one of their open instalments (made for what it still owes).
   */
  private async payable(actorId: string, familyId: string, body: Record<string, unknown>, opts: { allowExpired?: boolean } = {}): Promise<PaymentRequest> {
    const requestId = optionalUuid('requestId', body.requestId);
    const instalmentId = optionalUuid('instalmentId', body.instalmentId);
    if ((requestId === null) === (instalmentId === null)) throw invalid('requestId or instalmentId (one of them)');
    if (requestId) {
      const request = await this.prisma.paymentRequest.findFirst({ where: { id: requestId, familyId } });
      if (!request) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'payment request not found');
      if (request.cancelledAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this payment request was cancelled', 409);
      if (request.paidAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this request is already paid', 409);
      if (!opts.allowExpired && request.expiresAt <= new Date()) {
        throw new CommError(CommErrorCode.BILLING_STATE, 'this payment request has expired; ask for a new link', 409);
      }
      return request;
    }
    const inst = await this.prisma.familyInstalment.findFirst({ where: { id: instalmentId as string, familyId } });
    if (!inst) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'instalment not found');
    if (inst.paidOn || inst.voidedAt) throw new CommError(CommErrorCode.BILLING_STATE, 'this instalment is already paid', 409);
    return this.prisma.$transaction((tx) => this.ledger.ensureInstalmentRequest(tx, inst, null));
  }
}

export function validateReceiptFile(mimeType: unknown, byteSize: unknown): { mimeType: string; byteSize: number } {
  if (typeof mimeType !== 'string' || !(RECEIPT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw invalid('mimeType: image/jpeg, image/png, image/webp or application/pdf');
  }
  if (typeof byteSize !== 'number' || !Number.isInteger(byteSize) || byteSize <= 0 || byteSize > MAX_RECEIPT_BYTES) {
    throw invalid('byteSize: at most 10 MB');
  }
  return { mimeType, byteSize };
}
