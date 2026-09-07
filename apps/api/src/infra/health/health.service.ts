import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../../platform/prisma.service';
import {
  isLeastPrivileged,
  OWNER_CONNECTION_ALLOWED_ENVIRONMENTS,
  type RuntimeRoleReport,
} from '../../platform/auth/startup';
import { BuildInfo, readBuildInfo } from '../build-info';

export type ProbeStatus = 'up' | 'down' | 'skipped';

export interface ProbeResult {
  readonly status: ProbeStatus;
  readonly latencyMs: number;
  /**
   * Failure reason. Sanitised: an error message may embed the connection
   * string that produced it, and a connection string carries a password.
   */
  readonly error?: string;
}

export interface HealthReport {
  readonly status: 'ok' | 'degraded';
  readonly build: BuildInfo;
  readonly uptimeSeconds: number;
  readonly checks: Record<string, ProbeResult>;
  /**
   * Whether row-level security actually applies to this process's connection.
   *
   * RLS-STRATEGY.md 7, acceptance item 1. Reported rather than merely asserted
   * at boot because it is a deployment fact that can change under the process
   * (a failover onto a differently-configured replica, a rotated secret that
   * points somewhere else), and a probe that hid it would let "RLS is enabled"
   * stay true on paper while every query ran as the owner.
   *
   * It names no connection string. `databaseRole` is the role NAME only, which
   * an operator needs in order to act on a false here.
   */
  readonly rlsEnforced: boolean | null;
  readonly databaseRole: string | null;
  /** True only when the role is not a superuser, owner, creator or BYPASSRLS. */
  readonly leastPrivileged: boolean | null;
}

/**
 * Dependency probes behind the health endpoints. Owner: AI #7.
 *
 * Two rules shape everything here:
 *
 *  1. Every probe is bounded by a timeout. An unbounded health check turns a
 *     slow dependency into a hung health endpoint, and a hung health endpoint
 *     reads to the orchestrator as a dead process -- so a slow database would
 *     cause a restart storm instead of a degraded service.
 *
 *  2. No probe ever returns a connection string, credential, or raw driver
 *     error to the caller. `/health` is reachable by the load balancer and, in
 *     some hosting setups, by anything that can route to the container.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly build = readBuildInfo();
  private readonly startedAt = Date.now();
  private redis?: Redis;

  constructor(private readonly prisma: PrismaService) {}

  /** Lazily created so importing the module does not open a socket. */
  private redisClient(): Redis | undefined {
    const url = process.env.REDIS_URL;
    if (!url) return undefined;
    if (!this.redis) {
      this.redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        // The probe owns the timeout; do not let ioredis retry forever behind it.
        retryStrategy: () => null,
        enableOfflineQueue: false,
      });
      // An unhandled 'error' event on an ioredis client crashes the process.
      // Health checking a broken Redis must not kill the API.
      this.redis.on('error', (e) => this.logger.debug(`redis probe: ${e.name}`));
    }
    return this.redis;
  }

  async database(): Promise<ProbeResult> {
    return this.probe('database', () => this.prisma.$queryRaw`select 1`);
  }

  async redisProbe(): Promise<ProbeResult> {
    const client = this.redisClient();
    if (!client) return { status: 'skipped', latencyMs: 0 };
    return this.probe('redis', async () => {
      if (client.status !== 'ready') await client.connect();
      await client.ping();
    });
  }

  /**
   * Readiness: may this instance receive traffic?
   *
   * Postgres and Redis only. Jawwid Core, the push providers and LiveKit are
   * deliberately excluded -- see docs/infrastructure/architecture.md
   * "Failure boundaries". A Core outage degrades specific features; it does not
   * make this instance unable to serve the requests that do not touch Core.
   */
  async readiness(): Promise<HealthReport> {
    const [database, redis, role] = await Promise.all([
      this.database(),
      this.redisProbe(),
      this.runtimeRoleProbe(),
    ]);
    const checks = { database, redis };
    const blocking = Object.values(checks).filter((c) => c.status === 'down');

    // Outside local, an over-privileged connection makes this instance
    // UNREADY. The process already refuses to start on one; this covers the
    // case where the connection changes under a running process -- a failover
    // onto a differently configured host, or a rotated secret pointing
    // elsewhere. Draining is the right response: the instance is serving
    // requests with one of its two authorization layers switched off.
    const roleAcceptable =
      role === null ||
      OWNER_CONNECTION_ALLOWED_ENVIRONMENTS.has(
        (process.env.APP_ENV ?? 'local').trim().toLowerCase(),
      ) ||
      isLeastPrivileged(role);

    return {
      status: blocking.length === 0 && roleAcceptable ? 'ok' : 'degraded',
      build: this.build,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      checks,
      rlsEnforced: role === null ? null : !role.bypasses_rls,
      databaseRole: role?.role_name ?? null,
      leastPrivileged: role === null ? null : isLeastPrivileged(role),
    };
  }

  /** null when it cannot be determined; never on its own a reason to fail. */
  private async runtimeRoleProbe(): Promise<RuntimeRoleReport | null> {
    try {
      const rows = await this.prisma.$queryRaw<RuntimeRoleReport[]>`
        select * from chat.runtime_role_report()
      `;
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Liveness: is this process itself functional? Never touches a dependency. */
  liveness(): Pick<HealthReport, 'status' | 'build' | 'uptimeSeconds'> {
    return {
      status: 'ok',
      build: this.build,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }

  private async probe(name: string, fn: () => Promise<unknown>): Promise<ProbeResult> {
    const timeoutMs = Number(process.env.HEALTH_PROBE_TIMEOUT_MS ?? 2000);
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        fn(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('probe timed out')), timeoutMs);
        }),
      ]);
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (e) {
      const error = sanitiseProbeError(e);
      this.logger.warn(`health probe '${name}' failed: ${error}`);
      return { status: 'down', latencyMs: Date.now() - started, error };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Driver errors routinely quote the DSN that failed, and a DSN contains a
 * password. We return the error *class*, not its message.
 */
export function sanitiseProbeError(e: unknown): string {
  if (e instanceof Error) {
    if (e.message === 'probe timed out') return 'timeout';
    return e.name || 'error';
  }
  return 'error';
}
