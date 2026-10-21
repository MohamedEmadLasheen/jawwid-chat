import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { BillingService } from './billing.service';

/**
 * Instalment Payments (PD-12 S3) and a family's money (PD-17). Behind the
 * global bearer guard; only Operations (in scope), the Operations Manager and
 * the super admin are answered (BillingService, billingAccessOf), Sales too
 * (PD-17), and a parent only for their own family (`/me/billing`) -- never a
 * teacher. POST for every change: the shared admin-web client has no PUT.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** PD-17: the signed-in parent's own payments (the app's Settings > Payments). */
  @Get('me/billing')
  mine(@ActorId() actorId: string) {
    return this.billing.mine(actorId);
  }

  /** Navigation probe: { billingReader, canAssignBillingSupervisor, canRecordPayments }. */
  @Get('instalments/access')
  access(@ActorId() actorId: string) {
    return this.billing.access(actorId);
  }

  /** ?responsible=all|me|none &paid=true -- the open (and paid) instalments in scope. */
  @Get('instalments')
  list(@ActorId() actorId: string, @Query('responsible') responsible?: string, @Query('paid') paid?: string) {
    return this.billing.list(actorId, { responsible, paid });
  }

  /** { paidOn, method?, reference? } -- once; a mistake is voided. */
  @Post('instalments/:id/payment')
  recordPayment(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.billing.recordPayment(actorId, id, body ?? {});
  }

  /** { reason } -- final. */
  @Post('instalments/:id/void')
  voidInstalment(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.billing.voidInstalment(actorId, id, body ?? {});
  }

  /** The family's payment method, plan and payment timeline. */
  @Get('families/:id/billing')
  familyBilling(@ActorId() actorId: string, @Param('id') id: string) {
    return this.billing.familyBilling(actorId, id);
  }

  /** { paymentMethod?, currency?, planMonths? } -- partial; null clears. */
  @Post('families/:id/billing')
  setFamilyBilling(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.billing.setFamilyBilling(actorId, id, body ?? {});
  }

  /** { label, amountMinor, firstDueDate, currency?, count?, everyMonths?, learnerId? } */
  @Post('families/:id/instalments')
  createInstalments(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.billing.createInstalments(actorId, id, body ?? {});
  }

  @Get('families/:id/billing-supervisor')
  billingSupervisor(@ActorId() actorId: string, @Param('id') id: string) {
    return this.billing.billingSupervisor(actorId, id);
  }

  /** { supervisorId: uuid | null, reason } -- null clears it. */
  @Post('families/:id/billing-supervisor')
  setBillingSupervisor(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.billing.setBillingSupervisor(actorId, id, body ?? {});
  }
}
