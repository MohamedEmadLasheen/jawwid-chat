import { Injectable } from '@nestjs/common';
import type { Invoice, Payment, PaymentReceipt, PaymentRefund, PaymentRequest } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { MediaUrlSigner } from '../platform/media-url';
import { PaymentLedger, type InvoiceSnapshot, type PaymentMethod, type RequestPurpose } from './payment-ledger.service';
import { day } from './validate';

type Person = { id: string; name: string };
type Child = { id: string | null; name: string };
export type RequestStatus = 'open' | 'paid' | 'cancelled' | 'expired';
export type InvoiceStatus = 'paid' | 'partially_refunded' | 'refunded' | 'void';

export interface PaymentRequestDto {
  id: string;
  purpose: RequestPurpose;
  label: string;
  status: RequestStatus;
  amountMinor: number;
  paidMinor: number;
  remainingMinor: number;
  currency: string;
  child: Child | null;
  instalmentId: string | null;
  planMonths: number | null;
  /** PD-30: the lessons a subscription / renewal buys (credited when paid in full). */
  lessonsIncluded: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  expiresAt: string;
  createdAt: string;
  link?: string;
  createdBy?: Person | null;
  cancelled?: { at: string; by: Person | null; reason: string } | null;
  trialId?: string | null;
}

export interface PaymentDto {
  id: string;
  method: PaymentMethod;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  paidOn: string;
  recordedAt: string;
  requestId: string | null;
  instalmentId: string | null;
  child: Child | null;
  reference: string | null;
  invoice: { id: string; number: string } | null;
  recordedBy?: Person | null;
  voided?: { at: string; by: Person; reason: string } | null;
  refunds?: { id: string; amountMinor: number; reason: string; at: string; source: 'stripe' | 'staff' }[];
}

export interface InvoiceDto {
  id: string;
  number: string;
  issuedAt: string;
  status: InvoiceStatus;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  method: PaymentMethod;
  paidOn: string;
  label: string;
  child: Child | null;
  planMonths: number | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface ReceiptDto {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  requestId: string;
  label: string;
  amountMinor: number;
  currency: string;
  transferredOn: string;
  note: string | null;
  uploadedAt: string;
  fileUrl: string;
  mimeType: string;
  rejectReason: string | null;
  paymentId: string | null;
  family?: { id: string; name: string } | null;
  uploadedBy?: Person;
  reviewedBy?: Person | null;
  reviewedAt?: string | null;
}

export interface MoneyView {
  requests: PaymentRequestDto[];
  payments: PaymentDto[];
  invoices: InvoiceDto[];
  receipts: ReceiptDto[];
  /** Per instalment: what its standing payments add up to, and its live request. */
  byInstalment: Map<string, { paidMinor: number; requestId: string | null }>;
}

/** A receipt file link lives this long; the list hands out a fresh one each read. */
const RECEIPT_LINK_TTL_SECONDS = 15 * 60;

/**
 * PD-27: how requests, payments, invoices and receipts are shown -- to staff
 * (everything, with names and reasons) and to the family's parents (what stands:
 * no voided payment or invoice, no cancelled or expired request, no staff name,
 * no reason except a rejected receipt's, which is addressed to them).
 */
@Injectable()
export class PaymentsReadService {
  private readonly signer = new MediaUrlSigner();

  constructor(private readonly prisma: PrismaService) {}

  async forFamily(familyId: string, organizationId: string, viewer: { actorId: string; staff: boolean }): Promise<MoneyView> {
    const [requests, payments, receipts] = await Promise.all([
      this.prisma.paymentRequest.findMany({ where: { familyId, organizationId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.payment.findMany({ where: { familyId, organizationId }, orderBy: [{ paidOn: 'desc' }, { recordedAt: 'desc' }] }),
      this.prisma.paymentReceipt.findMany({ where: { familyId, organizationId }, orderBy: { uploadedAt: 'desc' } }),
    ]);
    return this.present({ requests, payments, receipts }, viewer);
  }

  /** A trial's requests and payments before Assign (staff only). */
  async forTrial(trialLessonId: string, organizationId: string, viewerActorId: string) {
    const [requests, payments] = await Promise.all([
      this.prisma.paymentRequest.findMany({ where: { trialLessonId, organizationId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.payment.findMany({ where: { trialLessonId, organizationId }, orderBy: [{ paidOn: 'desc' }, { recordedAt: 'desc' }] }),
    ]);
    const view = await this.present({ requests, payments, receipts: [] }, { actorId: viewerActorId, staff: true });
    return { items: view.requests, payments: view.payments };
  }

  async presentOneRequest(request: PaymentRequest, staff: boolean): Promise<PaymentRequestDto> {
    const payments = await this.prisma.payment.findMany({ where: { requestId: request.id } });
    const view = await this.present({ requests: [request], payments, receipts: [] }, { actorId: '', staff });
    return view.requests[0] as PaymentRequestDto;
  }

  async presentReceipts(receipts: PaymentReceipt[], viewerActorId: string): Promise<ReceiptDto[]> {
    const view = await this.present({ requests: [], payments: [], receipts }, { actorId: viewerActorId, staff: true }, true);
    return view.receipts;
  }

  private async present(
    rows: { requests: PaymentRequest[]; payments: Payment[]; receipts: PaymentReceipt[] },
    viewer: { actorId: string; staff: boolean },
    withFamilies = false,
  ): Promise<MoneyView> {
    const { requests, payments, receipts } = rows;
    const paymentIds = payments.map((p) => p.id);
    const [invoices, refunds] = await Promise.all([
      paymentIds.length ? this.prisma.invoice.findMany({ where: { paymentId: { in: paymentIds } } }) : Promise.resolve([] as Invoice[]),
      paymentIds.length ? this.prisma.paymentRefund.findMany({ where: { paymentId: { in: paymentIds } }, orderBy: { createdAt: 'asc' } }) : Promise.resolve([] as PaymentRefund[]),
    ]);
    // Receipts name their request's label; the request may not be in `requests` (the queue).
    const extraRequestIds = receipts.map((r) => r.requestId).filter((id) => !requests.some((q) => q.id === id));
    const receiptRequests = extraRequestIds.length
      ? await this.prisma.paymentRequest.findMany({ where: { id: { in: [...new Set(extraRequestIds)] } }, select: { id: true, label: true } })
      : [];
    const labelOf = new Map<string, string>([...requests.map((r) => [r.id, r.label] as const), ...receiptRequests.map((r) => [r.id, r.label] as const)]);

    const learnerIds = [...new Set([...requests, ...payments].flatMap((r) => (r.learnerId ? [r.learnerId] : [])))];
    const learners = learnerIds.length
      ? await this.prisma.learner.findMany({ where: { id: { in: learnerIds } }, select: { id: true, name: true } })
      : [];
    const learnerName = new Map(learners.map((l) => [l.id, l.name]));
    const childOf = (r: { learnerId: string | null; childName: string | null }): Child | null =>
      r.learnerId ? { id: r.learnerId, name: learnerName.get(r.learnerId) ?? r.childName ?? '' } : r.childName ? { id: null, name: r.childName } : null;

    const staffIds = new Set<string>();
    if (viewer.staff) {
      for (const r of requests) for (const id of [r.createdBy, r.cancelledBy]) if (id) staffIds.add(id);
      for (const p of payments) for (const id of [p.recordedBy, p.voidedBy]) if (id) staffIds.add(id);
      for (const r of receipts) if (r.reviewedBy) staffIds.add(r.reviewedBy);
    }
    const staffName = staffIds.size
      ? new Map((await this.prisma.staff.findMany({ where: { id: { in: [...staffIds] } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]))
      : new Map<string, string>();
    const person = (id: string | null): Person | null => (id ? { id, name: staffName.get(id) ?? '' } : null);

    const contactIds = viewer.staff ? [...new Set(receipts.map((r) => r.uploadedBy))] : [];
    const contactName = contactIds.length
      ? new Map((await this.prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]))
      : new Map<string, string>();
    const familyIds = withFamilies ? [...new Set(receipts.map((r) => r.familyId))] : [];
    const familyName = familyIds.length
      ? new Map((await this.prisma.family.findMany({ where: { id: { in: familyIds } }, select: { id: true, displayName: true } })).map((f) => [f.id, f.displayName]))
      : new Map<string, string>();

    const refundsOf = new Map<string, PaymentRefund[]>();
    for (const r of refunds) refundsOf.set(r.paymentId, [...(refundsOf.get(r.paymentId) ?? []), r]);
    const refundedOf = (paymentId: string) => (refundsOf.get(paymentId) ?? []).reduce((a, r) => a + Number(r.amountMinor), 0);
    const invoiceOf = new Map(invoices.map((i) => [i.paymentId, i]));

    // Standing payments per request / instalment.
    const paidOfRequest = new Map<string, number>();
    const byInstalment = new Map<string, { paidMinor: number; requestId: string | null }>();
    for (const p of payments) {
      if (p.voidedAt) continue;
      if (p.requestId) paidOfRequest.set(p.requestId, (paidOfRequest.get(p.requestId) ?? 0) + Number(p.amountMinor));
      if (p.instalmentId) {
        const e = byInstalment.get(p.instalmentId) ?? { paidMinor: 0, requestId: null };
        e.paidMinor += Number(p.amountMinor);
        byInstalment.set(p.instalmentId, e);
      }
    }
    const now = new Date();
    for (const r of requests) {
      if (r.instalmentId && !r.paidAt && !r.cancelledAt && r.expiresAt > now) {
        const e = byInstalment.get(r.instalmentId) ?? { paidMinor: 0, requestId: null };
        e.requestId = r.id;
        byInstalment.set(r.instalmentId, e);
      }
    }

    const requestDtos: PaymentRequestDto[] = [];
    for (const r of requests) {
      const status: RequestStatus = r.paidAt ? 'paid' : r.cancelledAt ? 'cancelled' : r.expiresAt <= now ? 'expired' : 'open';
      if (!viewer.staff && (status === 'cancelled' || status === 'expired')) continue;
      const amount = Number(r.amountMinor);
      const paid = paidOfRequest.get(r.id) ?? 0;
      const dto: PaymentRequestDto = {
        id: r.id,
        purpose: r.purpose as RequestPurpose,
        label: r.label,
        status,
        amountMinor: amount,
        paidMinor: paid,
        remainingMinor: Math.max(0, amount - paid),
        currency: r.currency,
        child: childOf(r),
        instalmentId: r.instalmentId,
        planMonths: r.planMonths,
        lessonsIncluded: r.lessonsIncluded,
        periodStart: r.periodStart ? day(r.periodStart) : null,
        periodEnd: r.periodEnd ? day(r.periodEnd) : null,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      };
      if (viewer.staff) {
        dto.link = PaymentLedger.linkFor(r.token);
        dto.createdBy = person(r.createdBy);
        dto.cancelled = r.cancelledAt && r.cancelReason ? { at: r.cancelledAt.toISOString(), by: person(r.cancelledBy), reason: r.cancelReason } : null;
        dto.trialId = r.familyId ? null : r.trialLessonId;
      }
      requestDtos.push(dto);
    }

    const paymentDtos: PaymentDto[] = [];
    const invoiceDtos: InvoiceDto[] = [];
    for (const p of payments) {
      if (!viewer.staff && p.voidedAt) continue;
      const inv = invoiceOf.get(p.id) ?? null;
      const refunded = refundedOf(p.id);
      const dto: PaymentDto = {
        id: p.id,
        method: p.method as PaymentMethod,
        amountMinor: Number(p.amountMinor),
        refundedMinor: refunded,
        currency: p.currency,
        paidOn: day(p.paidOn),
        recordedAt: p.recordedAt.toISOString(),
        requestId: p.requestId,
        instalmentId: p.instalmentId,
        child: childOf(p),
        reference: p.reference,
        invoice: inv ? { id: inv.id, number: inv.number } : null,
      };
      if (viewer.staff) {
        dto.recordedBy = person(p.recordedBy);
        dto.voided = p.voidedAt && p.voidedBy && p.voidReason ? { at: p.voidedAt.toISOString(), by: person(p.voidedBy) as Person, reason: p.voidReason } : null;
        dto.refunds = (refundsOf.get(p.id) ?? []).map((r) => ({
          id: r.id,
          amountMinor: Number(r.amountMinor),
          reason: r.reason,
          at: r.createdAt.toISOString(),
          source: r.recordedBy ? ('staff' as const) : ('stripe' as const),
        }));
      }
      paymentDtos.push(dto);
      if (inv && (viewer.staff || !inv.voidedAt)) invoiceDtos.push(presentInvoice(inv, p, refunded, childOf(p)));
    }

    const receiptDtos: ReceiptDto[] = receipts.map((r) => {
      const dto: ReceiptDto = {
        id: r.id,
        status: r.status as ReceiptDto['status'],
        requestId: r.requestId,
        label: labelOf.get(r.requestId) ?? '',
        amountMinor: Number(r.amountMinor),
        currency: r.currency,
        transferredOn: day(r.transferredOn),
        note: r.note,
        uploadedAt: r.uploadedAt.toISOString(),
        fileUrl: this.signer.url('payment-receipts', r.id, 'o', viewer.actorId, RECEIPT_LINK_TTL_SECONDS),
        mimeType: r.mimeType,
        rejectReason: r.rejectReason,
        paymentId: r.paymentId,
      };
      if (viewer.staff) {
        dto.uploadedBy = { id: r.uploadedBy, name: contactName.get(r.uploadedBy) ?? '' };
        dto.reviewedBy = person(r.reviewedBy);
        dto.reviewedAt = r.reviewedAt?.toISOString() ?? null;
        if (withFamilies) dto.family = { id: r.familyId, name: familyName.get(r.familyId) ?? '' };
      }
      return dto;
    });

    return { requests: requestDtos, payments: paymentDtos, invoices: invoiceDtos, receipts: receiptDtos, byInstalment };
  }
}

export function presentInvoice(inv: Invoice, p: Payment, refundedMinor: number, child: Child | null): InvoiceDto {
  const s = inv.snapshot as unknown as InvoiceSnapshot;
  const amount = Number(p.amountMinor);
  const status: InvoiceStatus = inv.voidedAt
    ? 'void'
    : refundedMinor >= amount
      ? 'refunded'
      : refundedMinor > 0
        ? 'partially_refunded'
        : 'paid';
  return {
    id: inv.id,
    number: inv.number,
    issuedAt: inv.issuedAt.toISOString(),
    status,
    amountMinor: amount,
    refundedMinor,
    currency: p.currency,
    method: p.method as PaymentMethod,
    paidOn: day(p.paidOn),
    label: s.label,
    child: child ?? (s.child ? { id: null, name: s.child } : null),
    planMonths: s.planMonths,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
  };
}
