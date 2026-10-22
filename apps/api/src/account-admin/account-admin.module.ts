import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { AccountAdminController } from './account-admin.controller';
import { AccountAdminService } from './account-admin.service';

/**
 * PD-20 account administration. PlatformModule is @Global (Prisma, audit,
 * AuthorizationService); AuthModule provides the session revocation and the
 * password-reset codes.
 */
@Module({
  imports: [AuthModule],
  controllers: [AccountAdminController],
  providers: [AccountAdminService],
})
export class AccountAdminModule {}
