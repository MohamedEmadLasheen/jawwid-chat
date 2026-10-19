import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CORE_INVOICE_SOURCE, coreInvoiceSourceFromEnv } from './core-invoice-source';

/**
 * PD-12 S3: Instalment Payments. Core's invoices come through
 * CORE_INVOICE_SOURCE, which is "not connected" unless CORE_INVOICES_ENABLED
 * is true and CORE_BASE_URL / CORE_API_KEY are set.
 */
@Module({
  imports: [CommunicationModule],
  controllers: [BillingController],
  providers: [BillingService, { provide: CORE_INVOICE_SOURCE, useFactory: () => coreInvoiceSourceFromEnv() }],
})
export class BillingModule {}
