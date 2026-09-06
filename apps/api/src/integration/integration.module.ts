import { Module } from '@nestjs/common';
import { PlatformModule } from '@platform/platform.module';
import { CoreWebhookController } from './core/core-webhook.controller';
import { CoreIngestionService } from './core/core-ingestion.service';

/** The only place Jawwid Core traffic enters the system (PRD v0.1 §12.4). */
@Module({
  imports: [PlatformModule],
  controllers: [CoreWebhookController],
  providers: [CoreIngestionService],
  exports: [CoreIngestionService],
})
export class IntegrationModule {}
