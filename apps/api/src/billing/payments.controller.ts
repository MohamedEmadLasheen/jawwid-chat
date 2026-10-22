import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ActionScope, RateLimited } from '../platform/auth/action-throttle.guard';
import { ParentPaymentsService } from './parent-payments.service';
import { PaymentsService } from './payments.service';

/**
 * PD-27 routes (docs/admin/pd027-payments.md). Behind the global bearer guard.
 * Staff routes answer billingAccessOf (+ canVerify); `/me/billing/*` answers
 * an active parent of the caller's own family. POST for every change: the
 * shared admin-web client prefers it.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly parents: ParentPaymentsService,
  ) {}

  // ---- staff -------------------------------------------------------

  @Post('families/:id/payment-requests')
  createRequest(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.payments.createRequest(actorId, id, body ?? {});
  }

  @Post('payment-requests/:id/cancel')
  cancelRequest(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.payments.cancelRequest(actorId, id, body ?? {});
  }

  /** { method: cash | bank_transfer, amountMinor, paidOn, requestId? | instalmentId?, learnerId?, reference? } */
  @Post('families/:id/payments')
  recordManual(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.payments.recordManual(actorId, id, body ?? {});
  }

  @Post('payments/:id/void')
  voidPayment(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.payments.voidPayment(actorId, id, body ?? {});
  }

  @Post('payments/:id/refunds')
  refund(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.payments.refund(actorId, id, body ?? {});
  }

  @Get('payment-receipts')
  receipts(@ActorId() actorId: string, @Query('status') status?: string) {
    return this.payments.receipts(actorId, status);
  }

  @Post('payment-receipts/:id/approve')
  approveReceipt(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.payments.approveReceipt(actorId, id, body ?? {});
  }

  @Post('payment-receipts/:id/reject')
  rejectReceipt(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.payments.rejectReceipt(actorId, id, body ?? {});
  }

  @Get('invoices/:id/link')
  invoiceLink(@ActorId() actorId: string, @Param('id') id: string) {
    return this.payments.invoiceLink(actorId, id);
  }

  @Get('billing/settings')
  settings(@ActorId() actorId: string) {
    return this.payments.settings(actorId);
  }

  @Post('billing/settings')
  setSettings(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.payments.setSettings(actorId, body ?? {});
  }

  // ---- the parent ----------------------------------------------------

  /** { requestId } | { instalmentId } -> { url } */
  @Post('me/billing/checkout')
  checkout(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.parents.startCheckout(actorId, body ?? {});
  }

  @RateLimited(ActionScope.ATTACHMENT_UPLOAD)
  @Post('me/billing/receipts/upload')
  authorizeReceiptUpload(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.parents.authorizeReceiptUpload(actorId, body ?? {});
  }

  @Post('me/billing/receipts')
  submitReceipt(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.parents.submitReceipt(actorId, body ?? {});
  }

  @Get('me/billing/invoices/:id/link')
  myInvoiceLink(@ActorId() actorId: string, @Param('id') id: string) {
    return this.parents.invoiceLink(actorId, id);
  }
}
