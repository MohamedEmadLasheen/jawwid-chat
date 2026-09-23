import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';

export interface PurgeResult {
  notificationsDeleted: number;
  deliveriesDeleted: number;
  ran: boolean;
}

/**
 * RETENTION, as an operation rather than a design.
 *
 * chat.purge_notification_history() existed and was tested; nothing called it,
 * which means notifications grew forever and the retention policy was a
 * comment. This gives it a runtime -- the worker's existing sweep loop, not a
 * second scheduler. The repository already decided (worker.ts) that polling the
 * database beats introducing a queue for work the database is already the
 * source of truth for, and adding cron here would be a second answer to a
 * question already answered.
 *
 * THREE PROPERTIES THIS MUST HAVE, and each is a deliberate choice below:
 *
 * IDEMPOTENT. Running it twice deletes nothing the second time -- it selects by
 * age and read state, not by a cursor, so there is no position to lose.
 *
 * BOUNDED. It runs at most once per interval and deletes in bounded batches.
 * An unbounded DELETE over a million-row table takes a lock long enough to
 * stall every notification insert behind it, which would turn a housekeeping
 * job into an outage that stops parents being told things.
 *
 * SAFE. It never touches an unread notification at any age, and it orphans
 * delivery rows rather than cascading them, so the operational record support
 * reads back outlives the notification it describes.
 */
@Injectable()
export class RetentionService {
  private readonly log = new Logger(RetentionService.name);

  /** Epoch ms of the last run. In-process on purpose -- see runDue(). */
  private lastRunAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run if enough time has passed since the last run in THIS process.
   *
   * Deliberately not coordinated across workers. Two workers purging at once is
   * harmless: the operation is idempotent, and the second finds nothing left to
   * delete. Coordinating it would mean a lock table or an advisory lock, which
   * is machinery bought to prevent a non-problem -- and a lock that is not
   * released after a crash would stop retention running at all, which is the
   * failure that actually costs something.
   */
  async runDue(now = new Date(), intervalMs = 6 * 60 * 60 * 1000): Promise<PurgeResult> {
    if (now.getTime() - this.lastRunAt < intervalMs) {
      return { notificationsDeleted: 0, deliveriesDeleted: 0, ran: false };
    }
    this.lastRunAt = now.getTime();
    return this.purge(now);
  }

  /**
   * One bounded pass.
   *
   * The SQL function does the selection -- it owns the policy, reads the
   * retention windows from chat.config, and is the thing the migration tests
   * assert on. This adds only the runtime concerns: batching, observability and
   * never letting a failure take the worker down with it.
   */
  async purge(now = new Date(), batchSize = 5000, maxPasses = 20): Promise<PurgeResult> {
    const started = Date.now();
    try {
      let notificationsDeleted = 0;
      let deliveriesDeleted = 0;

      // Drain a backlog over several bounded passes rather than one long lock,
      // and cap the passes: a sweep that will not end is worse than one that
      // leaves work for the next run, because the next run is six hours away
      // and an unbounded loop is right now.
      for (let pass = 0; pass < maxPasses; pass += 1) {
        const rows = await this.prisma.$queryRaw<
          Array<{
            notifications_deleted: bigint;
            deliveries_deleted: bigint;
            more_remaining: boolean;
          }>
        >`select * from chat.purge_notification_history(${now}::timestamptz, ${batchSize}::integer)`;

        notificationsDeleted += Number(rows[0]?.notifications_deleted ?? 0);
        deliveriesDeleted += Number(rows[0]?.deliveries_deleted ?? 0);
        if (!rows[0]?.more_remaining) break;
      }

      const result = { notificationsDeleted, deliveriesDeleted, ran: true };

      // Observable, and quiet when there is nothing to say. A retention sweep
      // that logs every idle pass is a sweep whose real work nobody notices.
      if (result.notificationsDeleted > 0 || result.deliveriesDeleted > 0) {
        this.log.log(
          `retention: purged ${result.notificationsDeleted} notification(s) and ` +
            `${result.deliveriesDeleted} delivery record(s) in ${Date.now() - started}ms`,
        );
      }
      return result;
    } catch (error) {
      // Never rethrow into the worker loop. Retention failing is a housekeeping
      // problem; notifications not being delivered is a product failure, and
      // the second must not be caused by the first.
      // Name the error type as well as its message: a driver error can carry an
      // empty message, and "retention sweep failed: " with nothing after it is
      // an alert nobody can act on.
      const detail =
        error instanceof Error ? `${error.name}: ${error.message || 'no message'}` : 'unknown';
      this.log.error(`retention sweep failed: ${detail}`);
      return { notificationsDeleted: 0, deliveriesDeleted: 0, ran: true };
    }
  }
}
