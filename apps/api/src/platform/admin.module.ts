import { Module } from '@nestjs/common';
import { FamilyService } from './families/family.service';
import { FamilyController } from './families/family.controller';
import { UserAdminService } from './users/user-admin.service';
import { UserAdminController } from './users/user-admin.controller';

/**
 * The administrative surface Phase 1 requires: families and who supervises
 * them, and accounts and what they may do.
 *
 * It is a separate module from PlatformModule because PlatformModule is
 * @Global and declares no controller -- composition stays explicit, and this
 * module can be omitted from a deployment that does not serve the admin web
 * application without touching the engine.
 */
@Module({
  controllers: [FamilyController, UserAdminController],
  providers: [FamilyService, UserAdminService],
  exports: [FamilyService, UserAdminService],
})
export class AdminModule {}
