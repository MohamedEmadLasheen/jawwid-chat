import { Module } from '@nestjs/common';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import { CommunicationModule } from '../communication/communication.module';
import { AuthModule } from '../platform/auth/auth.module';
import { OBJECT_STORAGE } from '../platform/tokens';
import { TeacherBoardsController, WhiteboardController } from './whiteboard.controller';
import { WhiteboardAssetService } from './whiteboard-asset.service';
import { WhiteboardService } from './whiteboard.service';

/**
 * PD-39: the teacher whiteboard (docs/product/pd039-whiteboard-design.md).
 * Object storage holds a board's images (PR-4), signed only by
 * WhiteboardAssetService, and the purge deletes them with the board. AuthModule gives PermissionService (PD-40);
 * CommunicationModule the NotificationService the retention notice goes through.
 */
@Module({
  imports: [CommunicationModule, AuthModule],
  controllers: [WhiteboardController, TeacherBoardsController],
  providers: [WhiteboardService, WhiteboardAssetService, { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage }],
  exports: [WhiteboardService],
})
export class WhiteboardModule {}
