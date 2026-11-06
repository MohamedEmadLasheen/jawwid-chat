import * as Sentry from '@sentry/node';
import { redact } from './redact';
import { acceptRequestId } from './request-log';
import type { BuildInfoLike, ErrorContext, ErrorTracker } from './error-tracker';
import { ErrorBudget, errorKind, isCriticalReport } from './error-budget';

/**
 * Error tracking via Sentry. Loaded only when SENTRY_DSN is set (error-tracker.ts).
 *
 * ## The privacy contract
 *
 * This product carries children's and families' messages, and its rule is that
 * conversation content never leaves the systems that govern it. An error
 * tracker is the easiest place in a codebase to break that rule by accident:
 * its default is to capture as much surrounding state as it can -- request
 * bodies, headers, local variables, console output -- which is the right
 * default for most applications and exactly the wrong one here.
 *
 * Three layers, and the last does not trust the first two:
 *
 *   1. NO DEFAULT INTEGRATIONS. `defaultIntegrations: false`, then an ALLOWLIST
 *      of three that attach no request, console or variable state. An
 *      allowlist rather than a deny-list of known-dangerous names, so an
 *      integration a future SDK version adds by default is not loaded either.
 *      (The ones that matter by name: RequestData attaches body, query,
 *      cookies and headers; LocalVariables attaches stack-frame locals, which
 *      in this codebase are routinely a message body or a drafted reply;
 *      Console turns every log line into a breadcrumb; Http/NodeFetch record
 *      URLs, and a media URL carries its object key and signature.)
 *   2. `sendDefaultPii: false`, no tracing, no breadcrumbs, no OpenTelemetry
 *      setup and no module-loader hooks.
 *   3. `beforeSend: scrubEvent`, which REBUILDS every event from an allowlist
 *      of fields -- it does not delete known-bad ones -- and carries NO
 *      FREE TEXT: no exception message, no event message. Every string it
 *      keeps is an identifier, an approved error code or a label of a known
 *      shape; a string that does not match its shape is dropped, not
 *      redacted. redact() recognises credentials and phone numbers, but no
 *      pattern recognises a child's name or a line of a conversation, so the
 *      only safe treatment of free text is not to send it.
 *
 * Layer 3 is written to be sufficient alone, and it is what the tests assert,
 * both directly and through a real SDK client with an in-memory transport.
 *
 * ## Volume
 *
 * Every report passes an ErrorBudget first (error-budget.ts): one event per
 * kind of failure per 15 minutes, 20 an hour per process, so an outage cannot
 * spend the month's quota in minutes. An event sent after a quiet spell
 * carries `suppressed`, the number of the same kind held back meanwhile.
 */
export class SentryErrorTracker implements ErrorTracker {
  readonly name = 'sentry';

  constructor(
    dsn: string,
    component: string,
    build: BuildInfoLike,
    /** Tests only: an in-memory transport, so nothing leaves the process. */
    overrides: Pick<Sentry.NodeOptions, 'transport'> = {},
    /** Tests only: a budget on a fake clock. */
    private readonly budget: ErrorBudget = new ErrorBudget(),
  ) {
    Sentry.init({ ...sentryOptions(dsn, component, build), ...overrides });
  }

  isEnabled(): boolean {
    return true;
  }

  captureException(error: unknown, context: ErrorContext = {}): void {
    try {
      const decision = this.budget.admit(errorKind(error, context), isCriticalReport(context));
      if (!decision.send) return;
      const extra: Record<string, unknown> = {};
      if (context.requestId) extra.request_id = context.requestId;
      if (decision.suppressed > 0) extra.suppressed = decision.suppressed;
      Sentry.captureException(error, {
        tags: {
          route: context.route,
          actor_kind: context.actorKind,
          status: context.status !== undefined ? String(context.status) : undefined,
          component: context.component,
        },
        // The request id, so an event joins the log line that recorded the
        // same failure. An opaque per-request id; it identifies nobody. And
        // how many of the same kind the budget held back since the last one.
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      });
    } catch {
      /* reporting an error must never become the error */
    }
  }

  async close(timeoutMs = 2000): Promise<void> {
    await Sentry.close(timeoutMs);
  }
}

/** Exported so the configuration itself is asserted, not just described. */
export function sentryOptions(dsn: string, component: string, build: BuildInfoLike): Sentry.NodeOptions {
  return {
    dsn,
    environment: build.environment,
    release: build.commit,
    // Layer 1: nothing by default; three integrations that attach no state.
    defaultIntegrations: false,
    integrations: [
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.nodeContextIntegration(),
    ],
    // Layer 2. No IP address, no user identity, no cookies: the question an
    // error tracker answers is "what broke", not "who" -- chat.audit_log
    // answers "who", behind access controls.
    sendDefaultPii: false,
    // Errors only. tracesSampleRate is left UNSET, which is what disables
    // tracing; a tracer here would sample request URLs into a second store.
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    skipOpenTelemetrySetup: true,
    registerEsmLoaderHooks: false,
    initialScope: { tags: { component, version: build.version } },
    // Layer 3.
    beforeSend: (event, hint) => scrubEvent(event, hint),
  };
}

/**
 * Shapes. A string is kept only if it matches its field's shape in full; there
 * is no "redact and keep". Each shape admits identifiers, codes and route
 * templates, and none admits a space between two words of prose -- which is
 * what a name or a sentence needs.
 */
/**
 * An exception's type is the name of its CONSTRUCTOR -- the class as declared
 * in source code (`TypeError`, `PrismaClientKnownRequestError`,
 * `PackageRefused`) -- never `error.name`. `error.name` is a writable string,
 * and no shape can tell `LaylaError` from `PaymentError`; a constructor name is
 * fixed by a class declaration and carries no runtime data. An exception whose
 * error object is not available (a thrown non-Error, a linked error that does
 * not line up) is sent as `Error`.
 */
const CLASS_NAME = /^[A-Za-z_$][\w$]{0,63}$/;
/** Prisma error codes: P1001, P2003. */
const PRISMA_CODE = /^P\d{4}$/;
/** Node system / internal error codes: ECONNREFUSED, ETIMEDOUT, ERR_STREAM_PREMATURE_CLOSE. */
const NODE_CODE = /^E[A-Z0-9_]{1,63}$/;
/** A Postgres SQLSTATE, as Prisma reports it in `meta.code` for a raw-query failure. */
const SQLSTATE = /^[0-9A-Z]{5}$/;
/** Postgres statement timeout; detected from the message, but only the fixed code is sent. */
const STATEMENT_TIMEOUT = /\b57014\b|canceling statement due to statement timeout/;
/** HTTP: `POST /api/v1/conversations/:id/messages`, a template (request-log.ts never passes a resolved path). */
const HTTP_ROUTE = /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|OTHER) (?:\/[\w:.*{}-]*)+$|^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|OTHER) <unmatched>$/;
/** WebSocket: `WS conversation.subscribe` (every handler is `area.action`), `WS handshake`, `WS <unknown>`. */
const WS_ROUTE = /^WS (?:[a-z]{1,32}\.[a-z]{1,32}|handshake|<unknown>)$/;
/**
 * Worker subsystems and process routes: always `area.task` (`outbox.drain`,
 * `cases.due_soon`, `process.unhandledRejection`), or `bootstrap`. Never a
 * bare word, which is what a name would be.
 */
const LABEL = /^[a-z]{1,32}\.[a-zA-Z_]{1,40}$|^bootstrap$/;
const TAG_SHAPES: Record<(typeof ALLOWED_TAGS)[number], (v: string) => boolean> = {
  route: (v) => v.length <= 300 && (HTTP_ROUTE.test(v) || WS_ROUTE.test(v) || LABEL.test(v)),
  // The closed vocabularies, not shapes: a one-word name is a lowercase word too.
  actor_kind: (v) => ['contact', 'staff', 'teacher', 'system'].includes(v),
  status: (v) => /^[1-5]\d\d$/.test(v),
  component: (v) => v === 'api' || v === 'worker',
  version: (v) => /^[\w.+-]{1,64}$/.test(v),
};
/**
 * A stack frame's file, function and module come from V8's call stack: source
 * file paths and function names as written in code, never runtime data (no
 * code here renames a function at runtime). They are kept because they are
 * the diagnosis; they are still shape-checked, so prose cannot pass.
 */
const FRAME_FILE = /^[\w$@./\\:+-]{1,300}$/;
const FRAME_FUNCTION = /^[\w$.<>[\]]{1,200}$|^(?:async |new )?[\w$.<>[\]]{1,200}(?: \[as [\w$]{1,64}\])?$|^Promise\.all \(index \d{1,5}\)$/;
/** environment, release, SDK name and version, runtime and os name and version. */
const META = /^[\w.+:/@-]{1,128}$/;

const keep = (value: unknown, shape: RegExp): string | undefined =>
  typeof value === 'string' && shape.test(value) ? value : undefined;

/** Tags this application sets. Any other tag is dropped. */
const ALLOWED_TAGS = ['route', 'actor_kind', 'status', 'component', 'version'] as const;

type Frame = NonNullable<NonNullable<Sentry.Exception['stacktrace']>['frames']>[number];

/**
 * The backstop: an event is REBUILT from an allowlist, never filtered.
 *
 * Exported so every claim about what leaves this process is tested against it
 * directly. What survives:
 *
 *   identity      event_id, timestamp, platform, level, and environment,
 *                 release and sdk name/version when they match their shape
 *   message       NOTHING. No event message, no logentry.
 *   exceptions    type (the error's constructor name, else `Error`) and a value BUILT from
 *                 approved facts, never copied: the type, plus an approved
 *                 code read from the error object itself (Prisma P-code,
 *                 Node E-code, SQLSTATE, the fixed statement-timeout code)
 *                 and an HTTP status. The error's message is never read.
 *                 Mechanism type/handled; frames as filename, function,
 *                 module, line, column, in_app -- each shape-checked, never
 *                 vars, never source lines.
 *   tags          the five this application sets, each matching its shape
 *   extra         request_id (an opaque id shape) and suppressed (a count)
 *   contexts      runtime and os, name and version only
 *
 * Everything else -- request, user, breadcrumbs, server_name, transaction,
 * fingerprint, modules, other contexts, SDK processing metadata -- does not
 * exist on the event this returns.
 */
export function scrubEvent(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): Sentry.ErrorEvent {
  const out: Sentry.ErrorEvent = {
    type: undefined,
    event_id: keep(event.event_id, /^[0-9a-f]{32}$/i),
    timestamp: typeof event.timestamp === 'number' ? event.timestamp : undefined,
    platform: keep(event.platform, /^[a-z]{1,16}$/),
    level: keep(event.level, /^(?:fatal|error|warning|log|info|debug)$/) as Sentry.SeverityLevel | undefined,
    environment: keep(event.environment, META),
    release: keep(event.release, META),
  };
  const sdkName = keep(event.sdk?.name, META);
  const sdkVersion = keep(event.sdk?.version, META);
  if (sdkName && sdkVersion) out.sdk = { name: sdkName, version: sdkVersion };

  const values = event.exception?.values;
  if (values) {
    const chain = causeChain(hint?.originalException);
    out.exception = {
      values: values.map((exception, i) => {
        // Sentry orders linked errors innermost first; the hint names the
        // outermost (last). An error object is used only when its name agrees
        // with the type Sentry recorded at that position.
        const candidate = chain[values.length - 1 - i];
        const source = candidate instanceof Error && nameOf(candidate) === exception.type ? candidate : undefined;
        const type = (source && keep(declaredClassName(source), CLASS_NAME)) ?? 'Error';
        const mechanismType = keep(exception.mechanism?.type, /^[\w.]{1,64}$/);
        return {
          type,
          value: describe(type, source),
          ...(exception.mechanism
            ? {
                mechanism: {
                  type: mechanismType ?? 'generic',
                  handled: typeof exception.mechanism.handled === 'boolean' ? exception.mechanism.handled : undefined,
                },
              }
            : {}),
          ...(exception.stacktrace?.frames
            ? { stacktrace: { frames: exception.stacktrace.frames.map(safeFrame) } }
            : {}),
        };
      }),
    };
  }

  const tags: Record<string, string> = {};
  for (const key of ALLOWED_TAGS) {
    const raw = event.tags?.[key];
    const value = typeof raw === 'number' ? String(raw) : raw;
    // Shape first; then redact() must find nothing to change -- belt and braces.
    if (typeof value === 'string' && TAG_SHAPES[key](value) && redact(value) === value) tags[key] = value;
  }
  if (Object.keys(tags).length > 0) out.tags = tags;

  const extra: Record<string, string | number> = {};
  const requestId = typeof event.extra?.request_id === 'string' ? acceptRequestId(event.extra.request_id) : undefined;
  if (requestId) extra.request_id = requestId;
  const suppressed = event.extra?.suppressed;
  if (typeof suppressed === 'number' && Number.isSafeInteger(suppressed) && suppressed > 0) extra.suppressed = suppressed;
  if (Object.keys(extra).length > 0) out.extra = extra;

  const contexts: NonNullable<Sentry.ErrorEvent['contexts']> = {};
  for (const key of ['runtime', 'os'] as const) {
    const name = keep(event.contexts?.[key]?.name, META);
    const version = keep(event.contexts?.[key]?.version, META);
    if (name) contexts[key] = version ? { name, version } : { name };
  }
  if (Object.keys(contexts).length > 0) out.contexts = contexts;

  return out;
}

/**
 * An exception's value, built -- never copied. The type, then whatever the
 * error OBJECT says in an approved shape: a code, an HTTP status. The message
 * is read only for the statement-timeout test, and contributes nothing but the
 * fixed code `57014`.
 */
function describe(type: string, error: Error | undefined): string {
  if (!error) return type;
  const e = error as { code?: unknown; errorCode?: unknown; meta?: { code?: unknown }; status?: unknown; getStatus?: unknown };
  const parts = [type];
  const code =
    [e.code, e.errorCode].find((c): c is string => typeof c === 'string' && PRISMA_CODE.test(c)) ??
    (typeof e.code === 'string' && NODE_CODE.test(e.code) ? e.code : undefined);
  if (code) parts.push(code);
  const sqlState = typeof e.meta?.code === 'string' && SQLSTATE.test(e.meta.code) ? e.meta.code : undefined;
  if (sqlState) parts.push(`sqlstate=${sqlState}`);
  else if (STATEMENT_TIMEOUT.test(error.message)) parts.push('sqlstate=57014');
  const status = httpStatus(e);
  if (status !== undefined) parts.push(`status=${status}`);
  return parts.join(' ');
}

function httpStatus(e: { status?: unknown; getStatus?: unknown }): number | undefined {
  let status: unknown = e.status;
  if (typeof e.getStatus === 'function') {
    try {
      status = (e.getStatus as () => unknown)();
    } catch {
      return undefined;
    }
  }
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

/**
 * The name of the class that built this error, read from its PROTOTYPE -- an
 * own `constructor` property on the instance (`error.constructor = {name: ...}`)
 * is ignored -- and only when that constructor really is the function whose
 * prototype it is. What remains is a class declaration's name; renaming a class
 * at runtime from data (`Object.defineProperty(cls, 'name', ...)`) is not done
 * anywhere in this codebase and is the one thing no runtime check can rule out.
 */
function declaredClassName(error: Error): string | undefined {
  try {
    const proto = Object.getPrototypeOf(error) as { constructor?: unknown } | null;
    const ctor = proto && Object.prototype.hasOwnProperty.call(proto, 'constructor') ? proto.constructor : undefined;
    if (typeof ctor !== 'function' || (ctor as { prototype?: unknown }).prototype !== proto) return undefined;
    const name = Object.getOwnPropertyDescriptor(ctor, 'name')?.value;
    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
}

function nameOf(error: Error): string | undefined {
  return typeof error.name === 'string' ? error.name : undefined;
}

/** The original exception and its `cause` chain, outermost first; bounded, and safe against cycles. */
function causeChain(original: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = original;
  while (current instanceof Error && chain.length < 10 && !chain.includes(current)) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function safeFrame(frame: Frame): Frame {
  return {
    filename: keep(frame.filename, FRAME_FILE),
    function: keep(frame.function, FRAME_FUNCTION),
    module: keep(frame.module, FRAME_FILE),
    lineno: typeof frame.lineno === 'number' ? frame.lineno : undefined,
    colno: typeof frame.colno === 'number' ? frame.colno : undefined,
    in_app: typeof frame.in_app === 'boolean' ? frame.in_app : undefined,
  };
}
