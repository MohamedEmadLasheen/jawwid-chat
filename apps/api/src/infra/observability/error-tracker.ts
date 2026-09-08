import { redact } from './json-logger';

/**
 * What an error report carries. Every field here is deliberately a LABEL, not
 * content: the same set the request log already emits (monitoring.md §3), for
 * the same reason -- these aggregate, and none of them is user-controlled text.
 */
export interface ErrorContext {
  /** `POST /conversations/:id/messages`. A pattern, never a resolved URL. */
  readonly route?: string;
  readonly requestId?: string;
  /** STAFF | TEACHER | FAMILY. Never an actor id. */
  readonly actorKind?: string;
  readonly status?: number;
  /** `api` or `worker`. */
  readonly component?: string;
}

/**
 * THE seam. Nothing in the application imports Sentry; it imports this.
 *
 * Phase 8, closing blocker B-4. `SENTRY_DSN` was `req` in staging and
 * production in the environment manifest while no code read it -- an operator
 * obliged to supply a credential that nothing consumed, and "detection = a
 * person noticing" in the meantime.
 */
export interface ErrorTracker {
  readonly name: string;
  isEnabled(): boolean;
  captureException(error: unknown, context?: ErrorContext): void;
  /** Flush before the process exits, so a crash report is not lost with it. */
  close(timeoutMs?: number): Promise<void>;
}

/**
 * The tracker used when no DSN is configured, which is every developer machine.
 *
 * It does nothing and says nothing. An error that is not reported has still
 * been LOGGED -- JsonLogger wrote it to stdout before this was ever called --
 * so the local story is unchanged, which is the point: error tracking is a
 * destination, not the record.
 */
export class NoopErrorTracker implements ErrorTracker {
  readonly name = 'noop';
  isEnabled(): boolean {
    return false;
  }
  captureException(): void {
    /* deliberately nothing */
  }
  async close(): Promise<void> {
    /* nothing to flush */
  }
}

/**
 * Chooses the tracker for this process.
 *
 * The same shape as OBJECT_STORAGE, PUSH_PROVIDER, CALL_RECORDER and
 * AI_PROVIDER before it: the real implementation when the environment supplies
 * credentials, an honest inert one when it does not. A developer with no Sentry
 * project gets a working process, and a deployment that has one gets reporting,
 * with no branch anywhere else in the codebase.
 *
 * Imported lazily so that a process without a DSN never loads the SDK at all --
 * which keeps its instrumentation, its global handlers and its ~2MB out of a
 * local run entirely.
 */
export function createErrorTracker(component: string, build: BuildInfoLike): ErrorTracker {
  if (!process.env.SENTRY_DSN) return new NoopErrorTracker();
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const { SentryErrorTracker } = require('./sentry-error-tracker') as {
    SentryErrorTracker: new (component: string, build: BuildInfoLike) => ErrorTracker;
  };
  return new SentryErrorTracker(component, build);
}

/** The subset of BuildInfo a tracker needs, so this file imports no module for it. */
export interface BuildInfoLike {
  readonly environment: string;
  readonly commit: string;
  readonly version: string;
}
