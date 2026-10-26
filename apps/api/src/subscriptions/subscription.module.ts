import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { LessonModule } from '../lessons/lesson.module';
import { BillingModule } from '../billing/billing.module';
import { SubscriptionEffects } from './subscription-effects.service';
import { SubscriptionRenewalController } from './subscription-effects.controller';

/**
 * PD-30: what follows a child's subscription state -- the cards and pushes,
 * the lessons put on hold and released, a parent's renewal request. The state
 * itself is the database's (chat.learner_access), the ledger and exceptions
 * are BillingModule's (SubscriptionLedger), and enforcement is the
 * authorization service's (SUBSCRIPTION_LOCK).
 */
@Module({
  imports: [CommunicationModule, LessonModule, BillingModule],
  controllers: [SubscriptionRenewalController],
  providers: [SubscriptionEffects],
  exports: [SubscriptionEffects],
})
export class SubscriptionModule {}
