import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';
import { CommunicationModule } from './communication/communication.module';
import { HealthModule } from './infra';

/**
 * The composition root.
 *
 * PlatformModule is @Global and supplies PrismaService, AppConfigService,
 * AuthorizationService and the AI #1 seams. CommunicationModule owns the
 * communication domain. HealthModule (AI #7) resolves PrismaService through DI.
 */
@Module({
  imports: [PlatformModule, CommunicationModule, HealthModule],
})
export class AppModule {}
