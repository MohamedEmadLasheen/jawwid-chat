import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { BillingService } from './billing.service';

/**
 * PD-12 S3: Instalment Payments. Behind the global bearer guard; only
 * Operations (in scope), the Operations Manager and the super admin are
 * answered (BillingService). POST for every change: the shared admin-web
 * client has no PUT.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Navigation probe: { billingReader, canAssignBillingSupervisor, coreConnected }. */
  @Get('instalments/access')
  access(@ActorId() actorId: string) {
    return this.billing.access(actorId);
  }

  /** ?responsible=all|me|none &paid=true -- Core's invoices, read now, never stored. */
  @Get('instalments')
  list(@ActorId() actorId: string, @Query('responsible') responsible?: string, @Query('paid') paid?: string) {
    return this.billing.list(actorId, { responsible, paid });
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
