import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { OBJECT_STORAGE } from '../platform/tokens';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import { AccountDeletionController, AccountDeletionPageController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';

/**
 * PD-56 (store compliance): deleting one's own account, from the app and from
 * the public page. AuthModule provides the password proof, the limiter and the
 * session revocation; storage deletes the erased photos.
 */
@Module({
  imports: [AuthModule],
  controllers: [AccountDeletionController, AccountDeletionPageController],
  providers: [AccountDeletionService, { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage }],
})
export class AccountDeletionModule {}
