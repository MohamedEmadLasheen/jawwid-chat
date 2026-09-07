import { Injectable, Logger } from '@nestjs/common';
import { ModerationService } from './moderation.service';

/**
 * The Phase 6 time-driven sweep.
 *
 * ONE thing in this phase becomes true because a DEADLINE PASSED rather than
 * because anybody did anything: a moderation item nobody has decided becomes a
 * manager's problem.
 *
 * ## Why this is a class of three lines rather than a call in worker.ts
 *
 * Symmetry with CallSweeper, and it is not decoration. `worker.ts` drives a
 * fixed list of subsystems, each wrapped in its own try so that one failing
 * subsystem cannot stop the others -- "a wedged retention sweep must not be the
 * reason nobody's calls are being marked missed". A sweeper class is the shape
 * that list takes, and it gives the escalation sweep the same error boundary
 * and the same log line as the sweeps beside it.
 *
 * ## Why NOT a @Cron in the API process
 *
 * The same reason CallSweeper is not: an API replica set of four would run four
 * sweeps. It is safe -- the claim is a conditional UPDATE, so the losers write
 * nothing -- but it is wasted work on a shared database.
 *
 * ## Why NOT a new scheduler
 *
 * Because there is one, it works, and the Phase 6 brief is explicit: use the
 * existing scheduling infrastructure rather than introducing a parallel one.
 */
@Injectable()
export class ModerationSweeper {
  private readonly log = new Logger(ModerationSweeper.name);

  constructor(private readonly moderation: ModerationService) {}

  async sweep(now: Date = new Date()): Promise<{ escalated: number }> {
    try {
      return { escalated: await this.moderation.escalateOverdue(now) };
    } catch (err) {
      // Never rethrow into the worker loop. An escalation that failed this
      // minute is retried next minute, because the claim predicate
      // (`escalated_at is null`) is still true.
      this.log.error(
        `moderation escalation sweep failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return { escalated: 0 };
    }
  }
}
