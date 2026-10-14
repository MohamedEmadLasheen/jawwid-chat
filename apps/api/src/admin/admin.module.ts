import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminInspectionService } from './admin-inspection.service';

/**
 * The Admin Portal backend. PlatformModule is @Global, so Prisma, identity and
 * AuthorizationService arrive without an import; AuthModule's global guard
 * already protects every route declared here.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminInspectionService],
})
export class AdminModule {}
