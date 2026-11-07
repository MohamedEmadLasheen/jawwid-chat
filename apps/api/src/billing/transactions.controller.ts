import { Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Requires } from '../platform/permissions/route-access';
import { StripeReconciler } from './stripe-reconciler.service';
import { TransactionsService } from './transactions.service';

/**
 * PD-27 completion (docs/admin/pd027-stripe-lifecycle.md §3.5): the academy's
 * transactions, card attempts, the Stripe webhook log, and reconciliation.
 * Behind the global bearer guard; reads answer billingAccessOf in the family
 * scope, reconciliation and the event log canVerify.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class TransactionsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly reconciler: StripeReconciler,
  ) {}

  /** ?status=&method=&purpose=&planMonths=&from=&to=&familyId=&q=&cursor=&limit= */
  @Requires('billing.view')
  @Get('payments')
  list(@ActorId() actorId: string, @Query() query: Record<string, unknown>) {
    return this.transactions.list(actorId, query ?? {});
  }

  @Requires('billing.view')
  @Get('payments/:id')
  detail(@ActorId() actorId: string, @Param('id') id: string) {
    return this.transactions.detail(actorId, id);
  }

  @Requires('billing.verify')
  @Post('payments/:id/reconcile')
  reconcilePayment(@ActorId() actorId: string, @Param('id') id: string) {
    return this.reconciler.reconcilePayment(actorId, id);
  }

  /** ?status=failed|open|expired|complete|all&from=&to=&cursor=&limit= */
  @Requires('billing.view')
  @Get('payment-attempts')
  attempts(@ActorId() actorId: string, @Query() query: Record<string, unknown>) {
    return this.transactions.attempts(actorId, query ?? {});
  }

  /** ?outcome=&type=&cursor=&limit= */
  @Requires('billing.verify')
  @Get('stripe/events')
  events(@ActorId() actorId: string, @Query() query: Record<string, unknown>) {
    return this.transactions.events(actorId, query ?? {});
  }

  @Requires('billing.verify')
  @Post('stripe/reconcile')
  reconcileNow(@ActorId() actorId: string) {
    return this.reconciler.reconcileNow(actorId);
  }
}
