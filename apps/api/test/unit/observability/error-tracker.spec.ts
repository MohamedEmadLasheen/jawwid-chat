import type { ErrorEvent } from '@sentry/node';
import { NoopErrorTracker, createErrorTracker } from '../../../src/infra/observability/error-tracker';
import { scrubEvent } from '../../../src/infra/observability/sentry-error-tracker';
import { RequestLogInterceptor } from '../../../src/infra/observability/request-log.interceptor';
import { JsonLogger } from '../../../src/infra/observability/json-logger';
import { throwError } from 'rxjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUILD = { environment: 'test', commit: 'abc1234', version: '0.1.0', builtAt: '2026-09-08T00:00:00Z' };

describe('choosing a tracker', () => {
  const previous = process.env.SENTRY_DSN;
  afterEach(() => {
    if (previous === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previous;
  });

  it('is inert with no DSN, which is every developer machine', () => {
    delete process.env.SENTRY_DSN;
    const tracker = createErrorTracker('api', BUILD);
    expect(tracker.name).toBe('noop');
    expect(tracker.isEnabled()).toBe(false);
    // And it must never throw: an error tracker that fails while reporting an
    // error is a second fault on the worst possible path.
    expect(() => tracker.captureException(new Error('boom'))).not.toThrow();
  });

  it('reaches the SDK only through a lazy require, so an unconfigured process never loads it', () => {
    // Asserted against the SOURCE rather than the module cache, because this
    // spec imports the adapter itself in order to test scrubEvent -- which puts
    // the SDK in the cache no matter how the factory behaves.
    //
    // The property that matters is structural: the module main.ts and worker.ts
    // import must not pull in @sentry/node, so a developer machine pays none of
    // its instrumentation, global handlers or footprint.
    const factory = readFileSync(
      join(__dirname, '../../../src/infra/observability/error-tracker.ts'),
      'utf8',
    );
    expect(factory).not.toMatch(/^\s*import .*@sentry\/node/m);
    expect(factory).toContain("require('./sentry-error-tracker')");

    for (const entrypoint of ['main.ts', 'worker.ts']) {
      const source = readFileSync(join(__dirname, '../../../src', entrypoint), 'utf8');
      expect(source).not.toContain('@sentry/node');
      expect(source).not.toContain('sentry-error-tracker');
    }
  });
});

/**
 * The privacy backstop.
 *
 * This product's rule is that conversation content never leaves the systems
 * that govern it, and an error tracker is the easiest place in a codebase to
 * break that rule by accident. `scrubEvent` is the last thing that runs before
 * an event is transmitted, and it is written to be sufficient ALONE -- so these
 * assertions do not depend on any integration being correctly disabled.
 */
describe('scrubEvent -- what must never reach Sentry', () => {
  const eventWith = (overrides: Partial<ErrorEvent>): ErrorEvent =>
    ({ event_id: 'e1', ...overrides }) as ErrorEvent;

  it('deletes the request wholesale -- body, query, cookies and headers', () => {
    const event = eventWith({
      request: {
        url: 'https://api/conversations/7f3a/messages?q=my+secret+search',
        method: 'POST',
        data: { body: 'المدرس لم يحضر اليوم' },
        cookies: { session: 'abc' },
        headers: { authorization: 'Bearer eyJhbGciOi.payload.sig' },
        query_string: 'q=my+secret+search',
      },
    });

    const scrubbed = scrubEvent(event);

    // Deleted rather than filtered: an allowlist of safe request fields is a
    // list somebody eventually adds `body` to.
    expect(scrubbed.request).toBeUndefined();
    expect(JSON.stringify(scrubbed)).not.toContain('المدرس');
    expect(JSON.stringify(scrubbed)).not.toContain('my+secret+search');
    expect(JSON.stringify(scrubbed)).not.toContain('Bearer');
  });

  it('drops the user, the breadcrumbs and the hostname', () => {
    const scrubbed = scrubEvent(
      eventWith({
        user: { id: 'staff-1', email: 'someone@example.com', ip_address: '1.2.3.4' },
        breadcrumbs: [{ message: 'parent said: we are stopping the lessons' }],
        server_name: 'api-7f3a',
      }),
    );
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
    expect(JSON.stringify(scrubbed)).not.toContain('stopping the lessons');
  });

  it('strips local variables from every stack frame', () => {
    // The single most dangerous default in the SDK for this application: in
    // this codebase a local is routinely a message body or a drafted reply.
    const scrubbed = scrubEvent(
      eventWith({
        exception: {
          values: [
            {
              type: 'Error',
              value: 'failed',
              stacktrace: {
                frames: [
                  {
                    filename: 'message.service.ts',
                    vars: { body: 'نعتذر عن التأخير', token: 'eyJhbGciOi.a.b' },
                    pre_context: ['const body = input.body;'],
                    context_line: 'throw new Error(body)',
                    post_context: ['}'],
                  },
                ],
              },
            },
          ],
        },
      }),
    );

    const frame = scrubbed.exception!.values![0].stacktrace!.frames![0];
    expect(frame.vars).toBeUndefined();
    expect(frame.pre_context).toBeUndefined();
    expect(frame.context_line).toBeUndefined();
    expect(frame.post_context).toBeUndefined();
    // The filename survives, because that is the useful half.
    expect(frame.filename).toBe('message.service.ts');
  });

  it('redacts secrets that reached an exception MESSAGE', () => {
    // Free-form messages are written all over a codebase and cannot be
    // prevented from containing a token. They go through the same redact() the
    // log store uses, so the two never disagree about what a secret looks like.
    const scrubbed = scrubEvent(
      eventWith({
        message: 'auth failed for Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
        exception: {
          values: [
            { type: 'Error', value: 'connect postgres://user:hunter2@db:5432 failed' },
          ],
        },
      }),
    );

    expect(scrubbed.message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(scrubbed.exception!.values![0].value).not.toContain('hunter2');
  });

  it('redacts a phone number wherever it appears', () => {
    // A contact channel outside Jawwid is exactly what the product exists to
    // keep inside it.
    const scrubbed = scrubEvent(
      eventWith({
        exception: { values: [{ type: 'Error', value: 'invalid contact +20 100 123 4567' }] },
        extra: { note: 'called 01001234567 twice' },
      }),
    );
    expect(scrubbed.exception!.values![0].value).not.toContain('100 123 4567');
    expect(String(scrubbed.extra!.note)).not.toContain('01001234567');
  });

  it('survives an event with nothing in it', () => {
    expect(() => scrubEvent({ event_id: 'e' } as ErrorEvent)).not.toThrow();
  });
});

describe('what actually gets reported', () => {
  function drive(status: number) {
    const captured: Array<{ error: unknown; context: Record<string, unknown> }> = [];
    const tracker = {
      name: 'fake',
      isEnabled: () => true,
      captureException: (error: unknown, context: Record<string, unknown>) =>
        captured.push({ error, context }),
      close: async () => {},
    };
    const interceptor = new RequestLogInterceptor(new JsonLogger('api', BUILD), tracker);

    const request = {
      method: 'POST',
      originalUrl: '/api/v1/conversations/7f3a2b1c-0000-4000-8000-000000000000/messages',
      headers: {},
      actor: { kind: 'staff' },
    };
    const response = { statusCode: status, setHeader: () => {} };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as never;

    const failure = Object.assign(new Error('boom'), { status });
    const handler = { handle: () => throwError(() => failure) } as never;

    return new Promise<typeof captured>((resolve) => {
      interceptor.intercept(context, handler).subscribe({
        error: () => resolve(captured),
      });
    });
  }

  it('reports a 5xx', async () => {
    const captured = await drive(500);
    expect(captured).toHaveLength(1);
    expect(captured[0].context).toMatchObject({
      status: 500,
      actorKind: 'staff',
      component: 'api',
    });
  });

  it('does NOT report a 4xx', async () => {
    // A 403 from the authorization service is the system WORKING -- refusals
    // are the most common outcome on several of these routes, and reporting
    // them would bury the one real fault of the day under correct denials.
    for (const status of [400, 403, 404, 409, 429]) {
      expect(await drive(status)).toHaveLength(0);
    }
  });

  it('reports the route PATTERN, never the resolved URL', async () => {
    const captured = await drive(500);
    const route = String(captured[0].context.route);
    // The uuid is masked, so an id nobody meant to publish does not become a
    // Sentry tag -- and the tag aggregates, which is the other half of the point.
    expect(route).toBe('POST /api/v1/conversations/:id/messages');
    expect(route).not.toContain('7f3a2b1c');
  });

  it('carries a request id so an event joins the log line for the same failure', async () => {
    const captured = await drive(500);
    expect(captured[0].context.requestId).toEqual(expect.any(String));
  });
});
