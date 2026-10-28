import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { SubscriptionLedger } from './subscription-ledger.service';
import { Requires } from '../platform/permissions/route-access';

/**
 * PD-30: a child's lesson ledger and its exceptions (Admin Web, the Student
 * Profile). Read by PD-17's billing readers in scope; the ledger written by
 * the payment recorders; exceptions granted and revoked only by the super
 * admin, the Operations Manager and the Sales Manager. Never a teacher or a
 * parent: the parent's own view is GET /me/billing's `subscriptions`.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class SubscriptionsController {
  constructor(private readonly ledger: SubscriptionLedger) {}

  @Requires('subscriptions.view')
  @Get('learners/:id/subscription')
  view(@ActorId() actorId: string, @Param('id') id: string) {
    return this.ledger.view(actorId, id);
  }

  /** { lessonsIncluded, reason, planMonths?, startsOn? } -- the three roles; the lessons are free. */
  @Requires('subscriptions.manage')
  @Post('learners/:id/subscriptions')
  add(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.ledger.add(actorId, id, body ?? {});
  }

  /** { reason } -- final. */
  @Requires('billing.record')
  @Post('subscriptions/:id/void')
  void(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.ledger.void(actorId, id, body ?? {});
  }

  /** { kind: balance | overdue | both, reason, validUntil } */
  @Requires('subscriptions.manage')
  @Post('learners/:id/subscription-exceptions')
  grant(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.ledger.grantException(actorId, id, body ?? {});
  }

  /** { reason } -- final. */
  @Requires('subscriptions.manage')
  @Post('subscription-exceptions/:id/revoke')
  revoke(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.ledger.revokeException(actorId, id, body ?? {});
  }

  /** Parents' renewal requests in scope (30 days), newest first. */
  @Requires('subscriptions.view')
  @Get('subscriptions/renewal-requests')
  renewalRequests(@ActorId() actorId: string) {
    return this.ledger.renewalRequests(actorId);
  }
}
