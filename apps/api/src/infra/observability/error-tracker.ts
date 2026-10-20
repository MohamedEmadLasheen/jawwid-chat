/**
 * What an error report carries. Every field is a LABEL, never content: the same
 * set the request log emits (monitoring.md §3), for the same reason -- these
 * aggregate, and none of them is user-controlled text.
 */
export interface ErrorContext {
  /** `POST /api/v1/conversations/:id/messages`, or a worker subsystem name. Never a resolved URL. */
  readonly route?: string;
  /** The request id the log line for the same failure carries. */
  readonly requestId?: string;
  /** staff | teacher | contact | ... Never an actor id. */
  readonly actorKind?: string;
  readonly status?: number;
  /** `api` or `worker`. */
  readonly component?: string;
}

/**
 * THE seam. Nothing in the application imports Sentry; it imports this.
 *
 * The same shape as OBJECT_STORAGE and PUSH_PROVIDER: the real implementation
 * when the environment supplies credentials, an honest inert one when it does
 * not, and no branch anywhere else in the codebase.
 */
export interface ErrorTracker {
  readonly name: string;
  isEnabled(): boolean;
  /** Must never throw: a tracker that fails while reporting is a second fault on the worst path. */
  captureException(error: unknown, context?: ErrorContext): void;
  /** Flush before the process exits, so a crash report is not lost with it. */
  close(timeoutMs?: number): Promise<void>;
}

/**
 * The tracker used when no DSN is configured, which is every developer machine
 * and every test run.
 *
 * It does nothing and says nothing. An error that is not reported has still
 * been LOGGED -- JsonLogger wrote it to stdout before this was called -- so the
 * local story is unchanged: error tracking is a destination, not the record.
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

/** The subset of BuildInfo a tracker needs, so this file imports no module for it. */
export interface BuildInfoLike {
  readonly environment: string;
  readonly commit: string;
  readonly version: string;
}

/**
 * Chooses the tracker for this process: Sentry when SENTRY_DSN is set, the
 * inert tracker otherwise.
 *
 * The SDK is reached through a lazy require, so a process without a DSN never
 * loads @sentry/node at all -- none of its instrumentation, global handlers or
 * footprint. Asserted structurally in test/unit/observability/error-tracker.spec.ts.
 */
export function createErrorTracker(
  component: string,
  build: BuildInfoLike,
  env: NodeJS.ProcessEnv = process.env,
): ErrorTracker {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return new NoopErrorTracker();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SentryErrorTracker } = require('./sentry-error-tracker') as {
    SentryErrorTracker: new (dsn: string, component: string, build: BuildInfoLike) => ErrorTracker;
  };
  return new SentryErrorTracker(dsn, component, build);
}
