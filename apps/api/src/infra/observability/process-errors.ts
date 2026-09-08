import type { ErrorTracker } from './error-tracker';

interface MinimalLogger {
  error(message: string, ...rest: unknown[]): void;
}

/**
 * The two failures that reach neither an HTTP response nor a `catch`.
 *
 * An unhandled rejection or an uncaught exception is, by definition, the class
 * of fault nobody wrote a handler for -- so it is exactly the class an error
 * tracker exists to catch, and exactly the one that is invisible without it.
 *
 * ## Why neither of these exits the process
 *
 * Node's default for an uncaught exception is to terminate, and that default is
 * usually right. It is not right here, and the reason is the worker: its loop
 * deliberately swallows every subsystem error so that a wedged broadcast fan-out
 * is not why nobody's notifications go out. A process-level `exit(1)` would
 * reintroduce precisely the coupling that loop was written to remove -- one bad
 * event killing every other subsystem -- and the platform would restart into
 * the same event.
 *
 * The API is the same argument from the other side: Nest has already turned
 * request faults into 500s, so anything arriving here is from a detached
 * callback, and killing a process serving other people's requests to punish one
 * stray timer is a worse outcome than reporting it.
 *
 * So both are REPORTED and the process continues. A fault that genuinely
 * warrants death still gets it from the failing health probe, which is the
 * mechanism that already exists for "this process is no longer able to serve".
 */
export function installProcessErrorHandlers(
  errors: ErrorTracker,
  logger: MinimalLogger = console,
): void {
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error(
      `unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
    errors.captureException(reason, { route: 'process.unhandledRejection' });
  });

  process.on('uncaughtException', (error: Error) => {
    logger.error(`uncaught exception: ${error.message}`);
    errors.captureException(error, { route: 'process.uncaughtException' });
  });
}

/**
 * Flush on the way out.
 *
 * A report that exists only in the SDK's in-memory queue when the container
 * stops is a report of the crash that nobody receives -- and the crash is the
 * event you most wanted. Bounded, because a shutdown that hangs waiting for a
 * telemetry endpoint is a worse failure than a lost event.
 */
export async function flushErrorTracker(errors: ErrorTracker, timeoutMs = 2000): Promise<void> {
  try {
    await errors.close(timeoutMs);
  } catch {
    /* a tracker that cannot flush must not be why shutdown fails */
  }
}
