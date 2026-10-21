/**
 * Structured logging, and the privacy rule it must not break.
 *
 * docs/infrastructure/monitoring.md §3 forbids passwords, tokens,
 * Authorization headers, credentials, message content and phone numbers from
 * ever reaching a log line. This product carries children's and families'
 * messages; a value written to stdout is exposed to everyone with log access
 * and to every downstream processor, and no care taken in the API response
 * undoes it.
 *
 * Two controls are tested separately, because conflating them is how the
 * weaker one gets trusted:
 *
 *   FIELD ALLOWLIST  the real control. Content cannot leak through a channel
 *                    that never carries content.
 *   REDACTION        a backstop for free-form messages, which recognises the
 *                    shapes it knows and no others.
 */
import { JsonLogger, LogRecord, parseLogLevel } from '../../../src/infra/observability/json-logger';
import { redact, safeErrorMessage } from '../../../src/infra/observability/redact';

const BUILD = {
  commit: 'a1b2c3d',
  version: '2026.10.20-1',
  builtAt: '2026-10-20T00:00:00Z',
  environment: 'production',
};

function capture(level = 'trace'): { logger: JsonLogger; lines: LogRecord[] } {
  const lines: LogRecord[] = [];
  const logger = new JsonLogger('api', BUILD, (line) => lines.push(JSON.parse(line) as LogRecord), level);
  return { logger, lines };
}

/** A Prisma-shaped error without importing Prisma: the class name is what is matched. */
function prismaValidationError(): Error {
  const e = new Error(
    '\nInvalid `prisma.message.create()` invocation:\n\n{\n  data: {\n    body: "ابني مريض اليوم",\n' +
      '    senderName: "Layla Example"\n  }\n}\n\nArgument `conversationId` is missing.',
  );
  e.name = 'PrismaClientValidationError';
  return e;
}

describe('JsonLogger — format', () => {
  it('writes one parseable JSON object per line', () => {
    const { logger, lines } = capture();
    logger.log('started', 'Bootstrap');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      env: 'production',
      service: 'api',
      commit: 'a1b2c3d',
      context: 'Bootstrap',
      message: 'started',
    });
    expect(Date.parse(lines[0].ts)).not.toBeNaN();
  });

  it('always carries the fields an incident needs', () => {
    const { logger, lines } = capture();
    logger.warn('something');
    for (const field of ['ts', 'level', 'env', 'service', 'commit', 'message'] as const) {
      expect(lines[0][field]).toBeDefined();
    }
  });

  it('maps Nest levels onto the documented names', () => {
    const { logger, lines } = capture();
    logger.log('a');
    logger.warn('b');
    logger.error('c');
    logger.debug('d');
    logger.verbose('e');
    logger.fatal('f');
    expect(lines.map((l) => l.level)).toEqual(['info', 'warn', 'error', 'debug', 'trace', 'fatal']);
  });

  it('reads the context the way Nest passes it: last, after padding', () => {
    // Nest's Logger instance calls error(message, undefined, context) and
    // log(message, context); the context is the last defined parameter.
    const { logger, lines } = capture();
    logger.error('boom', undefined, 'ExceptionsHandler');
    logger.log('ok', 'RoutesResolver');
    expect(lines.map((l) => l.context)).toEqual(['ExceptionsHandler', 'RoutesResolver']);
  });
});

describe('JsonLogger — LOG_LEVEL', () => {
  it('drops lines below the configured level', () => {
    const { logger, lines } = capture('warn');
    logger.debug('noise');
    logger.log('info');
    logger.warn('kept');
    logger.error('kept too');
    expect(lines.map((l) => l.message)).toEqual(['kept', 'kept too']);
  });

  it('defaults to info, and says so when the value is not a level', () => {
    expect(parseLogLevel(undefined)).toEqual({ level: 'info' });
    expect(parseLogLevel(' DEBUG ')).toEqual({ level: 'debug' });
    expect(parseLogLevel('verbose')).toEqual({ level: 'info', invalid: 'verbose' });

    const { logger, lines } = capture('loud');
    logger.debug('dropped');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'warn', context: 'JsonLogger' });
  });
});

describe('JsonLogger — the field allowlist is the actual control', () => {
  it('drops any field the format does not declare', () => {
    const { logger, lines } = capture();
    logger.write('log', 'request', 'Http', {
      request_id: 'req-1',
      status: 200,
      // Exactly the mistake this exists to survive: somebody attaches the
      // request body to "help with debugging".
      body: { text: 'my child is unwell', phone: '+201001234567' },
      headers: { authorization: 'Bearer abc.def.ghi' },
    } as never);

    const line = JSON.stringify(lines[0]);
    expect(lines[0].request_id).toBe('req-1');
    expect(lines[0].status).toBe(200);
    expect(line).not.toContain('unwell');
    expect(line).not.toContain('201001234567');
    expect(line).not.toContain('Bearer');
    expect(Object.keys(lines[0])).not.toContain('body');
    expect(Object.keys(lines[0])).not.toContain('headers');
  });

  it('drops a declared field whose value is an object', () => {
    const { logger, lines } = capture();
    logger.write('log', 'x', 'Http', { route: { body: 'private message text' } } as never);
    expect(JSON.stringify(lines[0])).not.toContain('private message text');
    expect(lines[0].route).toBeUndefined();
  });

  it('never serialises an arbitrary object into the message', () => {
    // JSON.stringify on an unknown object is precisely how a DTO carrying a
    // message body reaches stdout.
    const { logger, lines } = capture();
    logger.log({ body: 'private message text', phone: '+201001234567' });
    expect(lines[0].message).not.toContain('private message text');
    expect(lines[0].message).not.toContain('201001234567');
  });

  it('logs an error message but never its stack, even where Nest puts the stack', () => {
    // Nest calls error(message, stack) and error(message, stack, context). A
    // stack embeds the arguments that produced it; it must become neither a
    // field nor a context.
    const { logger, lines } = capture();
    const error = new Error('conversation not found');
    logger.error(error.message, error.stack, 'MessageService');
    logger.error(error.message, error.stack);
    logger.error(error);
    expect(lines.map((l) => l.message)).toEqual([
      'conversation not found',
      'conversation not found',
      'conversation not found',
    ]);
    expect(lines[0].context).toBe('MessageService');
    expect(lines[1].context).toBeUndefined();
    expect(JSON.stringify(lines)).not.toContain('json-logger.spec');
    expect(JSON.stringify(lines)).not.toMatch(/\bat \S+ \(/);
  });

  it('describes a Prisma error by class and code, never by the arguments it prints', () => {
    // Prisma renders the data of the failed call into its message -- here a
    // parent's message body and a name.
    const { logger, lines } = capture();
    logger.error(prismaValidationError());
    const known = Object.assign(new Error('Unique constraint failed on the fields: (`phone`)'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });
    logger.error(known);
    expect(lines.map((l) => l.message)).toEqual([
      'PrismaClientValidationError',
      'PrismaClientKnownRequestError P2002',
    ]);
  });
});

describe('redact — the backstop', () => {
  it.each([
    ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', 'eyJhbGci'],
    ['token=super-secret-value-here', 'super-secret-value-here'],
    ['JWT_ACCESS_SECRET=hunter2hunter2hunter2', 'hunter2hunter2hunter2'],
    ['password: correct-horse-battery', 'correct-horse-battery'],
    ['api_key: sk-abcdefghijklmnop', 'sk-abcdefghijklmnop'],
    ['refresh eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl rejected', 'eyJzdWIiOiIxIn0'],
  ])('scrubs credential-shaped text: %s', (input, leaked) => {
    expect(redact(input)).not.toContain(leaked);
  });

  it('scrubs a password out of a connection string', () => {
    // Assembled at runtime, never a literal: scripts/infra/scan-secrets.sh
    // treats "URL with a password" as a hard rule even in test paths, and the
    // redacted form is itself DSN-shaped.
    const scheme = 'postgres://';
    const dsn = [scheme, 'chat_app:', 's3cr3tpw', '@db.internal:5432/chat'].join('');
    const out = redact(`failed to connect: ${dsn}`);
    expect(out).not.toContain('s3cr3tpw');
    expect(out).toContain([scheme, 'chat_app:', '[redacted]', '@'].join(''));
  });

  it.each([
    '+20 100 123 4567',
    '+201001234567',
    'call 01001234567 back',
    '0100-123-4567',
    '(010) 0123 4567',
  ])('scrubs phone numbers: %s', (input) => {
    expect(redact(input)).not.toMatch(/\d{4,}/);
    expect(redact(input)).toContain('[redacted-phone]');
  });

  it('scrubs a phone number written in Arabic-Indic digits', () => {
    // Families type numbers in the digits their keyboard has.
    const arabic = '٠١٠٠١٢٣٤٥٦٧';
    const persian = '۰۱۰۰۱۲۳۴۵۶۷';
    expect(redact(`رقمي ${arabic}`)).not.toContain(arabic);
    expect(redact(`رقمي ${persian}`)).not.toContain(persian);
    expect(redact(`رقمي ${arabic}`)).toContain('[redacted-phone]');
  });

  it('scrubs email addresses', () => {
    expect(redact('login failed for parent.one@example.com')).toBe('login failed for [redacted-email]');
  });

  it('scrubs the signature and the object key out of a media or storage URL', () => {
    // RT-037 media links carry `s=`/`e=`; an S3 presigned URL carries
    // X-Amz-Signature; and the path of either IS the object key.
    const media =
      'https://api.example.test/api/v1/media/attachments/7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b?e=1760000000&s=abcdef0123456789';
    const s3 =
      'https://bucket.s3.example.test/conversations/0c1d2e3f-4a5b-4d5e-8a9b-7f3a1b2c6f70/9b0c1d2e-3f4a-4b2c-8d5e-6f707f3a1b2c' +
      '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20261020&X-Amz-Signature=deadbeefcafef00d';
    const out = redact(`download failed: ${media} then ${s3}`);
    for (const leaked of ['s=abcdef', 'abcdef0123456789', 'X-Amz-Signature', 'deadbeefcafef00d', 'AKIAEXAMPLE', '7f3a1b2c', '0c1d2e3f']) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain('https://api.example.test/[redacted-url]');
    expect(out).toContain('https://bucket.s3.example.test/[redacted-url]');
  });

  it('scrubs a bare object key and a bare signed query', () => {
    const key = 'avatars/contact/7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b/0c1d2e3f-4a5b-4d5e-8a9b-7f3a1b2c6f70';
    expect(redact(`no object at ${key}`)).toBe('no object at [redacted-path]');
    expect(redact('GET /api/v1/storage/x?s=abc123&e=99 refused')).not.toContain('abc123');
    expect(redact('see https://cdn.example.test/avatars/latest?s=abc123&e=99')).toBe(
      'see https://cdn.example.test/avatars/latest?[redacted-query]',
    );
    expect(redact('presign X-Amz-Signature=deadbeef01 rejected')).not.toContain('deadbeef01');
  });

  it('keeps the operation of a Prisma error that was interpolated into a string, and nothing after it', () => {
    const out = redact(`drain failed: ${prismaValidationError().message}`);
    expect(out).toContain('Invalid `prisma.message.create()` invocation');
    expect(out).not.toContain('ابني');
    expect(out).not.toContain('Layla');
  });

  it('scrubs the values a Postgres constraint DETAIL quotes', () => {
    expect(redact('Key (login)=(someone-specific) already exists.')).toBe('Key (login)=([redacted]) already exists.');
  });

  it('caps a runaway message', () => {
    expect(redact('x'.repeat(10_000)).length).toBeLessThan(2100);
  });

  it('leaves the identifiers that make a log useful', () => {
    // A scrubber that rewrites anything long and alphanumeric destroys
    // correlation, and a log nobody can follow is not safer.
    const id = '7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b';
    expect(redact(`conversation ${id} resolved`)).toContain(id);
    expect(redact('commit a1b2c3d')).toContain('a1b2c3d');
    expect(redact('POST /api/v1/conversations/:id/messages 201 in 42ms')).toContain('/messages');
    expect(redact('Mapped {/api/v1/conversations/:id, GET} route')).toBe('Mapped {/api/v1/conversations/:id, GET} route');
    expect(redact('lesson on 2026-10-20 at 16:30')).toBe('lesson on 2026-10-20 at 16:30');
    expect(redact('Jawwid Chat API listening on :3000')).toBe('Jawwid Chat API listening on :3000');
    expect(redact('connected to redis://redis:6379')).toBe('connected to redis://redis:6379');
    // A configuration URL with no id in it is not an object key.
    expect(redact('signed URLs will point at http://localhost:3000/api/v1/storage.')).toBe(
      'signed URLs will point at http://localhost:3000/api/v1/storage.',
    );
  });

  it('is applied to every message the logger writes, not only to some', () => {
    const { logger, lines } = capture();
    logger.log('signing in with Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.zzz');
    logger.warn('retrying for +201001234567');
    logger.error(`db url ${['postgres://u:', 'pw123456', '@h:5432/d'].join('')}`);
    logger.debug('avatar at https://cdn.example.test/avatars/a?s=sig0123456789');
    logger.fatal(new Error('cannot reach parent.one@example.com'));
    const all = JSON.stringify(lines);
    expect(all).not.toContain('eyJhbGci');
    expect(all).not.toContain('201001234567');
    expect(all).not.toContain('pw123456');
    expect(all).not.toContain('sig0123456789');
    expect(all).not.toContain('parent.one');
  });
});

describe('safeErrorMessage', () => {
  it('keeps a Prisma initialization error readable: it is about the server, not a row', () => {
    const init = Object.assign(new Error("Can't reach database server at `db:5432`"), {
      name: 'PrismaClientInitializationError',
    });
    expect(safeErrorMessage(init)).toBe("PrismaClientInitializationError: Can't reach database server at `db:5432`");
  });

  it('never stringifies an object, and redacts a string or an Error', () => {
    expect(safeErrorMessage({ body: 'private' })).toBe('non-error value');
    expect(safeErrorMessage('call +201001234567')).toBe('call [redacted-phone]');
    expect(safeErrorMessage(new Error('token=abcdefgh123'))).toBe('token=[redacted]');
  });
});
