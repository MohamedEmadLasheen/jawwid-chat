/**
 * The one-line-per-request log.
 *
 * The property worth protecting is that a URL is USER-CONTROLLED TEXT. A search
 * term, a filename, an id nobody meant to publish -- all of them arrive in the
 * path or the query string, and a log store is read by more systems and more
 * people than the API response ever is.
 *
 * So this asserts the shape of what is written, and just as importantly what is
 * not: no body, no query string, no headers, no raw identifiers.
 */
import { firstValueFrom, of, throwError } from 'rxjs';
import { ExecutionContext } from '@nestjs/common';
import { JsonLogger, LogRecord } from '../../../src/infra/observability/json-logger';
import { RequestLogInterceptor } from '../../../src/infra/observability/request-log.interceptor';

const BUILD = {
  commit: 'a1b2c3d',
  version: 'v',
  builtAt: 't',
  environment: 'production',
};

function harness(options: {
  method?: string;
  url?: string;
  routePath?: string;
  headers?: Record<string, string>;
  actorKind?: string;
  statusCode?: number;
}) {
  const lines: LogRecord[] = [];
  const logger = new JsonLogger('api', BUILD, (l) => lines.push(JSON.parse(l) as LogRecord));
  const setHeaders: Record<string, string> = {};

  const request = {
    method: options.method ?? 'GET',
    originalUrl: options.url ?? '/',
    headers: options.headers ?? {},
    route: options.routePath ? { path: options.routePath } : undefined,
    actor: options.actorKind ? { kind: options.actorKind } : undefined,
  };
  const response = {
    statusCode: options.statusCode ?? 200,
    setHeader: (n: string, v: string) => {
      setHeaders[n] = v;
    },
  };

  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;

  return { interceptor: new RequestLogInterceptor(logger), context, lines, setHeaders };
}

describe('RequestLogInterceptor', () => {
  it('logs route, status and latency for a successful request', async () => {
    const h = harness({
      method: 'POST',
      routePath: '/conversations/:conversationId/messages',
      statusCode: 201,
      actorKind: 'staff',
    });
    await firstValueFrom(h.interceptor.intercept(h.context, { handle: () => of('ok') }));

    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({
      level: 'info',
      route: 'POST /conversations/:conversationId/messages',
      status: 201,
      actor_kind: 'staff',
    });
    expect(typeof h.lines[0].latency_ms).toBe('number');
  });

  it('logs the route PATTERN, never the resolved id', async () => {
    // A pattern aggregates, so "p95 of message send" is a query rather than a
    // research project -- and it keeps a real conversation id out of the logs.
    const h = harness({
      method: 'GET',
      routePath: '/conversations/:id',
      url: '/api/v1/conversations/7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b',
    });
    await firstValueFrom(h.interceptor.intercept(h.context, { handle: () => of('ok') }));
    expect(h.lines[0].route).toBe('GET /conversations/:id');
    expect(JSON.stringify(h.lines[0])).not.toContain('7f3a1b2c');
  });

  it('masks identifiers when no route matched — which is what an attack produces', async () => {
    // A 404 or a request refused by a guard never reaches a handler, so
    // `request.route` is empty. Those are exactly the requests a scan
    // generates, so they must not be the ones that put raw input in the log.
    const h = harness({
      method: 'GET',
      url: '/api/v1/families/7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b/notes',
      statusCode: 404,
    });
    await firstValueFrom(h.interceptor.intercept(h.context, { handle: () => of('ok') }));
    expect(h.lines[0].route).toBe('GET /api/v1/families/:id/notes');
  });

  it('drops the query string entirely', async () => {
    // ?q=<what a parent searched for> is content.
    const h = harness({
      method: 'GET',
      url: '/api/v1/search?q=my%20child%20is%20unwell&phone=%2B201001234567',
    });
    await firstValueFrom(h.interceptor.intercept(h.context, { handle: () => of('ok') }));
    const line = JSON.stringify(h.lines[0]);
    expect(line).not.toContain('unwell');
    expect(line).not.toContain('201001234567');
    expect(line).not.toContain('?');
  });

  it('logs no headers, so the Authorization header cannot reach stdout', async () => {
    const h = harness({
      routePath: '/me',
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig' },
    });
    await firstValueFrom(h.interceptor.intercept(h.context, { handle: () => of('ok') }));
    expect(JSON.stringify(h.lines[0])).not.toContain('eyJhbGci');
  });

  it('honours an inbound X-Request-Id and echoes it back', async () => {
    // End-to-end correlation across the load balancer, the API and the worker.
    const h = harness({ routePath: '/me', headers: { 'x-request-id': '01JABCDEF' } });
    await firstValueFrom(h.interceptor.intercept(h.context, { handle: () => of('ok') }));
    expect(h.lines[0].request_id).toBe('01JABCDEF');
    expect(h.setHeaders['X-Request-Id']).toBe('01JABCDEF');
  });

  it('mints a request id when the client sent none', async () => {
    const h = harness({ routePath: '/me' });
    await firstValueFrom(h.interceptor.intercept(h.context, { handle: () => of('ok') }));
    expect(h.lines[0].request_id).toMatch(/[0-9a-f-]{36}/);
  });

  it('separates client errors from server errors', async () => {
    // monitoring.md §2 wants 4xx and 5xx as DISTINCT signals: a 4xx spike is
    // usually a client bug or an attack, a 5xx spike is us. One "error" level
    // for both merges the two back together.
    const client = harness({ routePath: '/messages' });
    await expect(
      firstValueFrom(
        client.interceptor.intercept(client.context, {
          handle: () => throwError(() => Object.assign(new Error('nope'), { status: 403 })),
        }),
      ),
    ).rejects.toThrow();
    expect(client.lines[0]).toMatchObject({ level: 'warn', status: 403 });

    const server = harness({ routePath: '/messages' });
    await expect(
      firstValueFrom(
        server.interceptor.intercept(server.context, {
          handle: () => throwError(() => new Error('boom')),
        }),
      ),
    ).rejects.toThrow();
    expect(server.lines[0]).toMatchObject({ level: 'error', status: 500 });
  });

  it('logs nothing for a non-HTTP context', async () => {
    const h = harness({});
    (h.context as { getType: () => string }).getType = () => 'ws';
    await firstValueFrom(h.interceptor.intercept(h.context, { handle: () => of('ok') }));
    expect(h.lines).toHaveLength(0);
  });
});
