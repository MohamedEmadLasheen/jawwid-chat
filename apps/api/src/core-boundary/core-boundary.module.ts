import { Module } from '@nestjs/common';
import { CoreIngestService } from './core-ingest.service';
import { CoreWebhookController } from './core-webhook.controller';

/**
 * The Core -> Chat boundary: one signed webhook (POST /integration/core/events)
 * and the processor behind it. It accepts one event type,
 * `subscription.created`, which it records and which changes nothing: trial
 * outcomes are Chat's own (trial journey, 2026-10-20). Unconfigured
 * (CORE_WEBHOOK_SECRETS empty), it answers 503 to everything.
 */
@Module({
  controllers: [CoreWebhookController],
  providers: [CoreIngestService],
})
export class CoreBoundaryModule {}
