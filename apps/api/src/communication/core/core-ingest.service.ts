import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';

/**
 * THE CORE BOUNDARY, for class sessions and the attendance they carry.
 *
 * Jawwid Core is authoritative for both -- `docs/architecture/
 * core-integration-contract.md` is marked authoritative and its section 8 says
 * so. Nothing here decides anything about a class; it applies what Core said
 * and turns "Chat now knows this" into a domain event.
 *
 * WHERE THIS SITS. `chat.core_event` is the existing ingestion boundary: an
 * append-only ledger with a unique `(source, external_event_id)` and a
 * `processed_at`, written by `chat.record_core_event` and already carrying the
 * contract's whole duplicate story. This service is the PROCESSOR -- the half
 * that was missing. It drains that ledger the same way OutboxWorker drains the
 * outbox: claim, apply, mark. No second ingestion architecture, no webhook
 * endpoint invented here, and no parallel idempotency scheme.
 *
 * TRANSACTIONALITY. The projection write and the outbox event it justifies are
 * one transaction. A class session cannot exist in Chat without the event that
 * would tell a parent about it, and an event cannot exist describing a session
 * that was never written.
 *
 * SCOPE. Only `class_session.upserted`, `class_session.cancelled` and
 * `attendance.upserted`. Parent, student, teacher, enrolment, subscription and
 * payment events have their own SQL ingest functions and are not this phase's.
 * An event type outside this set is left unprocessed rather than consumed, so
 * whoever implements it later finds it waiting.
 */
/** This endpoint is Jawwid Core's. The ledger's source column says so. */
export const CORE_SOURCE = 'jawwid_core';

@Injectable()
export class CoreIngestService {
  private readonly log = new Logger(CoreIngestService.name);

  /** The event types this processor claims. Everything else is left alone. */
  static readonly HANDLED: ReadonlySet<string> = new Set([
    'class_session.upserted',
    'class_session.cancelled',
    'attendance.upserted',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Record one delivery and apply it, which is what the webhook needs.
   *
   * TWO LAYERS, AND THEY ANSWER DIFFERENT QUESTIONS. The ledger's unique
   * `(source, external_event_id)` says whether this DELIVERY has been seen;
   * `processed_at` with no `error` says whether it was successfully APPLIED.
   * Only the second makes a repeat a duplicate. A delivery that was recorded
   * and then failed -- a crash mid-apply -- is re-applied on the next attempt,
   * because reporting it as a duplicate would tell Core to stop retrying
   * something that never landed.
   */
  async recordAndApply(input: {
    externalEventId: string;
    eventType: string;
    payload: Prisma.JsonObject;
    occurredAt: Date;
  }): Promise<'applied' | 'duplicate' | 'not_applicable'> {
    const recorded = await this.prisma.$queryRaw<{ recorded: boolean }[]>`
      select chat.record_core_event(
        ${input.externalEventId}, ${input.eventType},
        ${input.payload}::jsonb, ${CORE_SOURCE}, ${input.occurredAt}::timestamptz
      ) as recorded`;

    if (recorded[0]?.recorded !== true) {
      const existing = await this.prisma.coreEventRow.findUnique({
        where: {
          source_externalEventId: {
            source: CORE_SOURCE,
            externalEventId: input.externalEventId,
          },
        },
        select: { processedAt: true, error: true },
      });
      // Applied cleanly before: a duplicate, and Core should stop.
      if (existing?.processedAt && !existing.error) return 'duplicate';
      // Recorded but not applied. Fall through and try again.
    }

    return this.applyOne(input.externalEventId);
  }

  /**
   * Apply one recorded delivery by its Core event id.
   *
   * Claims the row the same way `drain` does, so a webhook retry racing the
   * worker sweep cannot both apply it.
   */
  private async applyOne(
    externalEventId: string,
  ): Promise<'applied' | 'not_applicable'> {
    const row = await this.prisma.coreEventRow.findUnique({
      where: { source_externalEventId: { source: CORE_SOURCE, externalEventId } },
    });
    if (!row) return 'not_applicable';

    // An event type this phase has no processor for is left UNPROCESSED in the
    // ledger, on purpose: the contract's `not_applicable` means "accepted,
    // nothing to write yet", and whoever implements that type later finds the
    // delivery waiting rather than marked done by something that ignored it.
    if (!CoreIngestService.HANDLED.has(row.eventType ?? '')) return 'not_applicable';

    const occurredAt = row.occurredAt;
    if (!occurredAt) return 'not_applicable';

    const claimed = await this.prisma.$executeRaw`
      update chat.core_event
         set processed_at = now(), error = null
       where id = ${row.id} and processed_at is null`;
    if (claimed !== 1) return 'not_applicable';

    try {
      const outcome = await this.apply(
        row.eventType ?? '',
        row.payload as Prisma.JsonObject,
        occurredAt,
      );
      return outcome === 'applied' ? 'applied' : 'not_applicable';
    } catch (error) {
      await this.unclaim(row.id, error);
      throw error;
    }
  }

  /**
   * Apply everything unprocessed that this phase understands.
   *
   * Bounded by `batchSize`, ordered by arrival, and safe to run concurrently:
   * each row is claimed with a conditional update before it is touched, the
   * same claim OutboxWorker uses.
   *
   * A failure leaves the row recorded and unprocessed with its error, which is
   * what `chat.sync_health` counts and what the contract's `500` tells Core to
   * retry.
   */
  async drain(batchSize = 50, now = new Date()): Promise<number> {
    const pending = await this.prisma.coreEventRow.findMany({
      where: { processedAt: null, eventType: { in: [...CoreIngestService.HANDLED] } },
      orderBy: { id: 'asc' },
      take: batchSize,
    });

    let applied = 0;
    for (const row of pending) {
      // A row recorded before the ledger carried source time. Its occurred_at
      // is genuinely UNKNOWN, and received_at is not a substitute: ordering it
      // by the moment the HTTP request arrived would let a backfill overwrite
      // newer state, which is the exact failure the ordering rule exists to
      // prevent. It is left unprocessed WITH a reason, so it is visible in
      // chat.sync_health rather than quietly applied with a fabricated time.
      if (!row.occurredAt) {
        await this.unclaim(row.id, new Error('occurred_at unknown: recorded before the webhook carried source time'));
        continue;
      }

      // The claim. A second processor racing this one finds count 0 and skips.
      const claimed = await this.prisma.$executeRaw`
        update chat.core_event
           set processed_at = ${now}
         where id = ${row.id} and processed_at is null`;
      if (claimed !== 1) continue;

      try {
        const outcome = await this.apply(
          row.eventType ?? '',
          row.payload as Prisma.JsonObject,
          row.occurredAt,
        );
        if (outcome === 'applied') applied += 1;
      } catch (error) {
        // Unclaim it and record why. A malformed payload raises
        // `check_violation` from the SQL function and will keep failing --
        // which is correct: it is a boundary disagreement, not a transient
        // fault, and it stays visible rather than being swallowed.
        await this.unclaim(row.id, error);
        this.log.warn(`core event ${row.id} (${row.eventType}) failed to apply`);
      }
    }
    return applied;
  }

  /** Return a row to the queue with the reason it did not apply. */
  private async unclaim(id: bigint, error: unknown): Promise<void> {
    await this.prisma.$executeRaw`
      update chat.core_event
         set processed_at = null,
             error = ${error instanceof Error ? error.message.slice(0, 500) : 'unknown'}
       where id = ${id}`;
  }

  /**
   * One event, applied with its domain event, in one transaction.
   *
   * `occurredAt` is the envelope's own `occurred_at`, carried through the
   * ledger column added for it. The contract's ordering rule (section 5) is
   * last-writer-wins by SOURCE time, and this is that time -- not the moment
   * the HTTP request happened to arrive.
   */
  private async apply(
    eventType: string,
    payload: Prisma.JsonObject,
    occurredAt: Date,
  ): Promise<'applied' | 'not_applicable' | 'stale'> {
    return this.prisma.$transaction(async (tx) => {
      const [result] = await tx.$queryRaw<{ result: IngestResult }[]>`
        select ${Prisma.raw(functionFor(eventType))}(
          ${payload}::jsonb, ${occurredAt}::timestamptz) as result`;

      const outcome = result?.result;
      if (!outcome || outcome.outcome !== 'applied') {
        // `not_applicable` is a normal outcome, not a failure: the class
        // arrives with its student, or on the next backfill. `stale` means a
        // newer write already won. Both are consumed, neither is an event.
        return outcome?.outcome ?? 'not_applicable';
      }

      await this.enqueueFor(tx, eventType, outcome);
      return 'applied';
    });
  }

  /**
   * The domain event a successful projection owes.
   *
   * SCHEDULED vs RESCHEDULED is decided from what the row looked like before,
   * which the SQL function returns: no previous row means this occurrence is
   * new to Chat; a previous row with a different `starts_at` means it moved.
   * A redelivery that changed neither still emits, and the consumer's dedupe
   * keys absorb it -- that is cheaper than trying to be clever here.
   */
  private async enqueueFor(
    tx: Prisma.TransactionClient,
    eventType: string,
    outcome: IngestResult,
  ): Promise<void> {
    if (eventType === 'attendance.upserted') {
      await this.outbox.enqueue(tx, CommEvent.CLASS_ATTENDANCE_RECORDED, {
        attendanceId: outcome.attendance_id!,
        classSessionId: outcome.class_session_id!,
        learnerId: outcome.learner_id!,
        outcome: outcome.attendance!,
        startsAt: outcome.starts_at!,
        previousOutcome: outcome.previous_attendance ?? null,
      });
      return;
    }

    const session = {
      classSessionId: outcome.class_session_id!,
      learnerId: outcome.learner_id!,
      startsAt: outcome.starts_at!,
      status: outcome.status!,
      previousStartsAt: outcome.previous_starts_at ?? null,
      previousStatus: outcome.previous_status ?? null,
    };

    if (eventType === 'class_session.cancelled' || session.status === 'cancelled') {
      await this.outbox.enqueue(tx, CommEvent.CLASS_SESSION_CANCELLED, session);
      return;
    }

    const isNew = session.previousStartsAt === null;
    await this.outbox.enqueue(
      tx,
      isNew ? CommEvent.CLASS_SESSION_SCHEDULED : CommEvent.CLASS_SESSION_RESCHEDULED,
      session,
    );
  }
}

/** What the SQL ingest functions return. Flat, and only what the caller needs. */
interface IngestResult {
  outcome: 'applied' | 'not_applicable' | 'stale';
  class_session_id?: string;
  attendance_id?: string;
  learner_id?: string;
  status?: string;
  starts_at?: string;
  attendance?: string;
  previous_status?: string | null;
  previous_starts_at?: string | null;
  previous_attendance?: string | null;
}

/**
 * The SQL function behind each event type.
 *
 * An explicit map rather than string interpolation of the event type: the name
 * reaches `Prisma.raw`, and the only safe way to do that is for every possible
 * value to be written here by hand.
 */
function functionFor(eventType: string): string {
  switch (eventType) {
    case 'class_session.upserted':
      return 'chat.ingest_core_class_session';
    case 'class_session.cancelled':
      return 'chat.cancel_core_class_session';
    case 'attendance.upserted':
      return 'chat.ingest_core_attendance';
    default:
      throw new Error(`unhandled core event type: ${eventType}`);
  }
}
