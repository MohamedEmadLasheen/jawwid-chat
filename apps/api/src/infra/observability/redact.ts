/**
 * The redaction backstop shared by the log store and the error tracker.
 *
 * ONE function, used by both JsonLogger and the Sentry adapter, so the two can
 * never disagree about what a secret looks like.
 *
 * This is a BACKSTOP, not the control. The control is that nothing in
 * infra/observability ever serialises a request body, a response body, a
 * header, a query string or a domain object: content cannot leak through a
 * channel that never carries content. What reaches this function is free-form
 * text somebody wrote into a log call or an exception message, and this
 * recognises the shapes it knows -- credentials, phone numbers, email
 * addresses, signed URLs, object keys -- and no others. A child's name or a
 * message body has no shape, and no pattern here will ever catch one. Never
 * log something sensitive on the grounds that "redact() will catch it".
 *
 * Deliberately narrow in the other direction too. A scrubber that rewrote
 * anything long and alphanumeric would destroy the UUIDs and commit hashes
 * that make a log line correlatable, and a log nobody can follow is not safer,
 * it is just useless as well as leaky. Both directions are tested.
 */

/** Digits, including the Arabic-Indic and Extended Arabic-Indic forms. */
const DIGIT = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';
const DIGIT_RE = new RegExp(DIGIT, 'g');

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Longest message the backstop will pass through; the rest is cut, not scanned. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Run first: these remove whole regions the later passes would only fragment. */
const PRE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Prisma renders the ARGUMENTS of a failed call into its message -- a
  // validation error on `message.create` prints the body it was given. Keep
  // the operation name, drop everything after it.
  [/(Invalid `prisma\.[\w$.]+\(\)` invocation)[\s\S]*/g, '$1 [prisma detail redacted]'],
  // A Postgres constraint DETAIL quotes the offending values.
  [/\bKey \(([^)]*)\)=\([^)]*\)/g, 'Key ($1)=([redacted])'],
];

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Bearer tokens and the Authorization header, however they were interpolated.
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]'],
  [/\bauthorization["'\s:=]+[^\s,"'}]{8,}/gi, 'authorization=[redacted]'],
  // Anything JWT-shaped.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+)?/g, '[redacted-jwt]'],
  // A DSN carries a password; an error message that quotes one leaks it.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^:/@\s]+):[^@\s]+@/gi, '$1:[redacted]@'],
  // Assignments to obviously-secret names, including a presigned URL's
  // X-Amz-Signature / X-Amz-Credential / X-Amz-Security-Token.
  [
    /\b((?:\w*_)?(?:password|secret|token|api[_-]?key|passwd|pwd|signature|credential))["'\s:=]+[^\s,"'}&]+/gi,
    '$1=[redacted]',
  ],
  // Email addresses. A login identifier, and a contact channel.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[redacted-email]'],
];

/**
 * Phone numbers: a run of digits and separators carrying at least nine digits,
 * or eight after an explicit `+`. The digit count is what keeps an ISO date
 * (`2026-09-08`, eight digits) and a latency out of it.
 */
const PHONE_CANDIDATE = new RegExp(`\\+?${DIGIT}[${DIGIT.slice(1, -1)}\\s().-]{6,}${DIGIT}`, 'g');

function redactPhones(text: string): string {
  return text.replace(PHONE_CANDIDATE, (match) => {
    const digits = (match.match(DIGIT_RE) ?? []).length;
    const plus = match.startsWith('+');
    return digits >= 9 || (plus && digits >= 8) ? '[redacted-phone]' : match;
  });
}

/**
 * URLs, query strings and object keys, token by token.
 *
 * Done per whitespace-delimited token rather than with one large regex, so
 * there is no nested quantifier to backtrack on hostile input.
 *
 *  - a query string is dropped wherever it appears: on a media link it is the
 *    signature (`s=`, `e=`), on a presigned URL `X-Amz-Signature=`, on a
 *    search the search term;
 *  - a full http(s)/ws(s) URL whose path carries a UUID keeps only its
 *    origin: that path IS the object key or a resolved resource id. A path
 *    without one (`http://localhost:3000/api/v1/storage`) is configuration
 *    and stays readable;
 *  - any other slash-joined token containing a UUID (`conversations/<id>/<id>`,
 *    a resolved API path, an object key) is replaced whole.
 */
function redactLocations(text: string): string {
  return text.replace(/[^\s"'<>(),{}[\]]+/g, (token) => {
    const url = /^((?:https?|wss?):\/\/[^/?#\s]+)([^?#]*)([?#].*)?$/i.exec(token);
    if (url) {
      const [, origin, path, query] = url;
      if (UUID.test(path)) return `${origin}/[redacted-url]`;
      return query && query.length > 1 ? `${origin}${path}?[redacted-query]` : token;
    }
    const query = token.indexOf('?');
    if (query >= 0 && token.indexOf('=', query) > query) {
      token = `${token.slice(0, query)}?[redacted-query]`;
    }
    if (token.includes('/') && UUID.test(token)) return '[redacted-path]';
    return token;
  });
}

export function redact(text: string): string {
  let out = text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)} [truncated]` : text;
  for (const [pattern, replacement] of PRE_PATTERNS) out = out.replace(pattern, replacement);
  // URLs before credentials: a signed URL loses its whole query here, rather
  // than having one parameter redacted and the rest left behind.
  out = redactLocations(out);
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return redactPhones(out);
}

/**
 * The message of an error, safe to log or report.
 *
 * A Prisma error's message is the one most likely to carry content -- it
 * prints the arguments of the call that failed -- so a Prisma error is
 * described by its class and code, never by its text. Everything else is its
 * own message, redacted. An arbitrary object is never JSON-stringified: that
 * is exactly how a DTO carrying a message body reaches a log store.
 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // An initialization error is about reaching the database (host, port,
    // user), never about a row -- and it is the one an operator needs to read.
    if (error.name === 'PrismaClientInitializationError') return `${error.name}: ${redact(error.message)}`;
    if (isPrismaError(error)) {
      const code = (error as { code?: unknown }).code;
      return `${error.name}${typeof code === 'string' ? ` ${code}` : ''}`;
    }
    return redact(error.message);
  }
  if (typeof error === 'string') return redact(error);
  if (typeof error === 'number' || typeof error === 'boolean') return String(error);
  return 'non-error value';
}

export function isPrismaError(error: unknown): boolean {
  return error instanceof Error && /^PrismaClient\w*Error$/.test(error.name);
}
