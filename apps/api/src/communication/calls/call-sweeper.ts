import { Injectable, Logger } from '@nestjs/common';
import { CallService } from './call.service';
import { RecordingService } from './recording.service';
import { StoryService } from '../stories/story.service';

/**
 * The Phase 5 time-driven sweeps, in one place.
 *
 * Three things in this phase become true because a DEADLINE PASSED rather than
 * because anybody did anything: a call nobody answered becomes a missed call, a
 * recording past its retention date is deleted, and a story past its expiry
 * stops being shown. None of them can be a client's job -- the client is
 * frequently the thing that failed -- and none of them can be a database
 * trigger, because nothing writes the row that would fire it.
 *
 * ## Every sweep here is idempotent and concurrency-safe
 *
 * Each one is a conditional UPDATE guarded on the state it expects to change.
 * Two schedulers, a restarted process, or a sweep overlapping its own previous
 * run all converge: one writer wins each row and the rest write nothing. There
 * is no lease to leak, because there is nothing in flight -- the transition IS
 * the work.
 *
 * ## Where this is driven from
 *
 * `worker.ts`, alongside the outbox drain and the notification dispatch. It is
 * deliberately NOT a @Cron in the API process: an API replica set of four would
 * run four sweeps, and while that is safe here it is wasted work on a shared
 * database.
 */
@Injectable()
export class CallSweeper {
  private readonly log = new Logger(CallSweeper.name);

  constructor(
    private readonly calls: CallService,
    private readonly recordings: RecordingService,
    private readonly stories: StoryService,
  ) {}

  async sweep(now: Date = new Date()): Promise<{
    missedCalls: number;
    deletedRecordings: number;
    expiredStories: number;
  }> {
    // Each in its own try, so a failure in one does not stop the others. A
    // wedged retention sweep must not be the reason nobody's calls are being
    // marked missed.
    let missedCalls = 0;
    let deletedRecordings = 0;
    let expiredStories = 0;

    try {
      missedCalls = await this.calls.expireRingingCalls(now);
    } catch (err) {
      this.log.error(`missed-call sweep failed: ${message(err)}`);
    }
    try {
      deletedRecordings = await this.recordings.sweepExpired(now);
    } catch (err) {
      this.log.error(`recording retention sweep failed: ${message(err)}`);
    }
    try {
      expiredStories = await this.stories.expireDue(now);
    } catch (err) {
      this.log.error(`story expiry sweep failed: ${message(err)}`);
    }

    if (missedCalls || deletedRecordings || expiredStories) {
      this.log.log(
        `sweep: ${missedCalls} missed calls, ${deletedRecordings} recordings deleted, ` +
          `${expiredStories} stories expired`,
      );
    }
    return { missedCalls, deletedRecordings, expiredStories };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown';
}
