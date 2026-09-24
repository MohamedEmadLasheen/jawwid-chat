import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { CommErrorFilter } from './communication/api/http-exception.filter';
import { applyInfrastructure } from './infra/http/bootstrap';
import { InfraIoAdapter } from './infra/realtime/io-adapter';
import { readBuildInfo } from './infra/build-info';
import { loadAuthConfig } from './platform/auth/auth.config';
import { RealtimeRelay } from './infra/realtime/realtime-relay.service';
import { MAX_BODY_BYTES } from './communication/core/core-webhook.config';

/** Expressed for the body parser, which takes a string. */
const CORE_WEBHOOK_BODY_LIMIT = `${MAX_BODY_BYTES}b`;

/**
 * API entrypoint.
 *
 * Composition only. It starts the application AI #1 and AI #2 built and applies
 * the deployment concerns AI #7 owns; it contains no business logic and decides
 * nothing about the product.
 *
 * The worker runs from worker.ts, out of the same image (ADR-004).
 */
async function bootstrap(): Promise<void> {
  const log = new Logger('Bootstrap');
  const build = readBuildInfo();

  // Authentication configuration, resolved before anything can serve a request.
  // Fail-closed: a missing or short JWT secret stops the boot with a named
  // cause, rather than surfacing as a 500 on the first login (IDENTITY-MODEL
  // §4, RT-005). Nothing is generated or defaulted -- a signing key nobody
  // configured is a signing key an attacker can guess.
  loadAuthConfig();

  // RT-001 is CLOSED. The boot guard that used to stand here refused to start
  // outside a local environment because the WebSocket handshake still named its
  // own actor. The handshake now carries the same access token as HTTP and is
  // verified by the same AuthService.authenticate(), so there is no seam left
  // to contain -- and realtime notifications can reach a parent in production,
  // which they could not while that guard stood.
  // test/unit/auth/identity-seam.spec.ts pins both halves shut.

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Nest's default logger writes to stdout, which is where the platform
    // collects it. Structured JSON logging is a separate piece of work
    // (docs/infrastructure/monitoring.md §3) and is deliberately not faked here.
    logger: ['error', 'warn', 'log'],
    // REQUIRED BY THE CORE WEBHOOK. Its HMAC covers the exact bytes Core sent;
    // a signature checked against a re-serialised body is not a check, because
    // re-serialising changes key order and whitespace. This keeps the original
    // buffer on the request so the boundary can verify what actually arrived.
    rawBody: true,
  });

  // The Core webhook's body ceiling, applied before anything parses or trusts
  // a body. 1 MiB is far above any legitimate envelope and far below what an
  // unauthenticated caller could use to exhaust memory -- and it matters that
  // it is enforced HERE, ahead of the route, because the cheapest request to
  // refuse is one that never reaches application code.
  app.useBodyParser('json', { limit: CORE_WEBHOOK_BODY_LIMIT });

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

  // Security headers, the CORS allowlist, and graceful shutdown.
  applyInfrastructure(app);

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

  log.log(
    `Jawwid Chat API listening on :${port} ` +
      `[env=${build.environment} commit=${build.commit} version=${build.version}]`,
  );
}

void bootstrap().catch((error: unknown) => {
  // Nest logs the detail; this guarantees a non-zero exit so the platform sees
  // a failed start rather than a container that exited cleanly and quietly.
  const message = error instanceof Error ? error.message : 'unknown error';
  // eslint-disable-next-line no-console
  console.error(`FATAL: API failed to start: ${message}`);
  process.exit(1);
});
