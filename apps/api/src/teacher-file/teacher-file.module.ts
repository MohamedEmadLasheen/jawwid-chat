import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { TeacherFileController } from './teacher-file.controller';
import { TeacherFileService } from './teacher-file.service';

/**
 * PD-10: the administration-only Teacher File. The only module that may read
 * chat.teacher_file or chat.teacher_supervision_entry. ConversationService
 * comes from CommunicationModule for actor resolution and the read check on a
 * complaint's source conversation; nothing flows the other way.
 */
@Module({
  imports: [CommunicationModule],
  controllers: [TeacherFileController],
  providers: [TeacherFileService],
})
export class TeacherFileModule {}
