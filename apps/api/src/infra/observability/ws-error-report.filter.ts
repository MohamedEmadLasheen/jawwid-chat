import { ArgumentsHost, Catch, HttpException, IntrinsicException } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { processErrorTracker, type ErrorTracker } from './error-tracker';

/**
 * Reports an UNEXPECTED exception from a WebSocket handler, then answers the
 * client exactly as Nest's own handler would have.
 *
 * Why a filter on the gateway: Nest applies no global filter or capture
 * interceptor to gateways (its WS ExceptionFiltersContext has no global
 * metadata), so without this a database error inside `conversation.subscribe`
 * was logged by WsExceptionsHandler and never reached the error tracker.
 *
 * WHAT IS REPORTED. The exception, labelled `WS <event name>` -- the event is
 * the name of one of our @SubscribeMessage handlers, accepted only as a short
 * identifier. NEVER the frame's data (a conversation id, a draft, a message
 * body), the client, its handshake or its token: the tracker is handed the
 * error and two labels, and nothing else exists for it to attach. The event
 * then goes through the same scrubEvent allowlist as every other report.
 *
 * WHAT IS NOT. A WsException (a refusal the handler chose to send), an
 * HttpException below 500 (a refusal too) and Nest's IntrinsicException: the
 * system working, the WS twin of "4xx are not reported".
 *
 * BEHAVIOUR. Unchanged: `super.catch` emits the same `exception` frame and logs
 * the same line as the default handler. Reporting can never stop that -- it is
 * guarded, and runs first only so a client that has gone away is still
 * reported.
 */
@Catch()
export class WsErrorReportFilter extends BaseWsExceptionFilter {
  constructor(private readonly tracker: () => ErrorTracker = processErrorTracker) {
    super();
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    try {
      if (isUnexpectedWsError(exception)) {
        const event = wsEventLabel(host.switchToWs().getPattern());
        this.tracker().captureException(exception, { route: `WS ${event}`, component: 'api' });
      }
    } catch {
      /* reporting an error must never become the error */
    }
    // WsExceptionsHandler skips a client without emit; so must we, or
    // BaseWsExceptionFilter would throw on it.
    const client = host.switchToWs().getClient<{ emit?: unknown }>();
    if (typeof client?.emit !== 'function') return;
    super.catch(exception, host);
  }
}

export function isUnexpectedWsError(exception: unknown): boolean {
  if (exception instanceof WsException) return false;
  // Before IntrinsicException: in Nest 11 HttpException extends it.
  if (exception instanceof HttpException) return exception.getStatus() >= 500;
  if (exception instanceof IntrinsicException) return false;
  return true;
}

/** The event name if it is a plain identifier (it is, for every handler we register); otherwise a fixed label. */
export function wsEventLabel(pattern: unknown): string {
  return typeof pattern === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(pattern) ? pattern : '<unknown>';
}
