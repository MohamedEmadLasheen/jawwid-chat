import { Injectable, Logger } from '@nestjs/common';
import { AutomationEngine } from './automation.engine';
import { TriggerSource } from './trigger-source';
import { Outcome } from './automation.types';

/**
 * The automation sweep, run by the worker alongside the outbox drain.
 *
 * Safe on several replicas without a lease of its own: the engine claims each
 * occurrence with a unique insert before it acts, so a replica that loses the
 * race does nothing. That is a stronger guarantee than a lease and has one
 * fewer failure mode -- there is no claim to expire and no wedged holder to
 * block a reminder until it does.
 *
 * Each source is drained separately and each failure is contained, for the same
 * reason the worker wraps its four subsystems separately: an automation that
 * cannot compute follow-ups must not be why nobody's unanswered-message flags
 * are raised.
 */
@Injectable()
export class AutomationSweeper {
  private readonly log = new Logger(AutomationSweeper.name);

  constructor(
    private readonly engine: AutomationEngine,
    private readonly triggers: TriggerSource,
  ) {}

  /** Returns how many actions actually executed. */
  async sweep(now = new Date()): Promise<number> {
    let executed = 0;

    for (const [name, load] of [
      ['follow-ups', () => this.triggers.followUpsDue(now)],
      ['unanswered', () => this.triggers.unansweredConversations(now)],
      // Drains an ingestion table nothing writes yet. It costs one indexed
      // query per sweep and starts working the day Core connects, with no
      // deployment.
      ['core events', () => this.triggers.fromCoreEvents()],
    ] as const) {
      try {
        for (const event of await load()) {
          const results = await this.engine.fire(event);
          executed += results.filter((r) => r.outcome === Outcome.EXECUTED).length;
        }
      } catch (error) {
        this.log.error(
          `${name} sweep failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    if (executed > 0) this.log.log(`automation executed ${executed} action(s)`);
    return executed;
  }
}
