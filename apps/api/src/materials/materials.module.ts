import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { LessonModule } from '../lessons/lesson.module';
import { MaterialsController } from './materials.controller';
import { MaterialsAdminService } from './materials-admin.service';
import { MaterialsReaderService } from './materials-reader.service';
import { MaterialsPlayController } from './play.controller';
import { OBJECT_STORAGE } from '../platform/tokens';
import { selectObjectStorage } from '../communication/attachments/storage.provider';

/**
 * PD-29: Materials -- the open library, practice this week and the
 * memorization map. The report's own practice and marks are written by
 * ReportMaterials, which LessonModule provides (the report's writers call it);
 * this module reads them and owns the library, the recitations and playing.
 */
@Module({
  imports: [CommunicationModule, LessonModule],
  controllers: [MaterialsController, MaterialsPlayController],
  // OBJECT_STORAGE is selected by the same factory CommunicationModule uses, so
  // both reach the same store.
  providers: [MaterialsAdminService, MaterialsReaderService, { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage }],
  exports: [MaterialsAdminService, MaterialsReaderService],
})
export class MaterialsModule {}
