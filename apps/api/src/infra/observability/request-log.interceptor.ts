import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { JsonLogger } from './json-logger';
import type { Actor } from '../../platform/types';

interface LoggableRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  route?: { path?: string };
  headers: Record<string, string | string[] | undefined>;
  actor?: Actor;
}

interface LoggableResponse {
  statusCode?: number;
  setHeader(name: string, value: string): void;
}

/**
 * One log line per request: what was asked, what happened, how long it took.
 * Phase 8, implementing docs/infrastructure/monitoring.md §3 and §4.
 *
 * WHY THE ROUTE PATTERN AND NOT THE URL. It logs `POST /conversations/:id/messages`,
 * never `POST /conversations/7f3a.../messages`. Two reasons, and the second is
 * the one that matters: a pattern aggregates, so "p95 latency of message send"
 * is a query rather than a research project -- and a raw URL is user-controlled
 * text, which is how a search term, a filename or an id nobody meant to publish
 * ends up in a log store that a dozen systems can read.
 *
 * WHAT IS DELIBERATELY ABSENT. No request body, no response body, no query
 * string, no headers. The privacy rule in monitoring.md §3 is not enforced by
 * scrubbing here; it is enforced by this interceptor never touching content in
 * the first place. Scrubbing is the backstop in JsonLogger, for free-form
 * messages written elsewhere.
 *
 * ACTOR IDENTITY. `actor_kind` only -- STAFF, TEACHER, FAMILY. Enough to answer
 * "are family users seeing these errors?", which is the question logs get asked,
 * without accumulating a record of which individual did what. Audit already
 * answers that question, deliberately, in a place with access controls on it.
 */
@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  constructor(private readonly logger: JsonLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<LoggableRequest>();
    const response = http.getResponse<LoggableResponse>();

    // Honour an inbound X-Request-Id so a request can be followed across the
    // load balancer, the API and the worker; mint one when there is none, so
    // every line is correlatable even for a client that sends nothing.
    const inbound = request.headers['x-request-id'];
    const requestId = (Array.isArray(inbound) ? inbound[0] : inbound)?.slice(0, 128) || randomUUID();
    response.setHeader('X-Request-Id', requestId);

    const started = process.hrtime.bigint();
    const route = `${request.method ?? 'GET'} ${routePattern(request)}`;

    const emit = (status: number, level: 'log' | 'warn' | 'error'): void => {
      this.logger.write(level, 'request', 'Http', {
        request_id: requestId,
        route,
        status,
        latency_ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
        actor_kind: request.actor?.kind,
      });
    };

    return next.handle().pipe(
      tap({
        next: () => emit(response.statusCode ?? 200, 'log'),
        error: (e: unknown) => {
          // 4xx and 5xx are separated because they mean different things: a 4xx
          // spike is usually a client bug or an attack, a 5xx spike is us.
          // monitoring.md §2 asks for them as distinct signals, and a single
          // "error" level would merge them back together.
          const status = statusOf(e);
          emit(status, status >= 500 ? 'error' : 'warn');
        },
      }),
    );
  }
}

/**
 * The route PATTERN, falling back to a path with its id segments masked.
 *
 * `request.route` is only populated once Nest has matched a handler, so a 404
 * or a request refused by a guard before matching has none -- and those are
 * exactly the requests an attack produces, so they must not be the ones that
 * put raw user input into the log.
 */
function routePattern(request: LoggableRequest): string {
  if (request.route?.path) return request.route.path;
  const path = (request.originalUrl ?? request.url ?? '/').split('?')[0];
  return path
    .split('/')
    .map((segment) => (looksLikeIdentifier(segment) ? ':id' : segment))
    .join('/');
}

function looksLikeIdentifier(segment: string): boolean {
  if (segment.length === 0) return false;
  // A UUID, a long opaque token, or anything numeric.
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^\d+$/.test(segment) ||
    segment.length > 24
  );
}

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : 500;
}
