import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { FIRST_LOGIN_MAILER, selectMailSender } from '../account-recovery/recovery-delivery';
import { AccountAdminController } from './account-admin.controller';
import { AccountAdminService } from './account-admin.service';
import { ImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';

/**
 * PD-21 account administration. PlatformModule is @Global (Prisma, audit,
 * AuthorizationService); AuthModule provides the session revocation and the
 * password-reset codes. The mailer carries the reset codes a manager issues
 * for a staff account, which are never shown to them (PD-40).
 */
@Module({
  imports: [AuthModule],
  controllers: [AccountAdminController, ImpersonationController],
  providers: [AccountAdminService, ImpersonationService, { provide: FIRST_LOGIN_MAILER, useFactory: () => selectMailSender() }],
})
export class AccountAdminModule {}
