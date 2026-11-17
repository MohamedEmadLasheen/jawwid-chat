import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { CommunicationModule } from '../communication/communication.module';
import { OBJECT_STORAGE } from '../platform/tokens';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import { AccountDeletionController, AccountDeletionPageController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';
import { TeacherDeletionRequestService } from './teacher-deletion-request.service';

/**
 * PD-56 (store compliance): deleting one's own account, from the app and from
 * the public page. AuthModule provides the password proof, the limiter and the
 * session revocation; storage deletes the erased photos.
 * O-3: a teacher's deletion request (TeacherDeletionRequestService): its
 * reminders go through CommunicationModule's PD-34 pipeline; the Teacher File
 * (TeacherFileModule) imports this module for the staff action.
 */
@Module({
  imports: [AuthModule, CommunicationModule],
  controllers: [AccountDeletionController, AccountDeletionPageController],
  providers: [AccountDeletionService, TeacherDeletionRequestService, { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage }],
  exports: [AccountDeletionService, TeacherDeletionRequestService],
})
export class AccountDeletionModule {}
