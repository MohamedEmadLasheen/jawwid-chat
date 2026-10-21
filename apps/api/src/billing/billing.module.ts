import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

/**
 * Instalment Payments (PD-12 S3) and each family's money (PD-17): Chat's own
 * records in chat.family_instalment and chat.family_billing. Nothing is read
 * from Jawwid Core.
 */
@Module({
  imports: [CommunicationModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
