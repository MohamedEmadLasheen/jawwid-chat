import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CommErrorFilter } from './communication/api/http-exception.filter';
import { applyInfrastructure } from './infra/http/bootstrap';
import { InfraIoAdapter } from './infra/realtime/io-adapter';
import { readBuildInfo } from './infra/build-info';
import { loadAuthConfig } from './platform/auth/auth.config';
import { RealtimeRelay } from './infra/realtime/realtime-relay.service';
import { JsonLogger } from './infra/observability/json-logger';
import { createErrorTracker } from './infra/observability/error-tracker';
import { flushErrorTracker, installProcessErrorHandlers } from './infra/observability/process-errors';
import { safeErrorMessage } from './infra/observability/redact';
import {
  RequestErrorCaptureInterceptor,
  requestLogMiddleware,
} from './infra/observability/request-log';

/**
 * API entrypoint.
 *
 * Composition only. It starts the application AI #1 and AI #2 built and applies
 * the deployment concerns AI #7 owns; it contains no business logic and decides
 * nothing about the product.
 *
 * The worker runs from worker.ts, out of the same image (ADR-004).
 */
const build = readBuildInfo();

// Structured JSON to stdout, one object per line (docs/infrastructure/
// monitoring.md §3). Constructed BEFORE the application so the lines Nest
// writes while wiring modules are in the same format as everything after -- a
// startup failure is exactly when a log has to be machine-readable.
const logger = new JsonLogger('api', build);

// Error tracking: Sentry when SENTRY_DSN is set, inert otherwise (every
// developer machine). Created alongside the logger, and the process handlers
// installed at once, so a failure during wiring is reported too.
const errors = createErrorTracker('api', build);
installProcessErrorHandlers(errors, logger);

async function bootstrap(): Promise<void> {
  const log = new Logger('Bootstrap');

  // Authentication configuration, resolved before anything can serve a request.
  // Fail-closed: a missing or short JWT secret stops the boot with a named
  // cause, rather than surfacing as a 500 on the first login (IDENTITY-MODEL
  // §4, RT-005). Nothing is generated or defaulted -- a signing key nobody
  // configured is a signing key an attacker can guess.
  loadAuthConfig();

  // RT-001 is CLOSED on both halves as of Phase 8, so there is no boot
  // restriction here any more. HTTP identity is a verified bearer token
  // (PR-B); WebSocket identity is the same token verified by the same
  // AuthService (realtime.gateway.ts#handleConnection). The guard that kept a
  // self-asserted-identity build out of production was deleted with the seam it
  // was containing -- see platform/identity-seam.ts.

  const app = await NestFactory.create(AppModule, {
    // JSON lines, filtered by LOG_LEVEL (default info).
    logger,

    // Keep the request body as the bytes that arrived, alongside the parsed
    // object. The LiveKit webhook's JWT carries a `sha256` claim over exactly
    // those bytes, so verification has to hash the original: a re-serialized
    // object hashes differently and every webhook would be refused. Nothing
    // else reads `rawBody`, and no route's parsed body changes.
    rawBody: true,
  });

  // /api/v1 matches the base URL Admin Web and the mobile clients are built
  // against. Health is excluded: a load balancer probes /health/live, and
  // versioning a liveness probe makes it a moving target during a migration.
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'health/live', 'health/ready'],
  });

  // Registered globally so every route maps a domain error to the same stable
  // {error:{code,message}} body. Registering it per-controller, as the
  // controllers currently do, leaves any future controller inconsistent.
  app.useGlobalFilters(new CommErrorFilter());

  // One log line per request -- method, route TEMPLATE, final status, latency,
  // request id, actor kind -- and 5xx to the error tracker. Middleware, so it
  // also sees guard refusals and unmatched routes, which an interceptor never
  // does; registered first, so every later middleware's response is logged.
  // It reads no body, no query string and no header but X-Request-Id.
  app.use(requestLogMiddleware(logger, errors));
  // Hands the exception a handler threw to the request log, so a 5xx is
  // reported with its stack. Logs nothing and rethrows untouched.
  app.useGlobalInterceptors(new RequestErrorCaptureInterceptor());

  // Security headers, the CORS allowlist, and graceful shutdown (which flushes
  // the error tracker before the process exits).
  applyInfrastructure(app, { beforeExit: () => flushErrorTracker(errors) });

  const ioAdapter = new InfraIoAdapter(app);
  await ioAdapter.connectToRedis(process.env.REDIS_URL);
  app.useWebSocketAdapter(ioAdapter);

  // Subscribes to the channel the worker publishes realtime events on (D-2).
  // Started before listen() so no event can arrive while nothing is relaying.
  await app.get(RealtimeRelay).start();

  const port = Number(process.env.PORT ?? 3000);
  // 0.0.0.0, not localhost: inside a container, binding the loopback interface
  // makes the process unreachable from outside it, including by its own
  // healthcheck.
  await app.listen(port, '0.0.0.0');

  log.log(`error tracking: ${errors.isEnabled() ? errors.name : 'disabled (no SENTRY_DSN)'}`);
  log.log(
    `Jawwid Chat API listening on :${port} ` +
      `[env=${build.environment} commit=${build.commit} version=${build.version}]`,
  );
}

void bootstrap().catch(async (error: unknown) => {
  // A non-zero exit so the platform sees a failed start rather than a
  // container that exited cleanly and quietly. Logged through the JSON logger
  // (message only, redacted), reported, and flushed before the exit.
  logger.fatal(`API failed to start: ${safeErrorMessage(error)}`, 'Bootstrap');
  errors.captureException(error, { route: 'bootstrap', component: 'api' });
  await flushErrorTracker(errors);
  process.exit(1);
});
