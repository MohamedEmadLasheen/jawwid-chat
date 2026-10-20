/**
 * The one-line-per-request log.
 *
 * The property worth protecting is that a URL is USER-CONTROLLED TEXT. A search
 * term, a filename, an object key, a media link's signature, an id nobody meant
 * to publish -- all of them arrive in the path or the query string, and a log
 * store is read by more systems and more people than the API response ever is.
 *
 * So this asserts the shape of what is written, and just as importantly what is
 * not: no body, no query string, no headers, no resolved path.
 */
import { EventEmitter } from 'node:events';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ExecutionContext } from '@nestjs/common';
import { JsonLogger, LogRecord } from '../../../src/infra/observability/json-logger';
import {
  acceptRequestId,
  RequestErrorCaptureInterceptor,
  requestLogMiddleware,
  UNMATCHED_ROUTE,
} from '../../../src/infra/observability/request-log';
import type { ErrorContext, ErrorTracker } from '../../../src/infra/observability/error-tracker';

const BUILD = { commit: 'a1b2c3d', version: 'v', builtAt: 't', environment: 'production' };

const UUID = '7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b';

class FakeResponse extends EventEmitter {
  statusCode = 200;
  writableFinished = false;
  readonly headers: Record<string, string> = {};
  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  end(status: number): void {
    this.statusCode = status;
    this.writableFinished = true;
    this.emit('finish');
    this.emit('close');
  }
}

interface FakeRequest {
  method: string;
  url: string;
  originalUrl: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: unknown;
  route?: { path: string };
  actor?: { kind: string; actorId: string; displayName: string };
}

function harness(level = 'trace') {
  const lines: LogRecord[] = [];
  const captured: Array<{ error: unknown; context?: ErrorContext }> = [];
  const tracker: ErrorTracker = {
    name: 'fake',
    isEnabled: () => true,
    captureException: (error, context) => captured.push({ error, context }),
    close: async () => undefined,
  };
  const logger = new JsonLogger('api', BUILD, (l) => lines.push(JSON.parse(l) as LogRecord), level);
  const middleware = requestLogMiddleware(logger, tracker);

  /** Runs one request through the middleware; `handle` plays Express + Nest. */
  function run(
    request: Partial<FakeRequest>,
    handle: (req: FakeRequest, res: FakeResponse) => void,
  ): { req: FakeRequest; res: FakeResponse } {
    const req: FakeRequest = {
      method: 'GET',
      url: '/',
      originalUrl: '/',
      headers: {},
      ...request,
    };
    const res = new FakeResponse();
    let called = false;
    middleware(req, res, () => {
      called = true;
    });
    expect(called).toBe(true);
    handle(req, res);
    return { req, res };
  }

  return { lines, captured, run };
}

describe('requestLogMiddleware — what a line carries', () => {
  it('logs method, route template, final status, latency, request id and actor kind', () => {
    const h = harness();
    h.run({ method: 'POST', originalUrl: `/api/v1/conversations/${UUID}/messages` }, (req, res) => {
      // Express sets req.route when a route matches; the guard sets req.actor.
      req.route = { path: '/api/v1/conversations/:id/messages' };
      req.actor = { kind: 'staff', actorId: 'staff-1', displayName: 'Someone Named' };
      res.end(201);
    });

    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({
      level: 'info',
      context: 'Http',
      message: 'request',
      route: 'POST /api/v1/conversations/:id/messages',
      status: 201,
      actor_kind: 'staff',
    });
    expect(typeof h.lines[0].latency_ms).toBe('number');
    expect(h.lines[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs the route TEMPLATE, never the resolved path, and never the actor', () => {
    const h = harness();
    h.run({ originalUrl: `/api/v1/conversations/${UUID}` }, (req, res) => {
      req.route = { path: '/api/v1/conversations/:id' };
      req.actor = { kind: 'contact', actorId: 'contact-42', displayName: 'Layla Example' };
      res.end(200);
    });
    const line = JSON.stringify(h.lines[0]);
    expect(h.lines[0].route).toBe('GET /api/v1/conversations/:id');
    expect(line).not.toContain('7f3a1b2c');
    expect(line).not.toContain('contact-42');
    expect(line).not.toContain('Layla');
  });

  it('logs <unmatched> when no route matched — the path of a scan is attacker-chosen text', () => {
    const h = harness();
    h.run({ originalUrl: '/api/v1/families/01001234567/notes/my-sons-name' }, (_req, res) => res.end(404));
    expect(h.lines[0]).toMatchObject({ route: `GET ${UNMATCHED_ROUTE}`, status: 404, level: 'warn' });
    expect(JSON.stringify(h.lines[0])).not.toContain('01001234567');
    expect(JSON.stringify(h.lines[0])).not.toContain('my-sons-name');
  });

  it('never reads the query string — a media link signature or a search term lives there', () => {
    const h = harness();
    h.run(
      {
        originalUrl: `/api/v1/media/attachments/${UUID}?e=1760000000&s=abcdef0123456789`,
        query: { q: 'my child is unwell', s: 'abcdef0123456789' },
      },
      (req, res) => {
        req.route = { path: '/api/v1/media/attachments/:id' };
        res.end(200);
      },
    );
    const line = JSON.stringify(h.lines[0]);
    expect(line).not.toContain('abcdef0123456789');
    expect(line).not.toContain('unwell');
    expect(line).not.toContain('?');
  });

  it('never reads the body or any header but X-Request-Id', () => {
    const h = harness();
    h.run(
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig',
          cookie: 'session=abc',
          'x-forwarded-for': '203.0.113.9',
        },
        body: { body: 'نعتذر عن التأخير', phone: '+201001234567' },
      },
      (req, res) => {
        req.route = { path: '/api/v1/conversations/:id/messages' };
        res.end(201);
      },
    );
    const line = JSON.stringify(h.lines[0]);
    for (const leaked of ['eyJhbGci', 'session=abc', '203.0.113.9', 'نعتذر', '201001234567']) {
      expect(line).not.toContain(leaked);
    }
  });

  it('logs a request once, even though finish and close both fire', () => {
    const h = harness();
    h.run({}, (req, res) => {
      req.route = { path: '/api/v1/me' };
      res.end(200);
    });
    expect(h.lines).toHaveLength(1);
  });

  it('records a client that went away before the response as 499, not as a success or a 5xx', () => {
    const h = harness();
    h.run({}, (req, res) => {
      req.route = { path: '/api/v1/me' };
      res.emit('close');
    });
    expect(h.lines[0]).toMatchObject({ status: 499, level: 'warn' });
    expect(h.captured).toHaveLength(0);
  });

  it('separates client errors from server errors', () => {
    // monitoring.md §2: a 4xx spike is usually a client bug or an attack, a
    // 5xx spike is us. One "error" level for both merges them back together.
    const h = harness();
    h.run({}, (req, res) => {
      req.route = { path: '/api/v1/messages' };
      res.end(403);
    });
    h.run({}, (req, res) => {
      req.route = { path: '/api/v1/messages' };
      res.end(500);
    });
    expect(h.lines.map((l) => [l.level, l.status])).toEqual([
      ['warn', 403],
      ['error', 500],
    ]);
  });

  it('logs a successful health probe at debug, so LOG_LEVEL=info keeps it out', () => {
    const h = harness('info');
    h.run({}, (req, res) => {
      req.route = { path: '/health/live' };
      res.end(200);
    });
    h.run({}, (req, res) => {
      req.route = { path: '/health/ready' };
      res.end(503);
    });
    expect(h.lines.map((l) => l.status)).toEqual([503]);
  });
});

describe('X-Request-Id', () => {
  it('honours an inbound id in an opaque shape and echoes it back', () => {
    const h = harness();
    const { res } = h.run({ headers: { 'x-request-id': UUID } }, (_req, r) => r.end(200));
    expect(h.lines[0].request_id).toBe(UUID);
    expect(res.headers['X-Request-Id']).toBe(UUID);
  });

  it('mints a fresh id when the client sent none', () => {
    const h = harness();
    const { res } = h.run({}, (_req, r) => r.end(200));
    expect(res.headers['X-Request-Id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(h.lines[0].request_id).toBe(res.headers['X-Request-Id']);
  });

  it.each([
    'my child is unwell',
    '+201001234567',
    '01001234567',
    'parent.one@example.com',
    'Layla-Example-Request',
    'x'.repeat(300),
  ])('replaces a header value that is not an opaque id: %s', (value) => {
    expect(acceptRequestId(value)).toBeUndefined();
    const h = harness();
    const { res } = h.run({ headers: { 'x-request-id': value } }, (_req, r) => r.end(200));
    expect(JSON.stringify(h.lines[0])).not.toContain(value);
    expect(res.headers['X-Request-Id']).not.toBe(value);
  });

  it('accepts the shapes an edge mints: UUID, ULID, hex trace id', () => {
    expect(acceptRequestId(UUID)).toBe(UUID);
    expect(acceptRequestId('01JABCDEFGHJKMNPQRSTVWXYZ0')).toBe('01JABCDEFGHJKMNPQRSTVWXYZ0');
    expect(acceptRequestId('4bf92f3577b34da6a3ce929d0e0e4736')).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });
});

describe('5xx and the error tracker', () => {
  it('reports a 5xx with the exception the handler threw, labelled with the template only', async () => {
    const h = harness();
    const interceptor = new RequestErrorCaptureInterceptor();
    const failure = new Error('boom');
    let request: FakeRequest | undefined;

    const { res } = h.run({ method: 'POST', originalUrl: `/api/v1/conversations/${UUID}/messages` }, (req) => {
      req.route = { path: '/api/v1/conversations/:id/messages' };
      req.actor = { kind: 'staff', actorId: 'staff-1', displayName: 'Someone Named' };
      request = req;
    });

    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => res }),
    } as unknown as ExecutionContext;
    await expect(
      firstValueFrom(interceptor.intercept(context, { handle: () => throwError(() => failure) })),
    ).rejects.toBe(failure);
    res.end(500);

    expect(h.captured).toHaveLength(1);
    expect(h.captured[0].error).toBe(failure);
    expect(h.captured[0].context).toEqual({
      route: 'POST /api/v1/conversations/:id/messages',
      requestId: h.lines[0].request_id,
      actorKind: 'staff',
      status: 500,
      component: 'api',
    });
  });

  it('reports a 5xx that left no exception behind as a fixed, content-free error', () => {
    const h = harness();
    h.run({}, (req, res) => {
      req.route = { path: '/api/v1/me' };
      res.end(503);
    });
    expect(h.captured).toHaveLength(1);
    expect((h.captured[0].error as Error).message).toBe('HTTP 503 with no captured exception');
  });

  it('does NOT report a 4xx — a refusal is the system working', () => {
    const h = harness();
    for (const status of [400, 401, 403, 404, 409, 429]) {
      h.run({}, (req, res) => {
        req.route = { path: '/api/v1/messages' };
        res.end(status);
      });
    }
    expect(h.captured).toHaveLength(0);
  });

  it('uses the status actually sent, not a guess from the exception', async () => {
    // CommErrorFilter turns a domain error into a 403; an interceptor that
    // guessed from the exception would have reported it as a 500.
    const h = harness();
    const interceptor = new RequestErrorCaptureInterceptor();
    let request: FakeRequest | undefined;
    const { res } = h.run({}, (req) => {
      req.route = { path: '/api/v1/messages' };
      request = req;
    });
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => res }),
    } as unknown as ExecutionContext;
    await expect(
      firstValueFrom(interceptor.intercept(context, { handle: () => throwError(() => new Error('domain')) })),
    ).rejects.toThrow();
    res.end(403);
    expect(h.lines[0]).toMatchObject({ status: 403, level: 'warn' });
    expect(h.captured).toHaveLength(0);
  });

  it('the capture interceptor passes a success through and ignores non-HTTP contexts', async () => {
    const interceptor = new RequestErrorCaptureInterceptor();
    const ws = { getType: () => 'ws' } as unknown as ExecutionContext;
    await expect(firstValueFrom(interceptor.intercept(ws, { handle: () => of('ok') }))).resolves.toBe('ok');
  });
});
