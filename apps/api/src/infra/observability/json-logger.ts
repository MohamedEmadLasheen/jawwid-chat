import { LoggerService, LogLevel } from '@nestjs/common';
import { readBuildInfo, type BuildInfo } from '../build-info';
import { redact, safeErrorMessage } from './redact';

/**
 * Structured JSON logging (docs/infrastructure/monitoring.md §3).
 *
 * One JSON object per line to stdout, because the platform collects stdout and
 * a log line that has to be parsed with a regex is a log line nobody queries
 * during an incident. Used by both processes: the API (main.ts) and the worker
 * (worker.ts), so a log pipeline needs one parser.
 *
 * THE PRIVACY RULE IS THE POINT, not a nicety. This product carries children's
 * and families' messages. monitoring.md §3 lists what must never appear --
 * passwords, tokens, Authorization headers, credentials, MESSAGE CONTENT,
 * PHONE NUMBERS -- and a value written to stdout is exposed to everyone with
 * log access and to every downstream processor, forever. Two controls, and it
 * matters which is which:
 *
 *  1. A FIXED SET OF FIELDS. This class never serialises an object: a message
 *     is a string, an Error contributes its (redacted) message and never its
 *     stack, and anything else becomes a fixed placeholder. Structured fields
 *     are an allowlist; an undeclared field is dropped. That is the control.
 *
 *  2. redact() on every message, as a BACKSTOP for a secret somebody
 *     interpolated into a string (redact.ts says what it can and cannot see).
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

/** The structured fields a caller may attach. Everything else is dropped. */
const EXTRA_FIELDS = ['request_id', 'route', 'status', 'latency_ms', 'actor_kind', 'error_code'] as const;
type ExtraField = (typeof EXTRA_FIELDS)[number];

/** Nest's level names mapped onto the ones monitoring.md §3 uses. */
const LEVEL_NAMES: Record<string, string> = {
  verbose: 'trace',
  debug: 'debug',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

/** Severity order of the documented names. */
const SEVERITY: Record<string, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 };

export const DEFAULT_LOG_LEVEL = 'info';

/**
 * LOG_LEVEL, as declared in infra/env/manifest.tsv: trace | debug | info |
 * warn | error | fatal. Anything else -- including unset -- is `info`, and an
 * unrecognised value is reported once at startup rather than silently honoured
 * as something it does not say.
 */
export function parseLogLevel(raw: string | undefined): { level: string; invalid?: string } {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return { level: DEFAULT_LOG_LEVEL };
  if (value in SEVERITY) return { level: value };
  return { level: DEFAULT_LOG_LEVEL, invalid: raw };
}

export class JsonLogger implements LoggerService {
  private readonly build: BuildInfo;
  private threshold: number;

  constructor(
    private readonly service = 'api',
    build?: BuildInfo,
    /** Injected so tests read what was written instead of scraping stdout. */
    private readonly sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
    level: string | undefined = process.env.LOG_LEVEL,
  ) {
    this.build = build ?? readBuildInfo();
    const parsed = parseLogLevel(level);
    this.threshold = SEVERITY[parsed.level];
    if (parsed.invalid !== undefined) {
      this.write('warn', `LOG_LEVEL is not one of trace|debug|info|warn|error|fatal; using ${DEFAULT_LOG_LEVEL}`, 'JsonLogger');
    }
  }

  /**
   * Emit one record.
   *
   * `extra` is how the request log attaches route, status and latency. Only
   * the declared fields survive -- an accidental `{ body }` cannot ride along.
   */
  write(level: string, message: unknown, context?: string, extra: Partial<LogRecord> = {}): void {
    const name = LEVEL_NAMES[level] ?? level;
    if ((SEVERITY[name] ?? SEVERITY.info) < this.threshold) return;
    const record: LogRecord = {
      ts: new Date().toISOString(),
      level: name,
      env: this.build.environment,
      service: this.service,
      commit: this.build.commit,
      ...(context ? { context } : {}),
      message: stringify(message),
      ...pickKnown(extra),
    };
    this.sink(JSON.stringify(record));
  }

  isLevelEnabled(level: string): boolean {
    return (SEVERITY[LEVEL_NAMES[level] ?? level] ?? SEVERITY.info) >= this.threshold;
  }

  // Nest calls these as (message, ...optionalParams), appending the Logger
  // instance's context as the LAST parameter -- and padding with `undefined`
  // for error() -- so the context is read from the end, never by position.

  log(message: unknown, ...params: unknown[]): void {
    this.write('log', message, contextOf(params));
  }

  /**
   * The stack is NEVER logged. A stack from a domain error routinely embeds
   * the arguments that produced it, and Nest passes it as the second
   * parameter (`logger.error(message, stack)`); contextOf() refuses anything
   * multi-line, so a stack can neither become a field nor pose as a context.
   */
  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, contextOf(params));
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, contextOf(params));
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, contextOf(params));
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, contextOf(params));
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, contextOf(params));
  }

  /**
   * Nest calls this with the `logLevels` option, if one is ever passed. The
   * least severe level listed becomes the threshold; LOG_LEVEL is the normal
   * way to set it.
   */
  setLogLevels(levels: LogLevel[]): void {
    const severities = levels.map((l) => SEVERITY[LEVEL_NAMES[l] ?? l]).filter((s) => s !== undefined);
    if (severities.length > 0) this.threshold = Math.min(...severities);
  }
}

/** A Nest context is a short class or subsystem name: one line, no spaces. */
function contextOf(params: unknown[]): string | undefined {
  for (let i = params.length - 1; i >= 0; i--) {
    const p = params[i];
    if (p === undefined) continue;
    return typeof p === 'string' && /^[\w.:-]{1,64}$/.test(p) ? p : undefined;
  }
  return undefined;
}

/** Only the fields the format declares. Anything else is dropped, not logged. */
function pickKnown(extra: Partial<LogRecord>): Partial<LogRecord> {
  const out: Partial<Record<ExtraField, unknown>> = {};
  for (const key of EXTRA_FIELDS) {
    const value = (extra as Record<string, unknown>)[key];
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
  }
  return out as Partial<LogRecord>;
}

function stringify(message: unknown): string {
  if (typeof message === 'string') return redact(message);
  // An Error contributes its message only (Prisma errors: class and code only).
  if (message instanceof Error) return safeErrorMessage(message);
  if (typeof message === 'number' || typeof message === 'boolean') return String(message);
  // Never JSON.stringify an arbitrary object into a log line: that is precisely
  // how a DTO carrying a message body or a phone number ends up in stdout.
  return '[non-string log message]';
}
