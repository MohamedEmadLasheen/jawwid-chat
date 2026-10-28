import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { FIRST_LOGIN_MAILER, selectMailSender } from '../account-recovery/recovery-delivery';
import { AccessRolesController, StaffAccountsController } from './staff-accounts.controller';
import { StaffAccountsService } from './staff-accounts.service';

/**
 * PD-40 PR-3: staff accounts and access roles. PlatformModule is @Global
 * (Prisma, audit); AuthModule provides PasswordResetService (the first sign-in
 * code) and PermissionService.
 */
@Module({
  imports: [AuthModule],
  controllers: [StaffAccountsController, AccessRolesController],
  providers: [StaffAccountsService, { provide: FIRST_LOGIN_MAILER, useFactory: () => selectMailSender() }],
})
export class StaffAccountsModule {}
