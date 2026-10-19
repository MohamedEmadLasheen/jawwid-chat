import { Module } from '@nestjs/common';
import { CoreIngestService } from './core-ingest.service';
import { CoreWebhookController } from './core-webhook.controller';

/**
 * The Core -> Chat boundary: one signed webhook (POST /integration/core/events)
 * and the processor behind it. Today it applies one event type,
 * `subscription.created` (PD-11 T4 trial confirmation). Unconfigured
 * (CORE_WEBHOOK_SECRETS empty), it answers 503 to everything.
 */
@Module({
  controllers: [CoreWebhookController],
  providers: [CoreIngestService],
})
export class CoreBoundaryModule {}
