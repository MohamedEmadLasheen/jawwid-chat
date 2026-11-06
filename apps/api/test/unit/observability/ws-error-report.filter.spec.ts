/**
 * Unexpected WebSocket handler errors reach the error tracker -- the frame they
 * came with never does -- and the client is answered exactly as before.
 *
 * Driven through Nest's own WsExceptionsHandler with the filters the gateway
 * declares, so this is the path a real `conversation.subscribe` throw takes,
 * not a direct call to `catch`. The last group puts a real @sentry/node client
 * behind it and reads the wire.
 */
import 'reflect-metadata';
import * as Sentry from '@sentry/node';
import { ArgumentsHost, ForbiddenException, InternalServerErrorException, IntrinsicException } from '@nestjs/common';
import { EXCEPTION_FILTERS_METADATA } from '@nestjs/common/constants';
import { WsException } from '@nestjs/websockets';
import { WsExceptionsHandler } from '@nestjs/websockets/exceptions/ws-exceptions-handler';
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';
import {
  isUnexpectedWsError,
  wsEventLabel,
  WsErrorReportFilter,
} from '../../../src/infra/observability/ws-error-report.filter';
import type { ErrorContext, ErrorTracker } from '../../../src/infra/observability/error-tracker';
import { SentryErrorTracker } from '../../../src/infra/observability/sentry-error-tracker';

const MESSAGE_BODY = 'ابني مريض اليوم';
const CONVERSATION_ID = '7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjb250YWN0In0.c2lnbmF0dXJl';

function fakeTracker() {
  const captured: Array<{ error: unknown; context?: ErrorContext }> = [];
  const tracker: ErrorTracker = {
    name: 'fake',
    isEnabled: () => true,
    captureException: (error, context) => captured.push({ error, context }),
    close: async () => undefined,
  };
  return { tracker, captured };
}

function fakeClient() {
  return {
    id: 'sock-1',
    handshake: { auth: { token: TOKEN }, headers: { authorization: `Bearer ${TOKEN}` } },
    actor: { actorId: 'contact-1', displayName: 'Layla Example' },
    emit: jest.fn(),
  };
}

function host(client: unknown, pattern: unknown = 'conversation.subscribe'): ArgumentsHost {
  const data = { conversationId: CONVERSATION_ID, body: MESSAGE_BODY };
  return {
    getType: () => 'ws',
    getArgs: () => [client, data],
    getArgByIndex: (i: number) => [client, data][i],
    switchToWs: () => ({ getClient: () => client, getData: () => data, getPattern: () => pattern }),
    switchToHttp: () => { throw new Error('not http'); },
    switchToRpc: () => { throw new Error('not rpc'); },
  } as unknown as ArgumentsHost;
}

/** The handler Nest builds for a gateway that declares `filters`. */
function nestHandler(filters: unknown[]): WsExceptionsHandler {
  const handler = new WsExceptionsHandler();
  handler.setCustomFilters(
    filters.map((f) => ({ func: (f as WsErrorReportFilter).catch.bind(f), exceptionMetatypes: [] })) as never,
  );
  return handler;
}

/** What the client receives from Nest's default handler, for comparison. */
function defaultEmit(exception: unknown): unknown[][] {
  const client = fakeClient();
  new WsExceptionsHandler().handle(exception as Error, host(client));
  return client.emit.mock.calls;
}

describe('the gateway declares the filter', () => {
  it('RealtimeGateway carries a WsErrorReportFilter — Nest applies no global filter to gateways', () => {
    const filters = Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, RealtimeGateway) as unknown[];
    expect(filters.some((f) => f instanceof WsErrorReportFilter)).toBe(true);
  });
});

describe('WsErrorReportFilter — what is reported', () => {
  beforeEach(() => {
    // BaseWsExceptionFilter logs unknown errors; keep the test output clean.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reports an unexpected handler error once, labelled with the event name only', () => {
    const { tracker, captured } = fakeTracker();
    const failure = Object.assign(new Error('db down'), { name: 'PrismaClientKnownRequestError', code: 'P1001' });
    nestHandler([new WsErrorReportFilter(() => tracker)]).handle(failure, host(fakeClient()));

    expect(captured).toHaveLength(1);
    expect(captured[0].error).toBe(failure);
    expect(captured[0].context).toEqual({ route: 'WS conversation.subscribe', component: 'api' });
  });

  it('hands the tracker nothing from the frame, the socket or its handshake', () => {
    const { tracker, captured } = fakeTracker();
    nestHandler([new WsErrorReportFilter(() => tracker)]).handle(new Error('boom'), host(fakeClient()));
    const handed = JSON.stringify(captured.map((c) => c.context));
    for (const forbidden of [MESSAGE_BODY, CONVERSATION_ID, TOKEN, 'Layla Example', 'contact-1', 'sock-1']) {
      expect(handed).not.toContain(forbidden);
    }
  });

  it('does NOT report a refusal: WsException, an HttpException below 500, an IntrinsicException', () => {
    const { tracker, captured } = fakeTracker();
    const handler = nestHandler([new WsErrorReportFilter(() => tracker)]);
    for (const refusal of [new WsException('COMM.FORBIDDEN'), new ForbiddenException(), new IntrinsicException('quiet')]) {
      handler.handle(refusal, host(fakeClient()));
    }
    expect(captured).toHaveLength(0);
  });

  it('does report an HttpException of 500 or above thrown from a handler', () => {
    expect(isUnexpectedWsError(new InternalServerErrorException())).toBe(true);
    expect(isUnexpectedWsError(new TypeError('x'))).toBe(true);
    expect(isUnexpectedWsError('a thrown string')).toBe(true);
  });

  it('labels an odd event name with a fixed label, never the text', () => {
    expect(wsEventLabel('typing.start')).toBe('typing.start');
    expect(wsEventLabel(`hello ${MESSAGE_BODY}`)).toBe('<unknown>');
    expect(wsEventLabel('x'.repeat(65))).toBe('<unknown>');
    expect(wsEventLabel({ cmd: 'x' })).toBe('<unknown>');
    expect(wsEventLabel(undefined)).toBe('<unknown>');
  });
});

describe('WsErrorReportFilter — the client is answered exactly as before', () => {
  beforeEach(() => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['an unknown error', () => new Error('boom')],
    ['a WsException with a string', () => new WsException('COMM.FORBIDDEN')],
    ['a WsException with an object', () => new WsException({ code: 'COMM.FORBIDDEN' })],
    ['an HttpException', () => new ForbiddenException()],
  ])('%s: the same exception frame as Nest’s default handler', (_label, make) => {
    const { tracker } = fakeTracker();
    const client = fakeClient();
    nestHandler([new WsErrorReportFilter(() => tracker)]).handle(make(), host(client));
    expect(client.emit.mock.calls).toEqual(defaultEmit(make()));
  });

  it('a tracker that throws does not stop the client being answered', () => {
    const throwing: ErrorTracker = {
      name: 'broken',
      isEnabled: () => true,
      captureException: () => { throw new Error('tracker exploded'); },
      close: async () => undefined,
    };
    const client = fakeClient();
    expect(() => nestHandler([new WsErrorReportFilter(() => throwing)]).handle(new Error('boom'), host(client))).not.toThrow();
    expect(client.emit).toHaveBeenCalledTimes(1);
  });

  it('a client with no emit (already gone) is reported, and nothing throws', () => {
    const { tracker, captured } = fakeTracker();
    const gone = { id: 'sock-2' };
    expect(() => new WsErrorReportFilter(() => tracker).catch(new Error('late'), host(gone))).not.toThrow();
    expect(captured).toHaveLength(1);
  });
});

describe('WsErrorReportFilter — measured on the wire', () => {
  const sent: string[] = [];
  let tracker: SentryErrorTracker;

  beforeAll(() => {
    tracker = new SentryErrorTracker('https://publickey@sentry.example.test/1', 'api', { environment: 'test', commit: 'abc1234', version: '0.1.0' }, {
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
  beforeEach(() => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('the event carries the label and the class, and none of the frame, socket or token', async () => {
    // The message itself goes through redact(); the frame is never attached at all.
    const failure = new Error('subscribe failed for parent.one@example.com at +201001234567');
    nestHandler([new WsErrorReportFilter(() => tracker)]).handle(failure, host(fakeClient()));
    await Sentry.flush(2000);

    const wire = sent.join('\n');
    expect(wire).toContain('WS conversation.subscribe');
    for (const forbidden of [MESSAGE_BODY, CONVERSATION_ID, TOKEN, 'Layla Example', 'contact-1', 'parent.one@example.com', '201001234567']) {
      expect(wire).not.toContain(forbidden);
    }
  });
});
