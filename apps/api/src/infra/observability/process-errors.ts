import type { ErrorTracker } from './error-tracker';
import { safeErrorMessage } from './redact';

interface MinimalLogger {
  error(message: string, context?: string): void;
}

export interface ProcessErrorOptions {
  /** Defaults to process.exit; injected so a test can observe it. */
  readonly exit?: (code: number) => void;
  /** How long to wait for the tracker to flush before exiting. */
  readonly flushTimeoutMs?: number;
}

/**
 * The two failures that reach neither an HTTP response nor a `catch`.
 *
 * An unhandled rejection or an uncaught exception is, by definition, the class
 * of fault nobody wrote a handler for -- so it is exactly the class an error
 * tracker exists to catch, and exactly the one that is invisible without it.
 * Installed by both processes (main.ts, worker.ts) before anything else runs.
 *
 * ## What each one does to the process
 *
 * UNHANDLED REJECTION: logged, reported, and the process CONTINUES. A stray
 * promise nobody awaited is a bug, but not evidence that the process is
 * corrupt, and the worker's loop exists precisely so that one bad event does
 * not stop every other subsystem. (Node's own default would terminate.)
 *
 * UNCAUGHT EXCEPTION: logged, reported, flushed, and the process EXITS 1 --
 * the same outcome as Node's default and as before this handler existed. Node
 * documents that resuming after one is unsafe: the exception unwound an
 * unknown amount of state. The platform restarts the container; the flush
 * (bounded) is what keeps the report of the crash from dying with it.
 *
 * The log line carries the error's MESSAGE, redacted, never its stack, and a
 * Prisma error only as its class and code (redact.ts).
 */
export function installProcessErrorHandlers(
  errors: ErrorTracker,
  logger: MinimalLogger,
  options: ProcessErrorOptions = {},
): () => void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let exiting = false;

  const onRejection = (reason: unknown): void => {
    logger.error(`unhandled rejection: ${safeErrorMessage(reason)}`, 'Process');
    errors.captureException(reason, { route: 'process.unhandledRejection' });
  };

  const onException = (error: unknown): void => {
    logger.error(`uncaught exception: ${safeErrorMessage(error)}`, 'Process');
    errors.captureException(error, { route: 'process.uncaughtException' });
    if (exiting) return;
    exiting = true;
    void flushErrorTracker(errors, options.flushTimeoutMs).finally(() => exit(1));
  };

  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  return () => {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
  };
}

/**
 * Flush on the way out.
 *
 * A report that exists only in the SDK's in-memory queue when the container
 * stops is a report nobody receives. Bounded, because a shutdown that hangs
 * waiting for a telemetry endpoint is a worse failure than a lost event, and
 * never throws, because a tracker that cannot flush must not be why shutdown
 * fails.
 */
export async function flushErrorTracker(errors: ErrorTracker, timeoutMs = 2000): Promise<void> {
  try {
    await errors.close(timeoutMs);
  } catch {
    /* deliberately swallowed */
  }
}
