import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CommErrorFilter } from './communication/api/http-exception.filter';
import { applyInfrastructure } from './infra/http/bootstrap';
import { InfraIoAdapter } from './infra/realtime/io-adapter';
import { readBuildInfo } from './infra/build-info';
import { RealtimeRelay } from './infra/realtime/realtime-relay.service';

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

  const app = await NestFactory.create(AppModule, {
    // Nest's default logger writes to stdout, which is where the platform
    // collects it. Structured JSON logging is a separate piece of work
    // (docs/infrastructure/monitoring.md §3) and is deliberately not faked here.
    logger: ['error', 'warn', 'log'],
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
