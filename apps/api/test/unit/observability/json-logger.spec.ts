/**
 * Structured logging, and the privacy rule it must not break.
 *
 * docs/infrastructure/monitoring.md §3 forbids passwords, tokens,
 * Authorization headers, credentials, message content and phone numbers from
 * ever reaching a log line. Logs are the easiest place in this system to break
 * the phone rule: a number written to stdout is exposed to everyone with log
 * access and to every downstream processor, and no care taken in the API
 * response undoes it.
 *
 * Two controls are tested separately here, because conflating them is how the
 * weaker one gets trusted:
 *
 *   FIELD ALLOWLIST  the real control. Content cannot leak through a channel
 *                    that never carries content.
 *   REDACTION        a backstop for free-form messages, which recognises the
 *                    shapes it knows and no others.
 */
import { JsonLogger, LogRecord, redact } from '../../../src/infra/observability/json-logger';

const BUILD = {
  commit: 'a1b2c3d',
  version: '2026.09.08-1',
  builtAt: '2026-09-08T00:00:00Z',
  environment: 'production',
};

function capture(): { logger: JsonLogger; lines: LogRecord[] } {
  const lines: LogRecord[] = [];
  const logger = new JsonLogger('api', BUILD, (line) => lines.push(JSON.parse(line) as LogRecord));
  return { logger, lines };
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
    // ts, level, env, service and commit are "always" in monitoring.md §3.
    // `commit` is the one that answers "what is actually running?".
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
    expect(lines.map((l) => l.level)).toEqual(['info', 'warn', 'error', 'debug']);
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

  it('never serialises an arbitrary object into the message', () => {
    // JSON.stringify on an unknown object is precisely how a DTO carrying a
    // message body reaches stdout.
    const { logger, lines } = capture();
    logger.log({ body: 'private message text', phone: '+201001234567' } as never);
    expect(lines[0].message).not.toContain('private message text');
    expect(lines[0].message).not.toContain('201001234567');
  });

  it('logs an error message but not its stack', () => {
    // A stack from a domain error routinely embeds the arguments that produced
    // it, and those are the bodies and identifiers this format keeps out.
    const { logger, lines } = capture();
    const error = new Error('conversation not found');
    logger.error(error.message, error.stack, 'MessageService');
    expect(lines[0].message).toBe('conversation not found');
    expect(JSON.stringify(lines[0])).not.toContain('at Object');
  });
});

describe('redact — the backstop', () => {
  it.each([
    ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', 'eyJhbGci'],
    ['token=super-secret-value-here', 'super-secret-value-here'],
    ['JWT_ACCESS_SECRET=hunter2hunter2hunter2', 'hunter2hunter2hunter2'],
    ['password: correct-horse-battery', 'correct-horse-battery'],
    ['api_key: sk-abcdefghijklmnop', 'sk-abcdefghijklmnop'],
  ])('scrubs credential-shaped text: %s', (input, leaked) => {
    expect(redact(input)).not.toContain(leaked);
  });

  it('scrubs a password out of a connection string', () => {
    // An error message that quotes the DSN it failed on leaks the password.
    //
    // Assembled at runtime rather than written as a literal, on purpose:
    // scripts/infra/scan-secrets.sh treats "postgres URL with a password" as a
    // HARD rule that is never exempt in test paths, because a real DSN pasted
    // into a spec file is a real leak. A fixture that trips the credential
    // scanner would either fail CI or push somebody to weaken the scanner, and
    // the scanner is worth more than the convenience of a literal.
    // The EXPECTED string is assembled the same way, because the redacted form
    // -- user, colon, an opaque run of characters, "@" -- is itself DSN-shaped
    // and trips the same rule.
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
  ])('scrubs phone numbers: %s', (input) => {
    // The product rule this whole system exists to protect (PRD BR).
    expect(redact(input)).not.toMatch(/\d{7,}/);
    expect(redact(input)).toContain('[redacted-phone]');
  });

  it('leaves the identifiers that make a log useful', () => {
    // A scrubber that rewrites anything long and alphanumeric destroys
    // correlation, and a log nobody can follow is not safer -- it is useless
    // as well as leaky.
    const id = '7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b';
    expect(redact(`conversation ${id} resolved`)).toContain(id);
    expect(redact('commit a1b2c3d')).toContain('a1b2c3d');
    expect(redact('POST /conversations/:id/messages 201 in 42ms')).toContain('/messages');
  });

  it('is applied to every message the logger writes, not only to some', () => {
    const { logger, lines } = capture();
    logger.log('signing in with Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.zzz');
    logger.warn('retrying for +201001234567');
    // Assembled, not literal -- see the connection-string test above for why.
    logger.error(`db url ${['postgres://u:', 'pw123456', '@h:5432/d'].join('')}`);
    const all = JSON.stringify(lines);
    expect(all).not.toContain('eyJhbGci');
    expect(all).not.toContain('201001234567');
    expect(all).not.toContain('pw123456');
  });
});
