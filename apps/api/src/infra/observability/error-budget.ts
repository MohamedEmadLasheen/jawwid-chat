import { performance } from 'node:perf_hooks';
import type { ErrorContext } from './error-tracker';

/**
 * How many error reports one process may send, so an outage cannot exhaust the
 * Sentry quota and leave the project blind for the rest of the month.
 *
 * ## Why this exists
 *
 * The worker runs about twenty subsystems on every turn of its loop, each in
 * its own try/catch that reports what it swallowed, and the loop turns every
 * few seconds. With the database down, every one of them fails on every turn:
 * on the order of ten thousand events an hour from one process, plus a 5xx for
 * every API request. The SDK's dedupe integration drops an event only when it
 * is identical to the one immediately before it, so interleaved subsystems are
 * never deduplicated. A quota spent in the first minutes of an outage means
 * nothing is reported for the incident that follows it.
 *
 * ## The two limits
 *
 *   per key   the first failure of a kind is sent at once; the same kind is then
 *             sent at most once per `perKeyIntervalMs`, and that event carries
 *             how many were held back since the last one (`suppressed`).
 *   global    at most `globalLimit` events per `globalWindowMs`, across every
 *             kind, so a burst of DIFFERENT failures is bounded too.
 *
 * A "kind" is the component, the route label, the status and the error's class
 * (plus a Prisma code): the same labels the event carries, never its message,
 * so two different faults on one route are still two kinds.
 *
 * `critical` (an uncaught exception, a failed boot: the process exits right
 * after) skips BOTH limits. Those are the reports that matter most, a process
 * sends at most one before it exits, and a crash loop is bounded by the
 * platform's restart rate.
 *
 * Time is MONOTONIC (performance.now), so an NTP or manual correction of the
 * wall clock can neither extend a suppression nor fill the window with sends
 * dated in the future. An elapsed time that is somehow negative (an injected
 * clock in a test) is treated as an interval that has passed: the failure mode
 * of a confused clock is one extra event, never a hidden one.
 *
 * Every failure is still LOGGED in full by the caller, so suppression only ever
 * removes duplicates from the error tracker, never from the record.
 */
export interface ErrorBudgetOptions {
  readonly perKeyIntervalMs: number;
  readonly globalLimit: number;
  readonly globalWindowMs: number;
  /** Bound on remembered kinds, so the map cannot grow without limit. */
  readonly maxKeys: number;
  readonly now?: () => number;
}

/**
 * One event per kind per 15 minutes; 20 events an hour per process. With the
 * API and the worker both failing for a whole day, that is under 1,000 events,
 * against a free-plan quota of 5,000 a month.
 */
export const DEFAULT_ERROR_BUDGET: Omit<ErrorBudgetOptions, 'now'> = {
  perKeyIntervalMs: 15 * 60_000,
  globalLimit: 20,
  globalWindowMs: 60 * 60_000,
  maxKeys: 500,
};

export type BudgetDecision = { readonly send: false } | { readonly send: true; readonly suppressed: number };

interface KindState {
  lastSentAt: number;
  suppressed: number;
}

export class ErrorBudget {
  private readonly kinds = new Map<string, KindState>();
  /** Send times inside the current global window, oldest first. */
  private sent: number[] = [];
  private readonly options: ErrorBudgetOptions;
  private readonly now: () => number;

  constructor(options: Partial<ErrorBudgetOptions> = {}) {
    this.options = { ...DEFAULT_ERROR_BUDGET, ...options };
    this.now = options.now ?? (() => performance.now());
  }

  admit(key: string, critical = false): BudgetDecision {
    const now = this.now();
    const { perKeyIntervalMs, globalLimit, globalWindowMs } = this.options;
    const state = this.kinds.get(key);
    const within = (t: number, ms: number) => now - t >= 0 && now - t < ms;

    if (critical) return this.send(key, now, state);

    if (state && within(state.lastSentAt, perKeyIntervalMs)) {
      state.suppressed++;
      this.remember(key, state);
      return { send: false };
    }

    this.sent = this.sent.filter((t) => within(t, globalWindowMs));
    if (this.sent.length >= globalLimit) {
      // Held back, but not marked as sent: the next one of this kind tries again.
      this.remember(key, { lastSentAt: state?.lastSentAt ?? Number.NEGATIVE_INFINITY, suppressed: (state?.suppressed ?? 0) + 1 });
      return { send: false };
    }

    return this.send(key, now, state);
  }

  private send(key: string, now: number, state: KindState | undefined): BudgetDecision {
    const suppressed = state?.suppressed ?? 0;
    this.remember(key, { lastSentAt: now, suppressed: 0 });
    this.sent.push(now);
    return { send: true, suppressed };
  }

  /** Re-inserted, so the map's insertion order is least-recently-touched first. */
  private remember(key: string, state: KindState): void {
    this.kinds.delete(key);
    this.kinds.set(key, state);
    while (this.kinds.size > this.options.maxKeys) {
      const oldest = this.kinds.keys().next().value;
      if (oldest === undefined) break;
      this.kinds.delete(oldest);
    }
  }
}

/** Routes whose report is followed by the process exiting (process-errors.ts, main.ts, worker.ts). */
const CRITICAL_ROUTES = new Set(['process.uncaughtException', 'bootstrap']);

export function isCriticalReport(context: ErrorContext): boolean {
  return context.route !== undefined && CRITICAL_ROUTES.has(context.route);
}

/**
 * The kind of a failure: labels only. The class name is accepted only as a
 * short identifier, and a Prisma code only in its fixed shape, so nothing an
 * error MESSAGE says can become part of a key.
 */
export function errorKind(error: unknown, context: ErrorContext): string {
  const e = error as { name?: unknown; code?: unknown; errorCode?: unknown } | null | undefined;
  const name = error instanceof Error && typeof e?.name === 'string' && /^\w{1,64}$/.test(e.name) ? e.name : typeof error;
  const code = [e?.code, e?.errorCode].find((c): c is string => typeof c === 'string' && /^P\d{4}$/.test(c)) ?? '';
  return [context.component ?? '', context.route ?? '', context.status ?? '', name, code].join('|');
}
