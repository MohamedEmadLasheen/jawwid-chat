import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUDIT_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import { PrismaService } from '../../platform/prisma.service';
import { CoreIngestService } from './core-ingest.service';
import { parseEnvelope } from './core-event-envelope';
import { loadCoreWebhookConfig, CoreWebhookConfig } from './core-webhook.config';
import { verifyDelivery, WebhookRejection } from './core-webhook.verifier';

/**
 * THE CORE BOUNDARY'S FRONT DOOR.
 *
 * One route, one authentication path, and nothing else. Everything behind it --
 * the ledger, the processor, the class-session and attendance projections, the
 * outbox, the notification platform -- already existed and is unchanged; this
 * is the wire that was missing.
 *
 * THE ORDER OF OPERATIONS IS THE SECURITY PROPERTY, and it is the contract's:
 *
 *   size → headers → key id → timestamp → HMAC over RAW BYTES
 *       → parse → envelope → allowlist → ledger → processor
 *
 * Nothing about the body's CONTENT is looked at until the signature has been
 * verified over the bytes that carried it. The parsed envelope is produced from
 * those same bytes rather than from whatever a framework body parser left on
 * the request, so the value that was verified and the value that is used are
 * the same value.
 *
 * WHAT NEVER LEAVES THIS FILE: the secret, the expected signature, the received
 * signature, and the body. Not in a log line, not in an error, not in a
 * response. A 401 says `{"error":"invalid_signature"}` and nothing more --
 * enough for an operator to act on, useless to someone probing.
 */
/**
 * The audit row's entity id for a refused delivery.
 *
 * A constant rather than the claimed event id: the body was never
 * authenticated, so anything in it is an attacker's choice of string and has
 * no business being an identifier in the audit log.
 */
const UNIDENTIFIED_DELIVERY = '00000000-0000-0000-0000-000000000000';

@Controller('integration/core')
export class CoreWebhookController {
  private readonly log = new Logger(CoreWebhookController.name);

  /**
   * Resolved once, at construction. The secret is read from the process
   * environment and held in memory; it is never stored, never logged, and
   * never written to the database.
   */
  private readonly config: CoreWebhookConfig | null;

  constructor(
    private readonly ingest: CoreIngestService,
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {
    this.config = loadCoreWebhookConfig();
    if (!this.config) {
      // Loud, because a deployment that believes it is integrated and is not
      // will otherwise discover it when a parent is not told something.
      this.log.warn(
        'Core webhook boundary is UNCONFIGURED (CORE_WEBHOOK_SECRETS is empty). ' +
          'It will refuse every delivery with 503. This is fail-closed, not broken.',
      );
    }
  }

  @Post('events')
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
    @Headers('x-jawwid-key-id') keyId?: string,
    @Headers('x-jawwid-timestamp') timestamp?: string,
    @Headers('x-jawwid-signature') signature?: string,
  ): Promise<void> {
    // `rawBody` is populated because the application is created with
    // `rawBody: true`. Its absence would mean the signature could only be
    // checked against a re-serialised body, which is not a check at all -- so
    // it is refused rather than worked around.
    const rawBody = request.rawBody ?? Buffer.alloc(0);

    const verified = verifyDelivery(this.config, { keyId, timestamp, signature }, rawBody, new Date());
    if (!verified.ok) {
      await this.reject(verified.reason, keyId);
      // 503 tells Core to retry with backoff -- the boundary may simply not be
      // configured yet. Everything else is terminal: retrying a bad signature
      // or a stale clock cannot succeed.
      const status = verified.reason === WebhookRejection.NOT_CONFIGURED ? 503 : 401;
      response.status(status).json({ error: verified.reason });
      return;
    }

    const parsed = parseEnvelope(rawBody);
    if (!parsed.ok) {
      // Malformed envelope or an event type this boundary does not accept.
      // Terminal: retrying cannot help, and silently accepting a type nobody
      // drains would look like integration and behave like a leak.
      response.status(400).json({ error: parsed.reason });
      return;
    }

    try {
      const outcome = await this.ingest.recordAndApply({
        externalEventId: parsed.envelope.eventId,
        eventType: parsed.envelope.eventType,
        payload: parsed.envelope.data as never,
        // THE SOURCE TIME, carried intact from the envelope to the ledger to
        // the projection's core_synced_at. A backfill is ordered by when it
        // HAPPENED, not by when it arrived.
        occurredAt: parsed.envelope.occurredAt,
      });
      response.status(200).json({ status: outcome });
    } catch (error) {
      // The delivery is recorded and left unprocessed with its reason;
      // chat.sync_health counts it. 500 is the contract's "retry with backoff",
      // and it is the honest answer: the request was valid and Chat failed.
      this.log.warn(
        `core delivery ${parsed.envelope.eventType} failed to apply: ` +
          `${error instanceof Error ? error.name : 'unknown'}`,
      );
      response.status(500).json({ error: 'apply_failed' });
    }
  }

  /**
   * The audit trail for a refused delivery.
   *
   * Contract section 7: `chat.audit_log`, action `core_webhook_rejected`, with
   * the reason and the CLAIMED key id. The actor is null -- an unauthenticated
   * caller has no identity, and inventing one would put a lie in the audit log.
   *
   * The claimed key id is recorded because an operator needs to know which key
   * a sender THINKS it is using during a rotation. It is a name, not a secret.
   * The signature and the body are not recorded at all.
   *
   * An audit failure never changes the response: it is logged and swallowed,
   * because turning a 401 into a 500 would tell Core to retry an attack.
   */
  private async reject(reason: string, claimedKeyId: string | undefined): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.audit(tx, {
          actorId: null,
          action: 'core_webhook_rejected',
          entity: 'core_event',
          // No entity to name: the delivery was refused before its envelope
          // was parsed, so there is no event id that can be trusted.
          entityId: UNIDENTIFIED_DELIVERY,
          after: { reason, claimedKeyId: claimedKeyId ?? null },
          reason: 'inbound Core delivery refused at the integration boundary',
        });
      });
    } catch (error) {
      this.log.warn(
        `core webhook rejection not audited (${reason}): ` +
          `${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }
}
