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
          row.receivedAt,
        );
        if (outcome === 'applied') applied += 1;
      } catch (error) {
        // Unclaim it and record why. A malformed payload raises
        // `check_violation` from the SQL function and will keep failing --
        // which is correct: it is a boundary disagreement, not a transient
        // fault, and it stays visible rather than being swallowed.
        await this.prisma.$executeRaw`
          update chat.core_event
             set processed_at = null,
                 error = ${error instanceof Error ? error.message.slice(0, 500) : 'unknown'}
           where id = ${row.id}`;
        this.log.warn(`core event ${row.id} (${row.eventType}) failed to apply`);
      }
    }
    return applied;
  }

  /**
   * One event, applied with its domain event, in one transaction.
   *
   * `occurredAt` is the ledger's `received_at`. The contract's ordering rule
   * (section 5) is last-writer-wins by SOURCE time, and this is the closest
   * thing the existing ledger records; an envelope-level `occurred_at` would be
   * strictly better and is noted as a limitation rather than invented here.
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
