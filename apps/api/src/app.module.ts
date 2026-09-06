import { Module } from '@nestjs/common';
import { PlatformModule } from '@platform/platform.module';
import { CommunicationModule } from '@communication/communication.module';
import { IntegrationModule } from '@integration/integration.module';
import { HealthModule } from './infra/health/health.module';

/**
 * The application graph.
 *
 * PlatformModule is @Global and carries Prisma, authorization, coverage and
 * audit. CommunicationModule is AI #2's. IntegrationModule is the Jawwid Core
 * boundary and is the only module that may accept Core traffic.
 */
@Module({
  imports: [PlatformModule, HealthModule, CommunicationModule, IntegrationModule],
})
export class AppModule {}
