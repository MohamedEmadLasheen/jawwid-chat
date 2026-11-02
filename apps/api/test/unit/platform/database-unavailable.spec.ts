/**
 * TEACHER-027: a database that could not serve the request in time is a
 * retryable 503 with Retry-After, never a bare 500. Every other error keeps
 * Nest's default handling (a 500, logged with its stack).
 */
import { ArgumentsHost, Controller, Get, INestApplication, Logger, Module } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { CommError, CommErrorCode } from '../../../src/platform/errors';
import { CommErrorFilter } from '../../../src/communication/api/http-exception.filter';
import { Prisma } from '@prisma/client';
import {
  DATABASE_RETRY_AFTER_SECONDS,
  DatabaseUnavailableFilter,
  databaseUnavailableCause,
} from '../../../src/platform/database-unavailable';

const V = '6.0.0';
const known = (code: string, message = `${code} from the engine`) =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: V });

/** What systest's API log showed (release-qa, 2026-11-02), one of each. */
const P1001 = new Prisma.PrismaClientInitializationError("Can't reach database server at `db:5432`", V, 'P1001');
const P1001_REQUEST = known('P1001');
const P2024 = known('P2024', 'Timed out fetching a new connection from the connection pool. (Current connection pool timeout: 10, connection limit: 7)');
const P2028 = known('P2028', 'Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms');
/** #348's statement timeout, as Prisma surfaces a cancelled statement. */
const STATEMENT_TIMEOUT = new Prisma.PrismaClientUnknownRequestError(
  'Error occurred during query execution: ConnectorError(... PostgresError { code: "57014", message: "canceling statement due to statement timeout" })',
  { clientVersion: V },
);
const STATEMENT_TIMEOUT_RAW = known('P2010', 'Raw query failed. Code: `57014`. Message: `canceling statement due to statement timeout`');

class FakeResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  body: unknown;
  setHeader(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json(body: unknown) {
    this.body = body;
    return this;
  }
}

function hostFor(response: FakeResponse, type = 'http'): ArgumentsHost {
  return {
    getType: () => type,
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({}), getNext: () => undefined }),
    getArgs: () => [{}, response],
    getArgByIndex: (i: number) => [{}, response][i],
    switchToRpc: () => { throw new Error('not rpc'); },
    switchToWs: () => { throw new Error('not ws'); },
  } as unknown as ArgumentsHost;
}

/** Nest's HTTP adapter, as BaseExceptionFilter uses it for the default 500. */
function adapter() {
  return {
    reply: jest.fn((res: FakeResponse, body: unknown, status: number) => res.status(status).json(body)),
    isHeadersSent: jest.fn(() => false),
    end: jest.fn(),
  };
}

describe('databaseUnavailableCause', () => {
  it.each([
    ['P1001 (connection error)', P1001, 'P1001'],
    ['P1001 (request error)', P1001_REQUEST, 'P1001'],
    ['P2024 (pool timeout)', P2024, 'P2024'],
    ['P2028 (transaction timeout)', P2028, 'P2028'],
    ['57014 (statement timeout, unknown request error)', STATEMENT_TIMEOUT, '57014'],
    ['57014 (statement timeout, raw query)', STATEMENT_TIMEOUT_RAW, '57014'],
  ])('%s is the database being unavailable', (_name, error, cause) => {
    expect(databaseUnavailableCause(error)).toBe(cause);
  });

  it.each([
    ['a unique violation (P2002)', known('P2002')],
    ['a missing row (P2025)', known('P2025')],
    ['a serialization failure (P2034): the services map it themselves', known('P2034')],
    ['the server closing the connection (P1017): a COMMIT may have landed', new Prisma.PrismaClientInitializationError('Server has closed the connection.', V, 'P1017')],
    ['a plain error', new Error('boom')],
    ['a thrown string', 'P2024'],
  ])('%s is not', (_name, error) => {
    expect(databaseUnavailableCause(error)).toBeNull();
  });
});

describe('DatabaseUnavailableFilter', () => {
  beforeAll(() => jest.spyOn(Logger, 'error').mockImplementation(() => undefined));
  afterAll(() => jest.restoreAllMocks());

  it.each([
    ['P1001', P1001],
    ['P2024', P2024],
    ['P2028', P2028],
    ['57014', STATEMENT_TIMEOUT],
  ])('%s answers 503 with Retry-After and the stable body', (_code, error) => {
    const http = adapter();
    const res = new FakeResponse();
    new DatabaseUnavailableFilter(http as never).catch(error, hostFor(res));
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe(String(DATABASE_RETRY_AFTER_SECONDS));
    expect(res.body).toEqual({ error: { code: CommErrorCode.DATABASE_UNAVAILABLE, message: expect.any(String) } });
    // No engine text (hosts, query values) reaches the client.
    expect(JSON.stringify(res.body)).not.toMatch(/P\d{4}|57014|db:5432|pool/);
    expect(http.reply).not.toHaveBeenCalled();
  });

  it('any other Prisma error keeps the default 500, with no Retry-After', () => {
    const http = adapter();
    const res = new FakeResponse();
    new DatabaseUnavailableFilter(http as never).catch(known('P2002'), hostFor(res));
    expect(http.reply).toHaveBeenCalledWith(res, expect.objectContaining({ statusCode: 500 }), 500);
    expect(res.headers['Retry-After']).toBeUndefined();
  });
});

/** The filters as main.ts registers them, behind a real Nest HTTP stack. */
@Controller('t')
class ThrowingController {
  @Get('pool') pool() { throw P2024; }
  @Get('connect') connect() { throw P1001; }
  @Get('statement') statement() { throw STATEMENT_TIMEOUT; }
  @Get('unique') unique() { throw known('P2002'); }
  @Get('domain') domain() { throw new CommError(CommErrorCode.LESSON_STATE, 'no', 409); }
}
@Module({ controllers: [ThrowingController] })
class ThrowingModule {}

describe('DatabaseUnavailableFilter over HTTP, registered as main.ts registers it', () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    app = await NestFactory.create(ThrowingModule, { logger: false });
    app.useGlobalFilters(new CommErrorFilter(), new DatabaseUnavailableFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app.close();
  });

  it.each(['pool', 'connect', 'statement'])('%s: 503, Retry-After, COMM.DATABASE_UNAVAILABLE', async (path) => {
    const r = await fetch(`${base}/t/${path}`);
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe(String(DATABASE_RETRY_AFTER_SECONDS));
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe(CommErrorCode.DATABASE_UNAVAILABLE);
  });

  it('another Prisma error is still the default 500, and a domain error still its own status', async () => {
    const unique = await fetch(`${base}/t/unique`);
    expect(unique.status).toBe(500);
    expect(unique.headers.get('retry-after')).toBeNull();
    const domain = await fetch(`${base}/t/domain`);
    expect(domain.status).toBe(409);
    expect(((await domain.json()) as { error: { code: string } }).error.code).toBe(CommErrorCode.LESSON_STATE);
  });
});
