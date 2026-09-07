import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CommErrorFilter } from './communication/api/http-exception.filter';
import { applyInfrastructure } from './infra/http/bootstrap';
import { InfraIoAdapter } from './infra/realtime/io-adapter';
import { readBuildInfo } from './infra/build-info';
import {
  assertAuthSecretsConfigured,
  assertRuntimeRoleAcceptable,
  type RuntimeRoleReport,
} from './platform/auth/startup';
import { PrismaService } from './platform/prisma.service';
import { RealtimeRelay } from './infra/realtime/realtime-relay.service';
import { JsonLogger } from './infra/observability/json-logger';
import { RequestLogInterceptor } from './infra/observability/request-log.interceptor';

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

  // Phase 1. The x-actor-id / handshake.auth.actorId seam is gone, and with it
  // the guard that kept a build carrying it out of a real network (RT-001).
  // What replaces it is the opposite check: authentication must be configured
  // before the process serves anything, or it would issue forgeable tokens and
  // report itself healthy.
  assertAuthSecretsConfigured();

  // Structured JSON to stdout, one object per line, in the format
  // docs/infrastructure/monitoring.md §3 specifies. Constructed BEFORE the
  // application so the lines Nest writes while wiring modules are in the same
  // format as everything after -- a startup failure is exactly when a log has
  // to be machine-readable, and it is the one moment a logger installed later
  // would miss.
  const logger = new JsonLogger('api', build);

  const app = await NestFactory.create(AppModule, {
    logger,
  });

  // One line per request: route pattern, status, latency, request id. It logs
  // no body, no query string and no headers -- the privacy rule is enforced by
  // never touching content, not by scrubbing it afterwards.
  app.useGlobalInterceptors(new RequestLogInterceptor(logger));

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

  // The second authorization layer is only a layer if the connection cannot
  // ignore it. Checked here, before the first request, because a process that
  // discovers this from a leak has discovered it too late.
  const [role] = await app
    .get(PrismaService)
    .$queryRaw<RuntimeRoleReport[]>`select * from chat.runtime_role_report()`;
  assertRuntimeRoleAcceptable(role);
  log.log(
    `database role=${role.role_name} ` +
      `rls=${role.bypasses_rls ? 'BYPASSED' : 'enforced'} ` +
      `owner=${role.owns_schema}`,
  );

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
