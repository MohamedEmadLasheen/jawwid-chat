import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';
import { AuthModule } from './platform/auth/auth.module';
import { AdminModule } from './platform/admin.module';
import { CommunicationModule } from './communication/communication.module';
import { AiModule } from './ai/ai.module';
import { HealthModule } from './infra/health/health.module';

/**
 * The root module. Composition only -- it declares no provider and no
 * controller of its own.
 *
 * PlatformModule is @Global and supplies identity, authorization, scope,
 * coverage, audit and Prisma. AuthModule registers the global AuthGuard, so
 * every route added to any module below is authenticated by default. CommunicationModule (AI #2) owns every HTTP
 * controller, the realtime gateway and the outbox worker. HealthModule (AI #7)
 * adds the probes the runtime needs. AiModule (Phase 7) is the intelligence
 * layer: it depends on PlatformModule and PlatformModule does not depend on it,
 * so governance is never downstream of the assistant.
 *
 * Adding a feature means adding its module here, not adding code here.
 */
@Module({
  imports: [PlatformModule, AuthModule, AdminModule, CommunicationModule, AiModule, HealthModule],
})
export class AppModule {}
