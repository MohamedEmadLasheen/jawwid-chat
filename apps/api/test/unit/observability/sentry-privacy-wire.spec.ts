/**
 * The privacy guarantee, measured where it matters: the bytes a real
 * @sentry/node client would send.
 *
 * Children's and parents' names, chat content (Arabic and English), email
 * addresses, phone numbers, tokens, a password and a card number are planted
 * in every place an error report could pick them up -- the error message, its
 * cause, its name, its own properties, a Prisma error's arguments, a thrown
 * non-Error, the SDK scope, a captured message, the labels the application
 * passes, a WebSocket frame and an HTTP request -- and then the WHOLE
 * serialized envelope stream is searched for every one of them. A pattern
 * cannot recognise a name or a sentence, so the guarantee is structural: the
 * event carries no free text at all. Every value below is synthetic.
 *
 * The useful half is asserted too: the class, the approved code, the route
 * template and the stack frames still arrive.
 */
import * as Sentry from '@sentry/node';
import { Prisma } from '@prisma/client';
import { EventEmitter } from 'node:events';
import { InternalServerErrorException, type ArgumentsHost } from '@nestjs/common';
import { WsExceptionsHandler } from '@nestjs/websockets/exceptions/ws-exceptions-handler';
import { SentryErrorTracker } from '../../../src/infra/observability/sentry-error-tracker';
import { ErrorBudget } from '../../../src/infra/observability/error-budget';
import { WsErrorReportFilter } from '../../../src/infra/observability/ws-error-report.filter';
import { requestLogMiddleware } from '../../../src/infra/observability/request-log';
import { JsonLogger } from '../../../src/infra/observability/json-logger';
import { installProcessErrorHandlers } from '../../../src/infra/observability/process-errors';
import { PackageRefused } from '../../../src/materials/package-validation';
import { CoreRetryLater } from '../../../src/core-boundary/core-ingest.service';
import { HttpServerError } from '../../../src/infra/observability/request-log';

/** Every value that must never appear on the wire. All synthetic. */
const CHILD_NAMES = ['Layla Example', 'Yusuf Example', 'ليلى', 'يوسف'];
const PARENT_NAMES = ['Omar Parent', 'Mariam Parent', 'عمر', 'سلمى'];
const EMAILS = ['omar.parent@example.com', 'mariam.parent@example.org'];
const CHAT = [
  'my son is sick today and will miss class',
  'please send the homework',
  'ابني مريض اليوم ولن يحضر الدرس',
  'أرسلي الواجب من فضلك',
];
const PHONES = ['+201001234567', '٠١٠٠١٢٣٤٥٦٧', '01001234567'];
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjb250YWN0LTEifQ.c2lnbmF0dXJlLWV4YW1wbGU';
const TOKENS = [JWT, 'rt_9f8e7d6c5b4a39281706aa', 'P@ssw0rd-Example!'];
const PAYMENT = ['4242424242424242', 'cus_ExampleCustomer01'];
const FORBIDDEN = [...CHILD_NAMES, ...PARENT_NAMES, ...EMAILS, ...CHAT, ...PHONES, ...TOKENS, ...PAYMENT];

/** Words of the sentences and names, so a fragment is caught too, not just the whole string. */
const FRAGMENTS = ['Layla', 'Yusuf', 'Omar', 'Mariam', 'sick', 'homework', 'مريض', 'الواجب', 'Bearer', 'P@ssw0rd'];

const sentence = (i: number) =>
  `${CHILD_NAMES[i % 4]} (parent ${PARENT_NAMES[i % 4]}, ${EMAILS[i % 2]}, ${PHONES[i % 3]}) wrote "${CHAT[i % 4]}" ` +
  `with Bearer ${JWT}, password ${TOKENS[2]}, card ${PAYMENT[0]}`;

describe('nothing personal reaches the Sentry wire', () => {
  const sent: string[] = [];
  let tracker: SentryErrorTracker;
  const wire = () => sent.join('\n');

  beforeAll(() => {
    tracker = new SentryErrorTracker(
      'https://publickey@sentry.example.test/1',
      'api',
      { environment: 'test', commit: 'abc1234', version: '0.1.0' },
      {
        transport: (options) =>
          Sentry.createTransport(options, async (request) => {
            sent.push(typeof request.body === 'string' ? request.body : Buffer.from(request.body).toString('utf8'));
            return { statusCode: 200 };
          }),
      },
      // No volume cap here: every case must reach the wire to be checked.
      new ErrorBudget({ perKeyIntervalMs: 0, globalLimit: 1_000_000 }),
    );
  });

  afterAll(async () => {
    await Sentry.flush(2000);
    const all = wire();
    // The final, whole-stream check: every case above, every byte.
    expect(sent.length).toBeGreaterThanOrEqual(12);
    for (const value of [...FORBIDDEN, ...FRAGMENTS]) expect(all).not.toContain(value);
    await tracker.close(1000);
  });

  async function flushed(): Promise<string> {
    await Sentry.flush(2000);
    return wire();
  }

  function expectNothingPersonal(text: string): void {
    for (const value of [...FORBIDDEN, ...FRAGMENTS]) expect(text).not.toContain(value);
  }

  it('in the error message and its cause chain', async () => {
    const cause = new Error(sentence(1));
    const error = new TypeError(sentence(2), { cause });
    tracker.captureException(error, { route: 'POST /api/v1/conversations/:id/messages', status: 500, component: 'api' });
    const text = await flushed();
    expectNothingPersonal(text);
    expect(text).toContain('"type":"TypeError"');
    expect(text).toContain('POST /api/v1/conversations/:id/messages');
    expect(text).toContain('sentry-privacy-wire.spec'); // the stack frames still arrive
  });

  it('in an error name, and in the error object’s own properties', async () => {
    const error = Object.assign(new Error(sentence(3)), {
      name: 'Layla Example',
      body: CHAT[2],
      parent: { name: PARENT_NAMES[0], email: EMAILS[0], phone: PHONES[0] },
      code: 'Mariam Parent',
      response: { message: CHAT[0] },
    });
    tracker.captureException(error, { route: 'outbox.drain', component: 'worker' });
    const text = await flushed();
    expectNothingPersonal(text);
    // A name that is not an identifier is not a class name.
    expect(text).toContain('"type":"Error"');
  });

  it('in ONE-WORD values, which pass any merely identifier-shaped check', async () => {
    // Codex review: a single word is an identifier, a label and a lowercase word.
    const before = sent.length;
    for (const word of ['Layla', 'Yusuf', 'ليلى', 'Omar']) {
      tracker.captureException(Object.assign(new Error('failure'), { name: word }), {
        route: word,
        actorKind: word.toLowerCase(),
        component: word.toLowerCase(),
      });
      tracker.captureException(new Error('failure'), { route: `WS ${word}` });
      tracker.captureException(new Error('failure'), { route: `${word.toLowerCase()}` });
    }
    await flushed();
    const text = sent.slice(before).join('\n');
    expect(sent.length - before).toBeGreaterThanOrEqual(12);
    expectNothingPersonal(text);
    expect(text).not.toContain('"route"'); // none of those labels was a route
    expect(text).not.toContain('"actor_kind"');
    expect(text).not.toContain('"component"');
  });

  it('in a name that merely LOOKS like an error class', async () => {
    // Codex review: `LaylaError` passes any suffix check. The type is the
    // constructor's name, so a writable `error.name` never reaches the wire.
    const before = sent.length;
    for (const name of ['LaylaError', 'OmarException', 'YusufRefusal', 'MariamRefused', 'ليلىError']) {
      tracker.captureException(Object.assign(new Error('failure'), { name }), { route: 'outbox.drain', component: 'worker' });
      tracker.captureException(Object.assign(new TypeError('failure'), { name }), { route: 'outbox.drain', component: 'worker' });
    }
    // Codex review: nor does an own `constructor` property shadowing the class.
    for (const name of ['LaylaError', 'ليلىError']) {
      const shadowed = Object.assign(new RangeError('failure'), { constructor: { name } });
      tracker.captureException(shadowed, { route: 'outbox.drain', component: 'worker' });
      const fake = Object.assign(new Error('failure'), { name });
      Object.defineProperty(fake, 'constructor', { value: function LaylaError() {} });
      tracker.captureException(fake, { route: 'outbox.drain', component: 'worker' });
    }
    await flushed();
    const text = sent.slice(before).join('\n');
    expectNothingPersonal(text);
    expect(text).toContain('"type":"Error"');
    expect(text).toContain('"type":"TypeError"');
    expect(text).toContain('"type":"RangeError"');
  });

  it('keeps the error classes this codebase actually throws', async () => {
    const before = sent.length;
    class SeedRefusal extends Error {}
    const errors = [
      new PackageRefused(sentence(0)),
      new CoreRetryLater(sentence(1)),
      new SeedRefusal(sentence(2)),
      new HttpServerError(503),
      new RangeError(sentence(3)),
    ];
    for (const e of errors) tracker.captureException(e, { route: 'outbox.drain', component: 'worker' });
    await flushed();
    const text = sent.slice(before).join('\n');
    expectNothingPersonal(text);
    for (const name of ['PackageRefused', 'CoreRetryLater', 'SeedRefusal', 'HttpServerError', 'RangeError']) {
      expect(text).toContain(`"type":"${name}"`);
    }
    expect(text).toContain('HttpServerError status=503');
    expect(text).toContain('"route":"outbox.drain"');
  });

  it('in a Prisma error, which prints the arguments it was given', async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      `Invalid \`prisma.message.create()\` invocation:\n{ data: { body: "${CHAT[2]}", author: "${PARENT_NAMES[2]}" } }\nUnique constraint failed on the fields: (\`email\`) Key (email)=(${EMAILS[0]})`,
      { code: 'P2002', clientVersion: '6.0.0', meta: { target: ['email'], modelName: 'Contact', value: CHILD_NAMES[0] } },
    );
    tracker.captureException(error, { route: 'POST /api/v1/conversations/:id/messages', status: 500 });
    const text = await flushed();
    expectNothingPersonal(text);
    expect(text).toContain('PrismaClientKnownRequestError P2002');
  });

  it('in a thrown string and a thrown plain object', async () => {
    tracker.captureException(sentence(0), { route: 'process.unhandledRejection' });
    tracker.captureException({ message: sentence(1), child: CHILD_NAMES[1], chat: CHAT[3] }, { route: 'process.unhandledRejection' });
    expectNothingPersonal(await flushed());
  });

  it('in an HttpException whose response body carries text', async () => {
    tracker.captureException(new InternalServerErrorException({ message: sentence(2), child: CHILD_NAMES[0] }), {
      route: 'GET /api/v1/me',
      status: 500,
    });
    const text = await flushed();
    expectNothingPersonal(text);
    expect(text).toContain('InternalServerErrorException status=500');
  });

  it('in everything the SDK scope could carry', async () => {
    Sentry.setUser({ id: 'contact-1', email: EMAILS[1], username: CHILD_NAMES[1], ip_address: '203.0.113.9' });
    Sentry.setTag('route', CHILD_NAMES[0]);
    Sentry.setTag('actor_kind', PARENT_NAMES[1]);
    Sentry.setTag('child', CHILD_NAMES[2]);
    Sentry.setExtra('draft', CHAT[1]);
    Sentry.setExtra('request_id', PARENT_NAMES[0]);
    Sentry.setContext('message', { body: CHAT[2], phone: PHONES[1] });
    Sentry.setContext('runtime', { name: CHILD_NAMES[3], version: CHAT[0] });
    Sentry.addBreadcrumb({ message: CHAT[0], data: { phone: PHONES[0] } });
    Sentry.getCurrentScope().setFingerprint([CHILD_NAMES[0]]);
    try {
      tracker.captureException(new Error('plain'), {});
      expectNothingPersonal(await flushed());
    } finally {
      Sentry.getCurrentScope().clear();
      Sentry.getIsolationScope().clear();
      Sentry.getGlobalScope().clear();
    }
  });

  it('in a message captured directly through the SDK, bypassing the tracker', async () => {
    Sentry.captureMessage(sentence(1));
    Sentry.captureException(new Error(sentence(3)));
    expectNothingPersonal(await flushed());
  });

  it('in the labels the application passes', async () => {
    tracker.captureException(new Error('x'), {
      route: `GET /api/v1/children/${CHILD_NAMES[0]}`,
      actorKind: PARENT_NAMES[0],
      requestId: EMAILS[0],
      component: CHAT[0],
    });
    tracker.captureException(new Error('y'), { route: CHAT[2] });
    expectNothingPersonal(await flushed());
  });

  it('in a WebSocket frame, its socket and its handshake', async () => {
    const client = {
      id: 'sock-1',
      handshake: { auth: { token: JWT }, headers: { authorization: `Bearer ${JWT}` } },
      actor: { actorId: 'contact-1', displayName: PARENT_NAMES[1] },
      emit: () => undefined,
    };
    const data = { conversationId: '7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b', body: CHAT[2], child: CHILD_NAMES[2] };
    const host = {
      getType: () => 'ws',
      getArgs: () => [client, data],
      getArgByIndex: (i: number) => [client, data][i],
      switchToWs: () => ({ getClient: () => client, getData: () => data, getPattern: () => 'conversation.subscribe' }),
    } as unknown as ArgumentsHost;
    const handler = new WsExceptionsHandler();
    const filter = new WsErrorReportFilter(() => tracker);
    handler.setCustomFilters([{ func: filter.catch.bind(filter), exceptionMetatypes: [] }] as never);
    const quiet = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      handler.handle(new Error(sentence(0)), host);
    } finally {
      quiet.mockRestore();
    }
    const text = await flushed();
    expectNothingPersonal(text);
    expect(text).toContain('WS conversation.subscribe');
  });

  it('in an HTTP request: body, query string, headers and actor', async () => {
    const logger = new JsonLogger('api', { environment: 'test', commit: 'abc1234', version: '0.1.0', builtAt: 't' }, () => undefined);
    const middleware = requestLogMiddleware(logger, tracker);
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      writableFinished: false,
      setHeader: () => undefined,
    });
    const req = {
      method: 'POST',
      originalUrl: `/api/v1/conversations?q=${encodeURIComponent(CHILD_NAMES[0])}`,
      headers: { authorization: `Bearer ${JWT}`, cookie: `session=${TOKENS[1]}`, 'x-request-id': EMAILS[0] },
      body: { body: CHAT[0], card: PAYMENT[0] },
      route: { path: '/api/v1/conversations/:id/messages' },
      actor: { kind: 'contact', actorId: 'contact-1', displayName: PARENT_NAMES[0] },
    };
    middleware(req as never, res as never, () => undefined);
    res.statusCode = 500;
    res.writableFinished = true;
    res.emit('finish');
    const text = await flushed();
    expectNothingPersonal(text);
    expect(text).toContain('HttpServerError status=500');
  });

  it('in an unhandled rejection reaching the process handler', async () => {
    const uninstall = installProcessErrorHandlers(tracker, { error: () => undefined }, { exit: () => undefined });
    try {
      (process.emit as unknown as (e: string, ...a: unknown[]) => boolean)('unhandledRejection', new Error(sentence(2)), Promise.resolve());
    } finally {
      uninstall();
    }
    expectNothingPersonal(await flushed());
  });
});
