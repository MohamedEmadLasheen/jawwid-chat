/**
 * Error tracking, and what must never leave the process through it.
 *
 * This product carries children's and families' messages, and its rule is that
 * conversation content never leaves the systems that govern it. An error
 * tracker is the easiest place to break that by accident, because capturing
 * surrounding state is its default. Three groups here:
 *
 *   choosing a tracker   inert without SENTRY_DSN; the SDK never loaded then
 *   scrubEvent           the allowlist rebuild, asserted field by field
 *   a real SDK client    the SAME assertions against the bytes a real
 *                        @sentry/node client would put on the wire, via an
 *                        in-memory transport -- so a future SDK default that
 *                        attaches something new is caught here, not in Sentry
 */
import * as Sentry from '@sentry/node';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createErrorTracker, NoopErrorTracker } from '../../../src/infra/observability/error-tracker';
import {
  scrubEvent,
  sentryOptions,
  SentryErrorTracker,
} from '../../../src/infra/observability/sentry-error-tracker';
import { installProcessErrorHandlers } from '../../../src/infra/observability/process-errors';

const BUILD = { environment: 'test', commit: 'abc1234', version: '0.1.0', builtAt: '2026-10-20T00:00:00Z' };
// Not a real project: the in-memory transport below means nothing is sent.
const DSN = 'https://publickey@sentry.example.test/1';

/** Everything that must never appear in an event, in one place. */
const FORBIDDEN = [
  'ابني مريض اليوم', // a message body
  'Layla Example', // a name
  '201001234567', // a phone number
  '٠١٠٠١٢٣٤٥٦٧', // the same, in Arabic-Indic digits
  'parent.one@example.com',
  'eyJhbGciOiJIUzI1NiJ9', // a token
  'abcdef0123456789', // a media link signature (s=)
  'deadbeefcafef00d', // an X-Amz-Signature
  '7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b', // the object key / resolved path id
  'session=abc', // a cookie
];

const SIGNED_URL =
  'https://api.example.test/api/v1/media/attachments/7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b?e=1760000000&s=abcdef0123456789';

function expectClean(serialised: string): void {
  for (const value of FORBIDDEN) expect(serialised).not.toContain(value);
}

describe('choosing a tracker', () => {
  it('is inert with no DSN, which is every developer machine', () => {
    for (const env of [{}, { SENTRY_DSN: '' }, { SENTRY_DSN: '   ' }]) {
      const tracker = createErrorTracker('api', BUILD, env);
      expect(tracker).toBeInstanceOf(NoopErrorTracker);
      expect(tracker.isEnabled()).toBe(false);
      // It must never throw: a tracker that fails while reporting an error is
      // a second fault on the worst possible path.
      expect(() => tracker.captureException(new Error('boom'))).not.toThrow();
    }
  });

  it('reaches the SDK only through a lazy require, so an unconfigured process never loads it', () => {
    // Asserted against the SOURCE, because this spec imports the adapter
    // itself and so puts the SDK in the module cache whatever the factory does.
    const factory = readFileSync(join(__dirname, '../../../src/infra/observability/error-tracker.ts'), 'utf8');
    expect(factory).not.toMatch(/^\s*import .*@sentry\/node/m);
    expect(factory).toContain("require('./sentry-error-tracker')");

    for (const entrypoint of ['main.ts', 'worker.ts']) {
      const source = readFileSync(join(__dirname, '../../../src', entrypoint), 'utf8');
      expect(source).not.toContain('@sentry/node');
      expect(source).not.toContain('sentry-error-tracker');
      expect(source).toContain('createErrorTracker(');
      expect(source).toContain('installProcessErrorHandlers(');
    }
  });
});

describe('sentryOptions — layers 1 and 2', () => {
  const options = sentryOptions(DSN, 'api', BUILD);

  it('loads no default integration, and only an allowlist of three', () => {
    expect(options.defaultIntegrations).toBe(false);
    const names = (options.integrations as Array<{ name: string }>).map((i) => i.name).sort();
    expect(names).toEqual(['Context', 'Dedupe', 'LinkedErrors']);
  });

  it('sends no PII, traces nothing, keeps no breadcrumbs', () => {
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.tracesSampler).toBeUndefined();
    expect(options.maxBreadcrumbs).toBe(0);
    expect(options.beforeBreadcrumb?.({ message: 'x' }, undefined)).toBeNull();
    expect(options.release).toBe('abc1234');
    expect(options.environment).toBe('test');
  });
});

describe('scrubEvent — what must never reach Sentry', () => {
  const eventWith = (overrides: Partial<Sentry.ErrorEvent>): Sentry.ErrorEvent =>
    ({ type: undefined, event_id: 'e1', ...overrides }) as Sentry.ErrorEvent;

  it('has no request at all — body, query, cookies, headers, URL', () => {
    const scrubbed = scrubEvent(
      eventWith({
        request: {
          url: SIGNED_URL,
          method: 'POST',
          data: { body: 'ابني مريض اليوم' },
          cookies: { session: 'abc' },
          headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig', cookie: 'session=abc' },
          query_string: 'e=1760000000&s=abcdef0123456789',
        },
      }),
    );
    expect(scrubbed.request).toBeUndefined();
    expectClean(JSON.stringify(scrubbed));
  });

  it('drops the user, breadcrumbs, hostname, transaction, modules and request-derived metadata', () => {
    const scrubbed = scrubEvent(
      eventWith({
        user: { id: 'contact-1', email: 'parent.one@example.com', ip_address: '203.0.113.9', username: 'Layla Example' },
        breadcrumbs: [{ message: 'parent said: ابني مريض اليوم' }],
        server_name: 'api-7f3a',
        transaction: 'GET /api/v1/media/attachments/7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b',
        modules: { '@sentry/node': '10.76.0' },
        sdkProcessingMetadata: { normalizedRequest: { url: SIGNED_URL } },
        contexts: {
          runtime: { name: 'node', version: 'v24' },
          state: { state: { type: 'redux', value: { draft: 'ابني مريض اليوم' } } },
          response: { status_code: 500 },
        },
      }),
    );
    for (const key of ['user', 'breadcrumbs', 'server_name', 'transaction', 'modules', 'sdkProcessingMetadata']) {
      expect(scrubbed).not.toHaveProperty(key);
    }
    expect(Object.keys(scrubbed.contexts ?? {})).toEqual(['runtime']);
    expect(scrubbed.contexts?.runtime).toEqual({ name: 'node', version: 'v24' });
    expectClean(JSON.stringify(scrubbed));
  });

  it('strips local variables and source lines from every frame, keeping the location', () => {
    // LocalVariables is the single most dangerous default in the SDK for this
    // application: a local here is routinely a message body or a draft reply.
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
                    filename: '/app/dist/communication/messages/message.service.js',
                    function: 'MessageService.send',
                    lineno: 12,
                    colno: 3,
                    in_app: true,
                    vars: { body: 'ابني مريض اليوم', token: 'eyJhbGciOiJIUzI1NiJ9.a.b' },
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
    expect(frame).toEqual({
      filename: '/app/dist/communication/messages/message.service.js',
      function: 'MessageService.send',
      module: undefined,
      lineno: 12,
      colno: 3,
      in_app: true,
    });
    expectClean(JSON.stringify(scrubbed));
  });

  it('redacts secrets, phones, emails and signed URLs that reached a message or an exception value', () => {
    const scrubbed = scrubEvent(
      eventWith({
        message: 'auth failed for Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
        exception: {
          values: [
            { type: 'Error', value: `fetch ${SIGNED_URL} failed` },
            { type: 'Error', value: 'invalid contact +20 100 123 4567 / ٠١٠٠١٢٣٤٥٦٧ / parent.one@example.com' },
          ],
        },
      }),
    );
    expectClean(JSON.stringify(scrubbed));
    expect(scrubbed.exception!.values![0].value).toContain('https://api.example.test/[redacted-url]');
  });

  it('reduces a Prisma error to its class and code — Prisma prints the arguments it was given', () => {
    const original = Object.assign(
      new Error('Invalid `prisma.message.create()` invocation:\n{ data: { body: "ابني مريض اليوم" } }'),
      { name: 'PrismaClientKnownRequestError', code: 'P2003' },
    );
    const scrubbed = scrubEvent(
      eventWith({
        exception: {
          values: [
            { type: 'PrismaClientValidationError', value: 'body: "Layla Example"' },
            { type: 'PrismaClientKnownRequestError', value: original.message },
          ],
        },
      }),
      { originalException: original },
    );
    expect(scrubbed.exception!.values!.map((v) => v.value)).toEqual([
      'PrismaClientValidationError',
      'PrismaClientKnownRequestError P2003',
    ]);
    expectClean(JSON.stringify(scrubbed));
  });

  it('keeps only the tags and extra this application sets', () => {
    const scrubbed = scrubEvent(
      eventWith({
        tags: {
          route: 'POST /api/v1/conversations/:id/messages',
          status: '500',
          component: 'api',
          actor_kind: 'staff',
          url: SIGNED_URL,
          name: 'Layla Example',
        },
        extra: { request_id: '7f3a1b2c', body: 'ابني مريض اليوم', phone: '+201001234567' },
      }),
    );
    expect(scrubbed.tags).toEqual({
      route: 'POST /api/v1/conversations/:id/messages',
      status: '500',
      component: 'api',
      actor_kind: 'staff',
    });
    expect(scrubbed.extra).toEqual({ request_id: '7f3a1b2c' });
    expectClean(JSON.stringify(scrubbed));
  });

  it('survives an event with nothing in it', () => {
    expect(() => scrubEvent({ type: undefined, event_id: 'e' } as Sentry.ErrorEvent)).not.toThrow();
  });
});

describe('a real SDK client, on an in-memory transport', () => {
  const sent: string[] = [];
  let tracker: SentryErrorTracker;

  beforeAll(() => {
    tracker = new SentryErrorTracker(DSN, 'api', BUILD, {
      transport: (options) =>
        Sentry.createTransport(options, async (request) => {
          sent.push(typeof request.body === 'string' ? request.body : Buffer.from(request.body).toString('utf8'));
          return { statusCode: 200 };
        }),
    });
  });

  afterAll(async () => {
    await tracker.close(1000);
  });

  it('puts none of the forbidden values on the wire, whatever the scope carries', async () => {
    // Everything an SDK default or a careless caller could attach, attached.
    Sentry.setUser({ id: 'contact-1', email: 'parent.one@example.com', username: 'Layla Example' });
    Sentry.setExtra('draft', 'ابني مريض اليوم');
    Sentry.setTag('url', SIGNED_URL);
    Sentry.setContext('message', { body: 'ابني مريض اليوم', phone: '+201001234567' });
    Sentry.addBreadcrumb({ message: 'parent typed ابني مريض اليوم', data: { phone: '+201001234567' } });
    Sentry.getIsolationScope().setSDKProcessingMetadata({
      normalizedRequest: { url: SIGNED_URL, headers: { cookie: 'session=abc' }, data: 'ابني مريض اليوم' },
    });

    const cause = new Error('upstream said: ٠١٠٠١٢٣٤٥٦٧');
    const error = new Error(`send to +201001234567 failed for parent.one@example.com at ${SIGNED_URL}`, { cause });
    const body = 'ابني مريض اليوم'; // a local the LocalVariables integration would have attached
    void body;

    tracker.captureException(error, {
      route: 'POST /api/v1/conversations/:id/messages',
      requestId: '4bf92f3577b34da6a3ce929d0e0e4736',
      actorKind: 'contact',
      status: 500,
      component: 'api',
    });
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    const wire = sent.join('\n');
    expectClean(wire);
    // And the useful half did arrive.
    expect(wire).toContain('POST /api/v1/conversations/:id/messages');
    expect(wire).toContain('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(wire).toContain('[redacted-phone]');
    expect(wire).toContain('"release":"abc1234"');
  });
});

describe('process-level handlers', () => {
  // Emitted directly, so the handlers run without a real crash.
  const emit = process.emit.bind(process) as unknown as (event: string, ...args: unknown[]) => boolean;

  function install() {
    const logged: string[] = [];
    const captured: Array<{ error: unknown; route?: string }> = [];
    const exits: number[] = [];
    const uninstall = installProcessErrorHandlers(
      {
        name: 'fake',
        isEnabled: () => true,
        captureException: (error, context) => captured.push({ error, route: context?.route }),
        close: async () => undefined,
      },
      { error: (m: string) => logged.push(m) },
      { exit: (code) => exits.push(code), flushTimeoutMs: 10 },
    );
    return { logged, captured, exits, uninstall };
  }

  it('reports an unhandled rejection and keeps the process running', () => {
    const h = install();
    try {
      emit('unhandledRejection', new Error('stray for +201001234567'), Promise.resolve());
      expect(h.captured).toEqual([{ error: expect.any(Error), route: 'process.unhandledRejection' }]);
      expect(h.logged).toEqual(['unhandled rejection: stray for [redacted-phone]']);
      expect(h.exits).toEqual([]);
    } finally {
      h.uninstall();
    }
  });

  it('reports an uncaught exception, flushes, then exits 1 — as Node would have', async () => {
    const h = install();
    try {
      emit('uncaughtException', new Error('detached callback failed'), 'uncaughtException');
      await new Promise((resolve) => setImmediate(resolve));
      expect(h.captured.map((c) => c.route)).toEqual(['process.uncaughtException']);
      expect(h.logged).toEqual(['uncaught exception: detached callback failed']);
      expect(h.exits).toEqual([1]);
    } finally {
      h.uninstall();
    }
  });

  it('logs a Prisma error by class and code only', () => {
    const h = install();
    try {
      const prisma = Object.assign(new Error('Invalid `prisma.contact.update()` invocation: { phone: "+201001234567" }'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
      });
      emit('unhandledRejection', prisma, Promise.resolve());
      expect(h.logged).toEqual(['unhandled rejection: PrismaClientKnownRequestError P2025']);
    } finally {
      h.uninstall();
    }
  });
});
