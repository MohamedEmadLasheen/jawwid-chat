import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { Public } from '../platform/auth/auth.guard';
import { CommError } from '../platform/errors';
import { actorIsLive } from '../platform/liveness';
import { MediaUrlSigner, type MediaVariant } from '../platform/media-url';
import { PrismaService } from '../platform/prisma.service';
import { OBJECT_STORAGE } from '../platform/tokens';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { serveAuthorizedMedia, type RequestLike, type ResponseLike } from '../communication/api/media-serve';
import type { InvoiceSnapshot } from './payment-ledger.service';
import { renderInvoicePdf } from './invoice-pdf';
import { PaymentsService } from './payments.service';

/**
 * PD-27: the two files of the payments feature, through the same signed,
 * per-viewer, re-authorized media path as every other file (RT-037):
 *
 *   /media/payment-receipts/:id   a parent's bank-transfer receipt (stored bytes)
 *   /media/invoices/:id           an invoice, rendered as a PDF on request
 *
 * Readers: the family's active parents, and staff who read that family's
 * money (billingAccessOf; a trial's money before Assign: staff who see every
 * family). Decided on every request, after the link's signature and the
 * reader's liveness. `@Public()` to the bearer guard because a PDF viewer or
 * an <img> cannot send a header; the link is the binding.
 */
@Public()
@Controller('media')
export class BillingMediaController {
  private readonly signer = new MediaUrlSigner();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly payments: PaymentsService,
  ) {}

  @Get('payment-receipts/:receiptId')
  receipt(
    @Param('receiptId') receiptId: string,
    @Query('v') variant: string,
    @Query('a') actorId: string,
    @Query('e') expires: string,
    @Query('s') sig: string,
    @Req() req: RequestLike,
    @Res() res: ResponseLike,
  ): Promise<void> {
    return serveAuthorizedMedia(
      { signer: this.signer, prisma: this.prisma, storage: this.storage },
      'payment-receipts', receiptId, variant, actorId, expires, sig, req, res,
      () => this.payments.authorizeReceiptRead(receiptId, actorId),
    );
  }

  @Get('invoices/:invoiceId')
  async invoice(
    @Param('invoiceId') invoiceId: string,
    @Query('v') variant: string,
    @Query('a') actorId: string,
    @Query('e') expires: string,
    @Query('s') sig: string,
    @Res() res: ResponseLike,
  ): Promise<void> {
    if (!this.signer.verify({ kind: 'invoices', attachmentId: invoiceId, variant: variant as MediaVariant, actorId, expires: Number(expires), sig })) {
      return refuse(res, 403, 'invalid or expired link');
    }
    if (!(await actorIsLive(this.prisma, actorId))) return refuse(res, 403, 'this account is no longer active');
    let found: Awaited<ReturnType<PaymentsService['authorizeInvoiceRead']>>;
    try {
      found = await this.payments.authorizeInvoiceRead(invoiceId, actorId);
    } catch (e) {
      if (e instanceof CommError) return refuse(res, e.status === 404 ? 404 : 403, 'not available');
      throw e;
    }
    const { invoice, refundedMinor } = found;
    const snapshot = invoice.snapshot as unknown as InvoiceSnapshot;
    const status = invoice.voidedAt
      ? 'void'
      : refundedMinor >= snapshot.amountMinor
        ? 'refunded'
        : refundedMinor > 0
          ? 'partially_refunded'
          : 'paid';
    const pdf = await renderInvoicePdf({ number: invoice.number, issuedAt: invoice.issuedAt, status, refundedMinor, snapshot });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.number}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Length', String(pdf.length));
    res.status(200);
    res.send(pdf);
  }
}

function refuse(res: ResponseLike, status: number, message: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify({ error: { message } }));
}
