import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { ParentRecordModule } from '../parent-profile/parent-record.module';
import { AccountRecoveryController } from './account-recovery.controller';
import { AccountRecoveryService } from './account-recovery.service';
import { RECOVERY_MAILER, RECOVERY_WHATSAPP, selectRecoveryMailer, selectRecoveryWhatsApp } from './recovery-delivery';

/**
 * PD-25: parents recover their own account (`/auth/recovery`). The phone lookup
 * is ParentRecordModule's ParentPhoneDirectory, because only src/parent-profile
 * may read the parent file; the code itself is PD-21's PasswordResetService.
 */
@Module({
  imports: [AuthModule, ParentRecordModule],
  controllers: [AccountRecoveryController],
  providers: [
    AccountRecoveryService,
    { provide: RECOVERY_MAILER, useFactory: () => selectRecoveryMailer() },
    { provide: RECOVERY_WHATSAPP, useFactory: () => selectRecoveryWhatsApp() },
  ],
})
export class AccountRecoveryModule {}
