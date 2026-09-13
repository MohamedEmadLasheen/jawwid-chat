import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';
import { AuthModule } from './platform/auth/auth.module';
import { CommunicationModule } from './communication/communication.module';
import { HealthModule } from './infra/health/health.module';

/**
 * The root module. Composition only -- it declares no provider and no
 * controller of its own.
 *
 * PlatformModule (AI #1) is @Global and supplies identity, authorization,
 * coverage, audit and Prisma. CommunicationModule (AI #2) owns every HTTP
 * controller, the realtime gateway and the outbox worker. HealthModule (AI #7)
 * adds the probes the runtime needs.
 *
 * AuthModule (PR-B) registers the global AuthenticatedGuard, so importing it
 * here protects EVERY route in every other module at once. That is deliberate:
 * a guard opted into per-controller leaves the next controller unauthenticated
 * until somebody remembers.
 *
 * Adding a feature means adding its module here, not adding code here.
 */
@Module({
  imports: [PlatformModule, AuthModule, CommunicationModule, HealthModule],
})
export class AppModule {}
