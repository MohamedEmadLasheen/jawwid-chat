import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';
import { Public } from '../../platform/auth/auth.guard';

/**
 * Health endpoints. Owner: AI #7 (infrastructure).
 *
 * These are UNAUTHENTICATED by design -- a load balancer has no session -- so
 * the payload is limited to build metadata, probe status and latency. It
 * carries no hostnames, no connection strings, no configuration values, and no
 * customer data.
 *
 * @Public() is what keeps them unauthenticated now that PR-B protects every
 * route by default. Without it a load balancer probe gets a 401 and the
 * instance is drained out of the pool for being healthy.
 *
 * Mount by importing HealthModule in the root module. Nothing else is required.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Liveness. "Is this process wedged?" -- and nothing more.
   *
   * A failing dependency must NOT fail this probe: the orchestrator restarts
   * containers that fail liveness, and restarting an API because Postgres is
   * briefly unavailable adds an outage to an outage.
   */
  @Get('live')
  @Header('Cache-Control', 'no-store')
  live() {
    return this.health.liveness();
  }

  /**
   * Readiness. "Should this instance be in the load balancer pool?"
   *
   * 503 while Postgres or Redis is unreachable, so traffic drains to healthy
   * instances instead of erroring. The container keeps running and rejoins the
   * pool by itself once the dependency returns.
   *
   * The 503 is raised as an exception rather than written through @Res so this
   * controller stays free of any HTTP-adapter import: the same code works if
   * the platform is swapped from Express to Fastify.
   */
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    const report = await this.health.readiness();
    if (report.status !== 'ok') throw new ServiceUnavailableException(report);
    return report;
  }

  /** Human-facing detail for the runbook. Same data, always 200. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async detail() {
    return this.health.readiness();
  }
}
