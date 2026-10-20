import * as Sentry from '@sentry/node';
import { isPrismaError, redact, safeErrorMessage } from './redact';
import type { BuildInfoLike, ErrorContext, ErrorTracker } from './error-tracker';

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
 *      of fields -- it does not delete known-bad ones -- and runs every string
 *      it keeps through the same redact() the log store uses.
 *
 * Layer 3 is written to be sufficient alone, and it is what the tests assert,
 * both directly and through a real SDK client with an in-memory transport.
 */
export class SentryErrorTracker implements ErrorTracker {
  readonly name = 'sentry';

  constructor(
    dsn: string,
    component: string,
    build: BuildInfoLike,
    /** Tests only: an in-memory transport, so nothing leaves the process. */
    overrides: Pick<Sentry.NodeOptions, 'transport'> = {},
  ) {
    Sentry.init({ ...sentryOptions(dsn, component, build), ...overrides });
  }

  isEnabled(): boolean {
    return true;
  }

  captureException(error: unknown, context: ErrorContext = {}): void {
    try {
      Sentry.captureException(error, {
        tags: {
          route: context.route,
          actor_kind: context.actorKind,
          status: context.status !== undefined ? String(context.status) : undefined,
          component: context.component,
        },
        // The request id, so an event joins the log line that recorded the
        // same failure. An opaque per-request id; it identifies nobody.
        extra: context.requestId ? { request_id: context.requestId } : undefined,
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

/** Tags this application sets. Any other tag is dropped. */
const ALLOWED_TAGS = ['route', 'actor_kind', 'status', 'component', 'version'] as const;

/** Contexts that describe the runtime, not a request or a person. */
const ALLOWED_CONTEXTS = ['runtime', 'os'] as const;

type Frame = NonNullable<NonNullable<Sentry.Exception['stacktrace']>['frames']>[number];

/**
 * The backstop: an event is REBUILT from an allowlist, never filtered.
 *
 * Exported so every claim about what leaves this process is tested against it
 * directly. What survives:
 *
 *   identity      event_id, timestamp, platform, level, environment, release, sdk
 *   message       redacted
 *   exceptions    type; value redacted (a Prisma error: class and code only);
 *                 mechanism type/handled; frames as filename, function, module,
 *                 line, column, in_app -- never vars, never source lines
 *   tags          the five this application sets, values redacted
 *   extra         request_id only, redacted
 *   contexts      runtime and os
 *
 * Everything else -- request, user, breadcrumbs, server_name, transaction,
 * modules, other contexts, SDK processing metadata -- does not exist on the
 * event this returns. An allowlist of request fields is a list somebody
 * eventually adds `body` to; there is no request here to add to.
 */
export function scrubEvent(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): Sentry.ErrorEvent {
  const out: Sentry.ErrorEvent = {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    environment: event.environment,
    release: event.release,
    sdk: event.sdk,
  };

  if (typeof event.message === 'string') out.message = redact(event.message);
  if (event.logentry?.message) out.logentry = { message: redact(event.logentry.message) };

  const values = event.exception?.values;
  if (values) {
    const original = hint?.originalException;
    out.exception = {
      values: values.map((exception, i) => {
        // The outermost exception (last in Sentry's order) is the one the hint
        // names; a Prisma error anywhere is reduced to its class.
        const isOriginal = i === values.length - 1 && original instanceof Error;
        let value: string | undefined;
        if (isOriginal && isPrismaError(original)) value = safeErrorMessage(original);
        else if (/^PrismaClient\w*Error$/.test(exception.type ?? '')) value = exception.type;
        else if (exception.value !== undefined) value = redact(exception.value);
        return {
          type: exception.type,
          value,
          ...(exception.mechanism
            ? { mechanism: { type: exception.mechanism.type, handled: exception.mechanism.handled } }
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
    const value = event.tags?.[key];
    if (typeof value === 'string' || typeof value === 'number') tags[key] = redact(String(value));
  }
  if (Object.keys(tags).length > 0) out.tags = tags;

  const requestId = event.extra?.request_id;
  if (typeof requestId === 'string') out.extra = { request_id: redact(requestId) };

  const contexts: NonNullable<Sentry.ErrorEvent['contexts']> = {};
  for (const key of ALLOWED_CONTEXTS) {
    if (event.contexts?.[key]) contexts[key] = event.contexts[key];
  }
  if (Object.keys(contexts).length > 0) out.contexts = contexts;

  return out;
}

function safeFrame(frame: Frame): Frame {
  return {
    filename: frame.filename,
    function: frame.function,
    module: frame.module,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
  };
}
