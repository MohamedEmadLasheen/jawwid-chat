import { LoggerService, LogLevel } from '@nestjs/common';
import { readBuildInfo, type BuildInfo } from '../build-info';

/**
 * Structured JSON logging. Phase 8.
 *
 * docs/infrastructure/monitoring.md §3 has specified this format since
 * 2026-09-05, and main.ts said so honestly:
 *
 *   "Nest's default logger writes to stdout, which is where the platform
 *    collects it. Structured JSON logging is a separate piece of work and is
 *    deliberately not faked here."
 *
 * This is that work. One JSON object per line to stdout, because the platform
 * collects stdout and a log line that has to be parsed with a regex is a log
 * line nobody queries during an incident.
 *
 * THE REDACTION IS THE POINT, not a nicety. Logs are the easiest place to break
 * this product's central privacy rule: a phone number in a log line is exposed
 * to everyone with log access and to every downstream log processor, forever,
 * and no amount of care in the API response undoes it. monitoring.md §3 lists
 * what must never appear -- passwords, tokens, Authorization headers,
 * credentials, MESSAGE CONTENT, PHONE NUMBERS, private staff notes.
 *
 * So this class does two things about that, and it is worth being precise about
 * which is which:
 *
 *  1. It logs a FIXED SET OF FIELDS. Nothing here ever serialises a request
 *     body, a response body, or a domain object. That is the actual control:
 *     content cannot leak through a channel that never carries content.
 *
 *  2. It scrubs secret-shaped text from the free-form message as a BACKSTOP,
 *     for the case somebody interpolates a token into a log string. A backstop
 *     is not a guarantee -- it recognises the shapes it knows -- and it must
 *     never be treated as permission to log something sensitive on the grounds
 *     that "the logger will catch it".
 */

/** The one object per line. Fields are ordered for human scanning of raw logs. */
export interface LogRecord {
  ts: string;
  level: string;
  env: string;
  service: string;
  commit: string;
  context?: string;
  message: string;
  request_id?: string;
  route?: string;
  status?: number;
  latency_ms?: number;
  actor_kind?: string;
  error_code?: string;
}

/**
 * Secret shapes worth recognising in free-form text.
 *
 * Deliberately narrow. A scrubber that rewrites anything long and
 * alphanumeric destroys the ids that make a log useful -- and a log nobody can
 * correlate is not safer, it is just useless as well as leaky.
 */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Bearer tokens and the Authorization header, however they were interpolated.
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]'],
  [/\bauthorization["'\s:=]+[^\s,"'}]{8,}/gi, 'authorization=[redacted]'],
  // Anything JWT-shaped.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+)?/g, '[redacted-jwt]'],
  // A DSN carries a password; an error message that quotes one leaks it.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^:/@\s]+):[^@\s]+@/gi, '$1:[redacted]@'],
  // Assignments to obviously-secret names.
  [
    /\b((?:\w*_)?(?:password|secret|token|api[_-]?key|passwd|pwd))["'\s:=]+[^\s,"'}]+/gi,
    '$1=[redacted]',
  ],
  // Phone numbers. The product rule this system exists to protect (PRD BR).
  // Long digit runs, with or without separators, and an explicit +country form.
  [/\+\d[\d\s().-]{7,}\d/g, '[redacted-phone]'],
  [/\b\d[\d\s().-]{8,}\d\b/g, '[redacted-phone]'],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Nest's levels, mapped to the names monitoring.md §3 uses. */
const LEVEL_NAMES: Record<string, string> = {
  log: 'info',
  error: 'error',
  warn: 'warn',
  debug: 'debug',
  verbose: 'trace',
  fatal: 'fatal',
};

export class JsonLogger implements LoggerService {
  private readonly build: BuildInfo;

  constructor(
    private readonly service = 'api',
    build?: BuildInfo,
    /** Injected so tests read what was written instead of scraping stdout. */
    private readonly sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  ) {
    this.build = build ?? readBuildInfo();
  }

  /**
   * Emit one record.
   *
   * `extra` is how the request interceptor attaches route, status and latency.
   * It is typed, and only the declared fields survive -- an accidental
   * `{ body }` cannot ride along into the log.
   */
  write(level: string, message: unknown, context?: string, extra: Partial<LogRecord> = {}): void {
    const record: LogRecord = {
      ts: new Date().toISOString(),
      level: LEVEL_NAMES[level] ?? level,
      env: this.build.environment,
      service: this.service,
      commit: this.build.commit,
      ...(context ? { context } : {}),
      message: redact(stringify(message)),
      ...pickKnown(extra),
    };
    this.sink(JSON.stringify(record));
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  error(message: unknown, stackOrContext?: string, context?: string): void {
    // The stack is NOT logged as a separate field on purpose. A stack from a
    // domain error routinely embeds the arguments that produced it, and those
    // are the message bodies and identifiers this format exists to keep out.
    // The error's own message, redacted, is what goes in.
    this.write('error', message, context ?? stackOrContext);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  setLogLevels(_levels: LogLevel[]): void {
    // Level filtering is Nest's, applied before it calls us.
  }
}

/** Only the fields the format declares. Anything else is dropped, not logged. */
function pickKnown(extra: Partial<LogRecord>): Partial<LogRecord> {
  const allowed: Array<keyof LogRecord> = [
    'request_id',
    'route',
    'status',
    'latency_ms',
    'actor_kind',
    'error_code',
  ];
  const out: Partial<LogRecord> = {};
  for (const key of allowed) {
    const value = extra[key];
    if (value !== undefined) Object.assign(out, { [key]: value });
  }
  return out;
}

function stringify(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  // Never JSON.stringify an arbitrary object into a log line: that is precisely
  // how a DTO carrying a message body or a phone number ends up in stdout.
  return String(message);
}
