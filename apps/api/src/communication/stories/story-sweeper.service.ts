import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { OBJECT_STORAGE } from '../../platform/tokens';
import type { ObjectStorage } from '../attachments/object-storage';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { StoryState } from '../contracts/vocab';

export interface SweepResult {
  /** Stories moved from `published` to `expired`. */
  expired: number;
  /** Stories whose media bytes were removed from object storage. */
  purged: number;
}

/**
 * Retires stories past their expiry and purges media past its retention window.
 *
 * ## What this is NOT responsible for
 *
 * ACCESS. A story stops being readable at `expires_at`, enforced in
 * `StoryService`'s WHERE clauses and in the `story_visible_to_audience` RLS
 * policy. This sweep flips a state column and deletes bytes; if it never ran
 * again, not one story would be readable a millisecond past its expiry.
 *
 * That separation is the whole design, and it is the fix for the specific defect
 * the pre-merge audit found in the abandoned Phase 5 lineage: there, the read
 * policy gated on `state = 'published'` alone, so expiry was only as timely as
 * the sweep and a wedged sweep left stories readable indefinitely.
 *
 * ## Why it does not live in the call sweeper
 *
 * The Phase 5 lineage put `expireDue()` inside `call-sweeper.ts`. On this branch
 * the calling workstreams are closed and immutable, and a story concern has no
 * business reaching into them: a change to story retention must not be able to
 * break a missed-call transition. This is its own service with its own failure
 * domain, invoked from the same worker loop.
 *
 * ## Idempotence
 *
 * Both halves are conditional updates keyed on the state they are changing, so
 * concurrent sweeps converge rather than fight, and running the sweep twice is
 * running it once. Media deletion is idempotent at the storage layer too, so a
 * crash between the delete and the stamp is recovered by the next pass.
 */
@Injectable()
export class StorySweeper {
  private readonly log = new Logger(StorySweeper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly outbox: OutboxService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async sweep(now: Date = new Date()): Promise<SweepResult> {
    const expired = await this.expireDue(now);
    const purged = await this.purgeDueMedia(now);
    if (expired || purged) {
      this.log.log(`story sweep: ${expired} expired, ${purged} media purged`);
    }
    return { expired, purged };
  }

  /**
   * Move published stories past their expiry to `expired`.
   *
   * Done row by row rather than as one `updateMany` because each retirement
   * enqueues an outbox event, and an event that is not written in the same
   * transaction as the state change is an event that can go missing. The batch is
   * bounded so one pass cannot hold a long transaction open.
   */
  async expireDue(now: Date = new Date(), batchSize = 200): Promise<number> {
    const due = await this.prisma.story.findMany({
      where: { state: StoryState.PUBLISHED, expiresAt: { not: null, lte: now } },
      select: { id: true },
      take: batchSize,
    });

    let count = 0;
    for (const { id } of due) {
      const done = await this.prisma.$transaction(async (tx) => {
        // Conditional on the state we believe it is in, so a concurrent sweep
        // (or an operator deleting it in the same instant) wins cleanly and this
        // pass simply does nothing.
        const changed = await tx.story.updateMany({
          where: { id, state: StoryState.PUBLISHED },
          data: { state: StoryState.EXPIRED },
        });
        if (changed.count === 0) return false;

        await this.outbox.enqueue(tx, CommEvent.STORY_RETIRED, {
          storyId: id,
          reason: 'expired',
          at: now.toISOString(),
        });
        return true;
      });
      if (done) count += 1;
    }
    return count;
  }

  /**
   * Delete the bytes of stories whose retention window has closed.
   *
   * The window runs from the moment ACCESS ended -- `deleted_at` for a story an
   * operator removed, `expires_at` otherwise -- so a deleted story and an expired
   * one are treated identically, and neither has its content destroyed in the
   * same breath as being hidden.
   *
   * The storage delete happens BEFORE the stamp. If the process dies in between,
   * the row still says the media is present and the next pass deletes an already
   * absent object, which succeeds. Stamping first would be the unrecoverable
   * order: the row would claim the bytes were gone while they sat in the bucket
   * with nothing left pointing at them.
   */
  async purgeDueMedia(now: Date = new Date(), batchSize = 200): Promise<number> {
    const retentionHours = Number(await this.config.get('story.media_retention_hours'));
    const cutoff = new Date(now.getTime() - retentionHours * 3_600_000);

    const due = await this.prisma.story.findMany({
      where: {
        mediaObjectKey: { not: null },
        mediaPurgedAt: null,
        OR: [
          { deletedAt: { not: null, lte: cutoff } },
          { state: StoryState.EXPIRED, expiresAt: { not: null, lte: cutoff } },
          // A story whose expiry passed long enough ago that retention has also
          // closed, even if expireDue has not reached it yet. Without this a
          // stalled expiry pass would also stall retention.
          { state: StoryState.PUBLISHED, expiresAt: { not: null, lte: cutoff } },
        ],
      },
      select: { id: true, mediaObjectKey: true },
      take: batchSize,
    });

    let count = 0;
    for (const story of due) {
      if (!story.mediaObjectKey) continue;
      try {
        await this.storage.delete(story.mediaObjectKey);
      } catch (err) {
        // A storage failure must not abort the batch or lose the row: it stays
        // unpurged and the next pass retries it.
        this.log.warn(
          `story ${story.id}: media purge failed, will retry: ` +
            `${err instanceof Error ? err.message : 'unknown error'}`,
        );
        continue;
      }

      // Clearing the key is what the `story_purge_clears_key` check constraint
      // requires, and it is also what makes `signMedia` return null instead of a
      // URL that would 404.
      await this.prisma.story.updateMany({
        where: { id: story.id, mediaPurgedAt: null },
        data: { mediaObjectKey: null, mediaPurgedAt: now },
      });
      count += 1;
    }
    return count;
  }
}
