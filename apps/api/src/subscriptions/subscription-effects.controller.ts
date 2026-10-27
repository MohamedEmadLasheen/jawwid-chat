import { Controller, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { SubscriptionEffects } from './subscription-effects.service';
import { NotForStaff } from '../platform/permissions/route-access';

/** PD-30: what a parent does from a locked banner when there is nothing to pay yet. */
@Controller()
@UseFilters(CommErrorFilter)
export class SubscriptionRenewalController {
  constructor(private readonly effects: SubscriptionEffects) {}

  /** A parent of the child's family; at most once per child per academy day (409 after). */
  @NotForStaff()
  @Post('me/subscriptions/:learnerId/renewal-request')
  request(@ActorId() actorId: string, @Param('learnerId') learnerId: string) {
    return this.effects.requestRenewal(actorId, learnerId);
  }
}
