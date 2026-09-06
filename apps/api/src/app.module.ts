import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';
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
 * Adding a feature means adding its module here, not adding code here.
 */
@Module({
  imports: [PlatformModule, CommunicationModule, HealthModule],
})
export class AppModule {}
