/** Infrastructure seams owned by AI #7. Import from here, not from file paths. */
export { HealthModule } from './health/health.module';
export { HealthService } from './health/health.service';
export type { HealthReport, ProbeResult, ProbeStatus } from './health/health.service';
export { readBuildInfo } from './build-info';
export type { BuildInfo } from './build-info';
