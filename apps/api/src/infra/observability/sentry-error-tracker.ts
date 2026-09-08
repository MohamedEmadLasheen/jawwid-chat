import * as Sentry from '@sentry/node';
import { redact } from './json-logger';
import type { BuildInfoLike, ErrorContext, ErrorTracker } from './error-tracker';

/**
 * Integrations removed on purpose, by name.
 *
 * These are the default integrations whose whole job is to attach CONTENT, and
 * content is the one thing this product must not export to a third party.
 *
 *   Console          turns every console line into a breadcrumb. JsonLogger
 *                    writes to stdout through console, so leaving this on would
 *                    ship the entire structured log -- already redacted for a
 *                    log store, never reviewed for an external one -- into
 *                    Sentry as breadcrumbs on every event.
 *   LocalVariables   attaches the local variables of each stack frame. In this
 *                    codebase a local is routinely a message body, a draft
 *                    reply, or a knowledge article. This is the single most
 *                    dangerous default in the SDK for this application.
 *   RequestData      attaches the request body, query string, cookies and
 *                    headers. All four are user-controlled or bearer-carrying.
 *
 * Filtering by name rather than by class keeps this readable and makes an
 * absent name a harmless no-op if the SDK renames one -- `beforeSend` below is
 * the backstop that does not depend on any of these names being right.
 */
const FORBIDDEN_INTEGRATIONS: ReadonlySet<string> = new Set([
  'Console',
  'LocalVariables',
  'RequestData',
  'Http',
  'NodeFetch',
]);

/**
 * Error tracking, via Sentry.
 *
 * ## The privacy contract
 *
 * This product's rule is that conversation content never leaves the systems
 * that govern it. An error tracker is the easiest place in a codebase to break
 * that rule by accident, because its default behaviour is to capture as much
 * surrounding state as it can -- which is exactly the right default for most
 * applications and exactly the wrong one here.
 *
 * So the defence is in three layers, and the third does not trust the first two:
 *
 *   1. the dangerous integrations are not loaded at all (above);
 *   2. `sendDefaultPii` stays false, so no IP address and no user identity;
 *   3. `beforeSend` rewrites every event that survives -- redacting the message
 *      and every stack-frame value through the SAME `redact()` the log store
 *      uses, and deleting the request payload wholesale rather than filtering
 *      it, because an allowlist of safe request fields is a list somebody
 *      eventually adds `body` to.
 *
 * Layer 3 is written to be sufficient on its own. If a future SDK version
 * renames an integration and layer 1 silently stops matching, nothing leaks.
 */
export class SentryErrorTracker implements ErrorTracker {
  readonly name = 'sentry';

  static isConfigured(): boolean {
    return Boolean(process.env.SENTRY_DSN);
  }

  constructor(component: string, build: BuildInfoLike) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: build.environment,
      release: build.commit,
      // No IP address, no user identity, no cookies. The question an error
      // tracker answers is "what broke", and it does not need to know who to
      // answer it -- chat.audit_log answers "who", behind access controls.
      sendDefaultPii: false,
      // Errors only. Tracing is the metrics pipeline's job (monitoring.md §1
      // -- one system per concern), and a tracer here would sample request
      // URLs into a second store.
      tracesSampleRate: 0,
      integrations: (defaults) =>
        defaults.filter((integration) => !FORBIDDEN_INTEGRATIONS.has(integration.name)),
      initialScope: { tags: { component, version: build.version } },
      beforeSend: scrubEvent,
      // Breadcrumbs are dropped entirely rather than filtered. They exist to
      // reconstruct what happened before the error, which in this application
      // means reconstructing somebody's conversation.
      beforeBreadcrumb: () => null,
    });
  }

  isEnabled(): boolean {
    return true;
  }

  captureException(error: unknown, context: ErrorContext = {}): void {
    Sentry.captureException(error, {
      tags: {
        route: context.route,
        actor_kind: context.actorKind,
        status: context.status !== undefined ? String(context.status) : undefined,
        component: context.component,
      },
      // The request id, so an event can be joined to the log line that
      // recorded the same failure. It is an opaque per-request uuid and
      // identifies nobody.
      extra: { request_id: context.requestId },
    });
  }

  async close(timeoutMs = 2000): Promise<void> {
    await Sentry.close(timeoutMs);
  }
}

/**
 * The backstop, exported so it can be tested directly rather than through a
 * live SDK. Every assertion about what does not leave this process is written
 * against this function.
 */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // The request object carries the body, the query string, the cookies and the
  // headers. DELETED, not filtered: an allowlist of safe request fields is a
  // list somebody eventually adds `body` to, and the route pattern we do want
  // is already attached as a tag.
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  // `server_name` is the container hostname; harmless, but it is infrastructure
  // detail the event does not need.
  delete event.server_name;

  if (event.message) event.message = redact(event.message);

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redact(exception.value);

    for (const frame of exception.stacktrace?.frames ?? []) {
      // Belt to the LocalVariables braces. If that integration is ever loaded
      // by a default set this code did not anticipate, the values still do not
      // survive this.
      delete frame.vars;
      // Source context is the SOURCE FILE's lines, which are ours and contain
      // no user data -- but a template literal in a source line can echo a
      // variable name, and there is no value in shipping it, so it goes too.
      delete frame.pre_context;
      delete frame.context_line;
      delete frame.post_context;
    }
  }

  // Anything a caller attached under `extra` is redacted rather than trusted:
  // this function is the last thing to run before the event leaves.
  if (event.extra) {
    for (const [key, value] of Object.entries(event.extra)) {
      if (typeof value === 'string') event.extra[key] = redact(value);
    }
  }

  return event;
}
