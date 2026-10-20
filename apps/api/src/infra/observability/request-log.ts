import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'node:crypto';
import type { JsonLogger } from './json-logger';
import { NoopErrorTracker, type ErrorTracker } from './error-tracker';

/** Minimal shapes, so this file needs no Express types. */
export interface LoggableRequest {
  method?: string;
  route?: { path?: unknown };
  headers: Record<string, string | string[] | undefined>;
  actor?: { kind?: string };
}

export interface LoggableResponse {
  statusCode?: number;
  writableFinished?: boolean;
  setHeader(name: string, value: string): void;
  once(event: 'finish' | 'close', listener: () => void): unknown;
}

/** Shown in place of a route when no handler matched (a 404, a scan, a CORS preflight). */
export const UNMATCHED_ROUTE = '<unmatched>';

/**
 * The status recorded for a request whose client went away before the
 * response was written. 499 is the nginx convention; no response carries it.
 */
export const CLIENT_CLOSED = 499;

/**
 * One log line per HTTP request: method, route TEMPLATE, status, latency,
 * request id, actor kind. docs/infrastructure/monitoring.md §3 and §4.
 *
 * WHY MIDDLEWARE, NOT AN INTERCEPTOR. A Nest interceptor never sees a request
 * refused by a guard (every 401 the AuthGuard issues), a request no route
 * matched (every 404 a scan produces), or the status an exception filter
 * finally chose (CommErrorFilter turns a domain error into a 403). Those are
 * the requests an incident or an attack is made of. This hooks the response's
 * `finish` event instead, so it logs every request with the status that was
 * actually sent -- once, whatever path produced it.
 *
 * WHY THE TEMPLATE AND NOT THE URL. It logs `POST /api/v1/conversations/:id/messages`,
 * never the resolved path. A template aggregates, so "p95 of message send" is
 * a query; and a resolved URL is user-controlled text -- a search term, a file
 * name, an object key, an id nobody meant to publish. A request that matched
 * no route is logged as `<unmatched>`: its path is attacker-chosen text, and
 * there is no template to log instead.
 *
 * WHAT IS NEVER READ. No body, no query string (a media link's `s=` signature
 * lives there), and no header except X-Request-Id, which is accepted only in a
 * fixed opaque shape. Content cannot leak through a channel that never touches
 * it; JsonLogger's redaction is the backstop for free-form messages elsewhere.
 *
 * ACTOR. `actor_kind` only (staff, teacher, contact, ...), never an id or a
 * name: enough to ask "are families seeing these errors?" without building a
 * record of who did what. chat.audit_log answers that, behind access controls.
 *
 * 5xx -> the error tracker, with the exception the handler threw when
 * RequestErrorCaptureInterceptor saw one. 4xx are NOT reported: a 403 is the
 * authorization service working, and on several routes refusal is the most
 * common outcome.
 */
export function requestLogMiddleware(
  logger: JsonLogger,
  errors: ErrorTracker = new NoopErrorTracker(),
): (req: LoggableRequest, res: LoggableResponse, next: () => void) => void {
  return (req, res, next) => {
    // Honour an inbound X-Request-Id so a request can be followed across the
    // load balancer, the API and the worker; mint one otherwise.
    const requestId = acceptRequestId(req.headers['x-request-id']) ?? randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    let logged = false;

    const emit = (clientClosed: boolean): void => {
      if (logged) return;
      logged = true;
      const status = clientClosed ? CLIENT_CLOSED : (res.statusCode ?? 0);
      const template = routeTemplate(req);
      const route = `${methodOf(req)} ${template}`;
      const actorKind = typeof req.actor?.kind === 'string' ? req.actor.kind : undefined;

      logger.write(levelFor(status, template, req), 'request', 'Http', {
        request_id: requestId,
        route,
        status,
        latency_ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
        actor_kind: actorKind,
      });

      if (status >= 500 && status !== CLIENT_CLOSED) {
        errors.captureException(takeRequestError(req) ?? new HttpServerError(status), {
          route,
          requestId,
          actorKind,
          status,
          component: 'api',
        });
      }
    };

    res.once('finish', () => emit(false));
    res.once('close', () => emit(!res.writableFinished));
    next();
  };
}

/**
 * Remembers the exception a handler threw, so the request log can report a
 * 5xx WITH its stack. It logs nothing itself and changes nothing: the error is
 * rethrown untouched to whichever exception filter maps it.
 */
@Injectable()
export class RequestErrorCaptureInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<object>();
    return next.handle().pipe(tap({ error: (e: unknown) => rememberRequestError(request, e) }));
  }
}

const requestErrors = new WeakMap<object, unknown>();

export function rememberRequestError(request: object, error: unknown): void {
  requestErrors.set(request, error);
}

function takeRequestError(request: object): unknown {
  const error = requestErrors.get(request);
  requestErrors.delete(request);
  return error;
}

/** Reported when a 5xx left no exception behind (a guard or middleware failed). */
export class HttpServerError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status} with no captured exception`);
    this.name = 'HttpServerError';
  }
}

/**
 * The route TEMPLATE Express matched, or `<unmatched>`.
 *
 * `req.route.path` is the string the route was registered with -- for Nest,
 * the full template including the global prefix. Express only sets it on a
 * request that reached a route; anything else gets no path at all.
 */
export function routeTemplate(req: LoggableRequest): string {
  const path = req.route?.path;
  return typeof path === 'string' && path.length > 0 && path.length <= 256 ? path : UNMATCHED_ROUTE;
}

const HEALTH_ROUTES = new Set(['/health', '/health/live', '/health/ready']);

/**
 * 5xx error, 4xx warn -- monitoring.md §2 wants them as distinct signals: a 4xx
 * spike is usually a client bug or an attack, a 5xx spike is us. A successful
 * health probe or CORS preflight is debug: a load balancer probing every few
 * seconds would otherwise be most of the log.
 */
function levelFor(status: number, template: string, req: LoggableRequest): 'log' | 'warn' | 'error' | 'debug' {
  if (status >= 500 && status !== CLIENT_CLOSED) return 'error';
  if (status >= 400) return 'warn';
  if (HEALTH_ROUTES.has(template) || methodOf(req) === 'OPTIONS') return 'debug';
  return 'log';
}

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function methodOf(req: LoggableRequest): string {
  const method = (req.method ?? '').toUpperCase();
  return METHODS.has(method) ? method : 'OTHER';
}

/**
 * An inbound request id, accepted only in the shapes an edge proxy mints: a
 * UUID, a ULID, or 16-64 hex characters. A header is user-controlled text that
 * this middleware both logs and echoes, so anything else -- a sentence, a
 * name, a phone number -- is replaced by a fresh id rather than written down.
 * (No Jawwid client sends one today; the edge may.)
 */
const REQUEST_ID_SHAPES = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9A-HJKMNP-TV-Z]{26}$/i,
  /^[0-9a-f]{16,64}$/i,
];

export function acceptRequestId(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  return REQUEST_ID_SHAPES.some((shape) => shape.test(value)) ? value : undefined;
}
