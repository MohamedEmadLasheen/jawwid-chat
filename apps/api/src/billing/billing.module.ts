import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import { OBJECT_STORAGE } from '../platform/tokens';
import { BillingController } from './billing.controller';
import { BillingMediaController } from './billing-media.controller';
import { BillingService } from './billing.service';
import { CheckoutService } from './checkout.service';
import { ParentPaymentsService } from './parent-payments.service';
import { PayLinkController } from './pay-link.controller';
import { PaymentLedger } from './payment-ledger.service';
import { PaymentReminders } from './payment-reminders.service';
import { PaymentsController } from './payments.controller';
import { PaymentsReadService } from './payments-read.service';
import { PaymentsService } from './payments.service';
import { STRIPE_GATEWAY, StripeSdkGateway } from './stripe.gateway';
import { StripeWebhookController } from './stripe-webhook.controller';
import { SubscriptionLedger } from './subscription-ledger.service';
import { SubscriptionsController } from './subscriptions.controller';

/**
 * Instalment Payments (PD-12 S3), each family's money (PD-17), and how money
 * arrives (PD-27): payment links, Stripe Checkout and its webhook, bank-transfer
 * receipts, cash, refunds, invoices, reminders. Chat's own records; nothing is
 * read from Jawwid Core. STRIPE_GATEWAY is the one seam to Stripe (tests
 * replace it); OBJECT_STORAGE holds the receipt files.
 */
@Module({
  imports: [CommunicationModule],
  controllers: [BillingController, PaymentsController, PayLinkController, StripeWebhookController, BillingMediaController, SubscriptionsController],
  providers: [
    BillingService,
    PaymentLedger,
    PaymentsReadService,
    PaymentReminders,
    PaymentsService,
    ParentPaymentsService,
    CheckoutService,
    // PD-30: a child's lesson ledger and its exceptions.
    SubscriptionLedger,
    { provide: STRIPE_GATEWAY, useFactory: () => new StripeSdkGateway() },
    { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage },
  ],
  exports: [BillingService, PaymentLedger, PaymentsService, PaymentReminders, SubscriptionLedger],
})
export class BillingModule {}
