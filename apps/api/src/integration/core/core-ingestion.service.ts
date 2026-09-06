import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@platform/prisma.service';

/** Prisma client or an open transaction — every helper accepts either. */
type Db = Pick<PrismaService, '$queryRaw' | '$executeRaw'>;
import {
  CoreEventAccepted,
  CoreEventEnvelope,
  CoreEventType,
  isCoreEventType,
} from './contracts';

/** Thrown for a payload Chat will never be able to apply. Never retried. */
export class MalformedCoreEvent extends Error {}

/**
 * Applies Jawwid Core events to Chat-owned tables.
 *
 * Every apply is one call to one SQL function, and each of those is idempotent
 * on the external id and ordered by `occurred_at`. The service therefore holds
 * no ordering state of its own: two deliveries racing each other converge on the
 * same row, and a late older event is dropped by the database rather than by a
 * check here that a second process would not share.
 */
@Injectable()
export class CoreIngestionService {
  private readonly log = new Logger(CoreIngestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `organizationSlug` binds the delivery to one tenant for the whole
   * transaction. It comes from the signing key, never from the payload: a
   * webhook body must not be able to name the organization it lands in, or the
   * boundary becomes a way to write into any tenant with one valid signature.
   *
   * Left undefined, chat.current_organization_id() falls back to the only
   * organization — correct while there is exactly one, and it stops resolving
   * the moment there is a second.
   */
  async ingest(envelope: CoreEventEnvelope, organizationSlug?: string): Promise<CoreEventAccepted> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.bindOrganization(tx, organizationSlug);
        return await this.ingestWithin(tx, envelope);
      });
    } catch (error) {
      if (error instanceof MalformedCoreEvent) throw error;
      // The transaction rolled back, so the delivery left no trace at all.
      // Record the failure on its own connection: an event that arrived and
      // could not be applied has to be visible in sync_health, and has to stay
      // unprocessed so the next attempt re-applies it rather than dismissing it
      // as a duplicate.
      await this.recordFailure(envelope, organizationSlug, error).catch(() => undefined);
      throw error;
    }
  }

  private async bindOrganization(db: Db, slug: string | undefined): Promise<void> {
    if (!slug) return;
    const rows = await db.$queryRaw<Array<{ id: string | null }>>(
      Prisma.sql`select id::text from chat.organization where slug = ${slug} and is_active`,
    );
    const id = rows[0]?.id;
    if (!id) {
      throw new MalformedCoreEvent(`no active organization for signing key (${slug})`);
    }
    // Transaction-local: it cannot leak to the next request on a pooled connection.
    await db.$executeRaw(Prisma.sql`select set_config('chat.organization_id', ${id}, true)`);
  }

  private async recordFailure(
    envelope: CoreEventEnvelope,
    organizationSlug: string | undefined,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.$transaction(async (tx) => {
      await this.bindOrganization(tx, organizationSlug);
      await this.recordEvent(tx, envelope);
      await this.markProcessed(tx, envelope.event_id, message);
      await this.logEvent(tx, 'core_event_failed', envelope.event_id, envelope.event_type, null);
      await this.recordSyncResult(tx, 'failed', message);
    });
  }

  private async ingestWithin(db: Db, envelope: CoreEventEnvelope): Promise<CoreEventAccepted> {
    const { event_id: eventId, event_type: eventType, occurred_at: occurredAt } = envelope;

    const isNew = await this.recordEvent(db, envelope);

    if (!isNew) {
      const processed = await this.isProcessed(db, eventId);
      if (processed) {
        // A genuine duplicate. Acknowledge so Core stops retrying.
        await this.logEvent(db, 'core_event_duplicate', eventId, eventType, null);
        return { status: 'duplicate', event_id: eventId, resource_id: null };
      }
      // Recorded but never applied: a previous attempt failed part-way. This is
      // a retry, not a duplicate, so it is applied now.
      this.log.warn(`re-applying previously failed Core event ${eventId}`);
    }

    const resourceId = await this.apply(db, eventType, envelope.data, occurredAt);
    await this.markProcessed(db, eventId, null);
    await this.logEvent(db, 'core_event_applied', eventId, eventType, resourceId);
    // PRD §12.4: "Sync health (lag, errors, unmatched records) is visible in
    // the admin panel and alerts the technical admin."
    await this.recordSyncResult(db, 'ok', null);
    return {
      status: resourceId === null ? 'not_applicable' : 'applied',
      event_id: eventId,
      resource_id: resourceId,
    };
  }

  private async apply(
    db: Db,
    eventType: CoreEventType,
    data: Record<string, unknown>,
    occurredAt: string,
  ): Promise<string | null> {
    const payload = JSON.stringify(data);

    switch (eventType) {
      case 'parent.upserted':
        return this.callUuid(db, 'ingest_core_parent', payload, occurredAt);
      case 'student.upserted':
        return this.callUuid(db, 'ingest_core_learner', payload, occurredAt);
      case 'teacher.upserted':
        return this.callUuid(db, 'ingest_core_teacher', payload, occurredAt);
      case 'enrollment.upserted':
        return this.callUuid(db, 'ingest_core_enrollment', payload, occurredAt);
      case 'class_session.upserted':
        return this.callUuid(db, 'ingest_core_class_session', payload, occurredAt);
      case 'subscription.upserted':
        return this.callUuid(db, 'ingest_core_subscription', payload, occurredAt);
      case 'payment.upserted':
        return this.callUuid(db, 'ingest_core_payment', payload, occurredAt);

      case 'student.deactivated':
        return this.deactivate(db, 'student', data.core_child_id, occurredAt);
      case 'teacher.deactivated':
        return this.deactivate(db, 'teacher', data.core_teacher_id, occurredAt);
      case 'enrollment.ended':
        return this.deactivate(db, 'enrollment', data.core_enrollment_id, occurredAt);
      case 'class_session.cancelled':
        return this.deactivate(db, 'class_session', data.core_class_session_id, occurredAt);
    }
  }

  private async callUuid(db: Db, fn: string, payload: string, occurredAt: string): Promise<string | null> {
    const rows = await db.$queryRaw<Array<{ result: string | null }>>(
      Prisma.sql`select ${Prisma.raw(`chat.${fn}`)}(${payload}::jsonb, ${occurredAt}::timestamptz) as result`,
    );
    return rows[0]?.result ?? null;
  }

  private async deactivate(
    db: Db,
    kind: string,
    coreId: unknown,
    occurredAt: string,
  ): Promise<string | null> {
    if (typeof coreId !== 'string' || coreId.length === 0) {
      throw new MalformedCoreEvent(`${kind} deactivation requires the Core id`);
    }
    const rows = await db.$queryRaw<Array<{ result: boolean }>>(
      Prisma.sql`select chat.deactivate_core_entity(${kind}, ${coreId}::uuid, ${occurredAt}::timestamptz) as result`,
    );
    // A deactivation that matched nothing is not a failure: Core may be telling
    // Chat about an entity it never mirrored.
    return rows[0]?.result === true ? coreId : null;
  }

  private async recordEvent(db: Db, envelope: CoreEventEnvelope): Promise<boolean> {
    const rows = await db.$queryRaw<Array<{ recorded: boolean }>>(
      Prisma.sql`select chat.record_core_event(
        ${envelope.event_id},
        ${envelope.event_type},
        ${JSON.stringify(envelope)}::jsonb
      ) as recorded`,
    );
    return rows[0]?.recorded === true;
  }

  private async isProcessed(db: Db, eventId: string): Promise<boolean> {
    const rows = await db.$queryRaw<Array<{ processed: boolean }>>(
      Prisma.sql`select (processed_at is not null and error is null) as processed
                 from chat.core_event
                 where source = 'jawwid_core' and external_event_id = ${eventId}`,
    );
    return rows[0]?.processed === true;
  }

  private async markProcessed(db: Db, eventId: string, error: string | null): Promise<void> {
    await db.$executeRaw(
      Prisma.sql`select chat.mark_core_event_processed(${eventId}, ${error})`,
    );
  }

  private async logEvent(
    db: Db,
    type: string,
    eventId: string,
    eventType: string,
    resourceId: string | null,
  ): Promise<void> {
    await db.$executeRaw(
      Prisma.sql`select chat.log_event(
        ${type}, null, null, 'system', null,
        ${JSON.stringify({ event_id: eventId, event_type: eventType, resource_id: resourceId })}::jsonb
      )`,
    );
  }

  private async recordSyncResult(db: Db, status: string, error: string | null): Promise<void> {
    await db.$executeRaw(
      Prisma.sql`select chat.record_sync_result('jawwid_core', ${status}, ${error}, null)`,
    );
  }

  /** Envelope validation. Anything that fails here can never be applied. */
  static parseEnvelope(body: unknown): CoreEventEnvelope {
    if (typeof body !== 'object' || body === null) {
      throw new MalformedCoreEvent('body must be a JSON object');
    }
    const raw = body as Record<string, unknown>;

    if (typeof raw.event_id !== 'string' || raw.event_id.trim().length === 0) {
      throw new MalformedCoreEvent('event_id is required and is the idempotency key');
    }
    if (!isCoreEventType(raw.event_type)) {
      throw new MalformedCoreEvent(`unknown event_type ${String(raw.event_type)}`);
    }
    if (typeof raw.occurred_at !== 'string' || Number.isNaN(Date.parse(raw.occurred_at))) {
      throw new MalformedCoreEvent('occurred_at must be an ISO-8601 timestamp');
    }
    if (typeof raw.data !== 'object' || raw.data === null || Array.isArray(raw.data)) {
      throw new MalformedCoreEvent('data must be a JSON object');
    }

    return {
      event_id: raw.event_id,
      event_type: raw.event_type,
      occurred_at: new Date(raw.occurred_at).toISOString(),
      data: raw.data as Record<string, unknown>,
    };
  }
}
