import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Owner: AI #7 (infrastructure).
 *
 * Depends on PrismaService, which PlatformModule exports globally. If AI #1
 * replaces PlatformModule's Prisma provider, this module follows automatically
 * -- it resolves the class through DI and never constructs a client itself.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
