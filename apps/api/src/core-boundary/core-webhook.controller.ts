import { Controller, Headers, Inject, Logger, Post, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../platform/auth/auth.guard';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { PrismaService } from '../platform/prisma.service';
import { CoreIngestService, CoreRetryLater } from './core-ingest.service';
import { parseEnvelope } from './core-event-envelope';
import { loadCoreWebhookConfig, type CoreWebhookConfig } from './core-webhook.config';
import { verifyDelivery, WebhookRejection } from './core-webhook.verifier';

/**
 * The audit row's entity id for a refused delivery: a constant, because the body
 * was never authenticated and nothing in it may become an identifier.
 */
const UNIDENTIFIED_DELIVERY = '00000000-0000-0000-0000-000000000000';

/**
 * THE CORE BOUNDARY'S FRONT DOOR (ported from claude/admiring-feynman-v3l4xh).
 *
 * `@Public()`: Core holds no user session. It authenticates with the signature,
 * and the ORDER of checks is the security property (contract §1):
 *
 *   size -> headers -> key id -> timestamp -> HMAC over RAW BYTES
 *       -> parse -> envelope -> allowlist -> ledger -> processor
 *
 * Nothing about the body's content is looked at before the signature is
 * verified over the bytes that carried it. The secret, the signatures and the
 * body never reach a log line, an error or a response.
 *
 * Answers: 200 {status: applied | duplicate | not_applicable}; 400 malformed or
 * unknown type; 401 authentication; 422 {error} a disagreement retrying cannot
 * fix (kept in the ledger); 500 retry later; 503 not configured (fail closed).
 */
@Controller('integration/core')
export class CoreWebhookController {
  private readonly log = new Logger(CoreWebhookController.name);
  private readonly config: CoreWebhookConfig | null;

  constructor(
    private readonly ingest: CoreIngestService,
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {
    this.config = loadCoreWebhookConfig();
    if (!this.config) {
      this.log.warn(
        'Core webhook boundary is UNCONFIGURED (no keyid:secret in CORE_WEBHOOK_SECRETS or CORE_WEBHOOK_SECRET). ' +
          'It will refuse every delivery with 503. This is fail-closed, not broken.',
      );
    }
  }

  @Public()
  @Post('events')
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
    @Headers('x-jawwid-key-id') keyId?: string,
    @Headers('x-jawwid-timestamp') timestamp?: string,
    @Headers('x-jawwid-signature') signature?: string,
  ): Promise<void> {
    // Without the raw bytes the signature could only be checked against a
    // re-serialised body, which is no check at all: an empty buffer fails it.
    const rawBody = request.rawBody ?? Buffer.alloc(0);

    const verified = verifyDelivery(this.config, { keyId, timestamp, signature }, rawBody, new Date());
    if (!verified.ok) {
      await this.reject(verified.reason, keyId);
      response.status(verified.reason === WebhookRejection.NOT_CONFIGURED ? 503 : 401).json({ error: verified.reason });
      return;
    }

    const parsed = parseEnvelope(rawBody);
    if (!parsed.ok) {
      response.status(400).json({ error: parsed.reason });
      return;
    }

    try {
      const outcome = await this.ingest.recordAndApply({
        externalEventId: parsed.envelope.eventId,
        eventType: parsed.envelope.eventType,
        payload: parsed.envelope.data,
      });
      if (outcome.status === 'rejected') {
        response.status(422).json({ error: outcome.reason });
        return;
      }
      response.status(200).json({ status: outcome.status });
    } catch (error) {
      // Recorded and left unprocessed with its reason; 500 is "retry with backoff".
      this.log.warn(
        `core delivery ${parsed.envelope.eventType} not applied: ` +
          (error instanceof CoreRetryLater ? error.message : error instanceof Error ? error.name : 'unknown'),
      );
      response.status(500).json({ error: error instanceof CoreRetryLater ? 'retry_later' : 'apply_failed' });
    }
  }

  /**
   * Contract §7: a refused delivery is audited with the reason and the CLAIMED
   * key id (a name, not a secret), never the signature or the body. An audit
   * failure never changes the response.
   */
  private async reject(reason: string, claimedKeyId: string | undefined): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.audit(tx, {
          actorId: null,
          action: 'core_webhook_rejected',
          entity: 'core_event',
          entityId: UNIDENTIFIED_DELIVERY,
          after: { reason, claimedKeyId: claimedKeyId ? claimedKeyId.slice(0, 100) : null },
          reason: 'inbound Core delivery refused at the integration boundary',
        });
      });
    } catch (error) {
      this.log.warn(`core webhook rejection not audited (${reason}): ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }
}
