import {
  Body, Controller, Headers, HttpCode, HttpException, HttpStatus, Logger, Post, Req,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@platform/prisma.service';
import { CoreEventAccepted, CoreRejectionReason } from './contracts';
import { CoreIngestionService, MalformedCoreEvent } from './core-ingestion.service';
import { parseKeyOrganizations, parseSecrets, verifySignature } from './signature';

interface RawBodyRequest {
  readonly rawBody?: Buffer;
}

/**
 * The single ingress from Jawwid Core. PRD v0.1 §12.4: a dedicated integration
 * boundary owns all Core traffic, and Chat application code never touches Core's
 * database.
 *
 * Status codes are part of the contract, because they drive Core's retry:
 *
 *   200  applied, duplicate, or not-applicable  — stop, this delivery is done
 *   400  malformed envelope / unknown event     — stop, retrying cannot help
 *   401  signature failed                       — stop, fix credentials
 *   500  Chat failed to apply it                — retry with backoff
 */
@Controller('integration/core')
export class CoreWebhookController {
  private readonly log = new Logger(CoreWebhookController.name);
  private readonly secrets = parseSecrets(process.env.CORE_WEBHOOK_SECRETS);
  private readonly toleranceSeconds = Number(process.env.CORE_WEBHOOK_TOLERANCE_SECONDS ?? 300);
  /** Signing key -> organization. The payload never gets a say in this. */
  private readonly keyOrganizations = parseKeyOrganizations(process.env.CORE_WEBHOOK_ORGANIZATIONS);

  constructor(
    private readonly ingestion: CoreIngestionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('events')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest,
    @Body() body: unknown,
    @Headers('x-jawwid-key-id') keyId?: string,
    @Headers('x-jawwid-timestamp') timestamp?: string,
    @Headers('x-jawwid-signature') signature?: string,
  ): Promise<CoreEventAccepted> {
    // Refusing to start rather than trusting an empty secret set: an
    // unconfigured deployment must not accept unauthenticated writes.
    if (this.secrets.size === 0) {
      throw new HttpException(
        'integration boundary is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }

    // The signature covers the bytes as sent. Re-serialising the parsed object
    // would change key order and break every signature.
    const rawBody = request.rawBody?.toString('utf8') ?? '';
    const check = verifySignature(
      { keyId, timestamp, signature },
      rawBody,
      this.secrets,
      Math.floor(Date.now() / 1000),
      this.toleranceSeconds,
    );

    if (!check.ok) {
      await this.auditRejection(check.reason ?? 'bad_signature', keyId);
      // The reason is returned so Core can distinguish "rotate the key" from
      // "your clock is wrong", and nothing about the secret is disclosed.
      throw new HttpException(
        { error: 'unauthorized', reason: check.reason }, HttpStatus.UNAUTHORIZED);
    }

    let envelope;
    try {
      envelope = CoreIngestionService.parseEnvelope(body);
    } catch (error) {
      const reason = error instanceof MalformedCoreEvent ? error.message : 'malformed';
      await this.auditRejection('malformed_envelope', keyId, reason);
      throw new HttpException({ error: 'bad_request', reason }, HttpStatus.BAD_REQUEST);
    }

    try {
      // The tenant is derived from the verified signing key, never from the
      // body. A caller holding organization A's key cannot write into B by
      // saying so in the payload.
      return await this.ingestion.ingest(envelope, this.keyOrganizations.get(keyId as string));
    } catch (error) {
      if (error instanceof MalformedCoreEvent) {
        await this.auditRejection('malformed_envelope', keyId, error.message);
        throw new HttpException(
          { error: 'bad_request', reason: error.message }, HttpStatus.BAD_REQUEST);
      }
      this.log.error(`failed to apply Core event ${envelope.event_id}`, error as Error);
      // 500 on purpose: the event is recorded and unprocessed, and Core should
      // retry it.
      throw new HttpException(
        { error: 'apply_failed', event_id: envelope.event_id },
        HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * PRD §11.1 requires an audit trail for denied actions. A rejected delivery is
   * written with no actor, because an unauthenticated caller has no identity —
   * recording the key id it claimed is the useful part.
   */
  private async auditRejection(
    reason: CoreRejectionReason,
    keyId: string | undefined,
    detail?: string,
  ): Promise<void> {
    const after = JSON.stringify({ reason, key_id: keyId ?? null, detail: detail ?? null });
    await this.prisma
      .$executeRaw(
        Prisma.sql`select chat.write_audit(
          null, 'core_webhook_rejected', 'core_event', null,
          ${`Jawwid Core delivery rejected: ${reason}`}, null, ${after}::jsonb)`,
      )
      .catch((error: unknown) => {
        // An audit failure must be loud, but must not convert a 401 into a 500.
        this.log.error('failed to audit a rejected Core delivery', error as Error);
      });
  }
}
