import { INestApplication, Logger } from '@nestjs/common';

/**
 * Infrastructure concerns applied to the HTTP application at startup.
 * Owner: AI #7 (infrastructure).
 *
 * ONE LINE ADOPTS ALL OF IT. In main.ts, after creating the app:
 *
 *   const app = await NestFactory.create(AppModule);
 *   applyInfrastructure(app);
 *   await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
 *
 * Everything here is deployment behaviour -- headers, origins, shutdown --
 * deliberately kept out of the domain modules so AI #1 and AI #2 never have to
 * think about it, and so it cannot be forgotten in a new entrypoint.
 *
 * No new dependency: the headers below are the subset of helmet that actually
 * applies to a JSON API, written directly rather than pulling a package into a
 * manifest that infrastructure does not own.
 */

/** Minimal shapes so this file needs no @types/express. */
interface ResponseLike {
  setHeader(name: string, value: string): void;
}
type NextFn = () => void;

export interface InfrastructureOptions {
  /** Defaults to CORS_ALLOWED_ORIGINS, comma-separated. */
  readonly allowedOrigins?: string[];
  /** Defaults to SHUTDOWN_GRACE_MS, else 15s. */
  readonly shutdownGraceMs?: number;
}

export function applyInfrastructure(
  app: INestApplication,
  options: InfrastructureOptions = {},
): void {
  applySecurityHeaders(app);
  applyCors(app, options.allowedOrigins ?? parseOrigins(process.env.CORS_ALLOWED_ORIGINS));
  applyGracefulShutdown(app, options.shutdownGraceMs ?? Number(process.env.SHUTDOWN_GRACE_MS ?? 15000));
}

export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

function applySecurityHeaders(app: INestApplication): void {
  app.use((_req: unknown, res: ResponseLike, next: NextFn) => {
    // The API returns JSON. Content sniffing on a JSON endpoint is how a
    // reflected value gets executed as script.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Nothing here is meant to be embedded, and an API response rendered in a
    // frame is only ever an attack.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    // Set unconditionally: TLS terminates at the load balancer, so the app sees
    // plain HTTP even in production and cannot decide this for itself. Browsers
    // ignore HSTS received over HTTP, so this is inert in local development.
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Do not advertise the framework.
    res.setHeader('X-Powered-By', '');
    next();
  });
}

function applyCors(app: INestApplication, allowedOrigins: string[]): void {
  const logger = new Logger('Cors');

  if (allowedOrigins.length === 0) {
    // Not a wildcard fallback. An API that carries staff sessions and family
    // communication must never accept an unknown origin because configuration
    // was missing -- failing closed turns a config mistake into a visible
    // browser error rather than a silent cross-origin hole.
    logger.warn('CORS_ALLOWED_ORIGINS is empty; all cross-origin browser requests will be refused');
  }

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // No Origin header: same-origin, curl, or a mobile app. Not a CORS request.
      if (!origin) return callback(null, true);
      return callback(null, allowedOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
}

function applyGracefulShutdown(app: INestApplication, graceMs: number): void {
  const logger = new Logger('Shutdown');
  app.enableShutdownHooks();

  let shuttingDown = false;
  const stop = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`${signal} received; draining (grace ${graceMs}ms)`);

    // The hard stop matters. Without it, one stuck database connection or one
    // long-lived WebSocket keeps the process alive until the platform SIGKILLs
    // it, and every deploy silently drops in-flight work.
    const hardStop = setTimeout(() => {
      logger.error('grace period expired; forcing exit');
      process.exit(1);
    }, graceMs);
    hardStop.unref();

    void app
      .close()
      .then(() => {
        logger.log('closed cleanly');
        clearTimeout(hardStop);
        process.exit(0);
      })
      .catch((e: unknown) => {
        logger.error(`error during shutdown: ${e instanceof Error ? e.name : 'unknown'}`);
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
