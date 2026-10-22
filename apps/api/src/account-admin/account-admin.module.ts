import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { AccountAdminController } from './account-admin.controller';
import { AccountAdminService } from './account-admin.service';
import { ImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';

/**
 * PD-20 account administration. PlatformModule is @Global (Prisma, audit,
 * AuthorizationService); AuthModule provides the session revocation and the
 * password-reset codes.
 */
@Module({
  imports: [AuthModule],
  controllers: [AccountAdminController, ImpersonationController],
  providers: [AccountAdminService, ImpersonationService],
})
export class AccountAdminModule {}
