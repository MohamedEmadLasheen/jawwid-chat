import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { TeacherFileController } from './teacher-file.controller';
import { TeacherFileService } from './teacher-file.service';
import { TeacherPayrollService } from './teacher-payroll.service';

/**
 * PD-10: the administration-only Teacher File. The only module that may read
 * chat.teacher_file or chat.teacher_supervision_entry. ConversationService
 * comes from CommunicationModule for actor resolution and the read check on a
 * complaint's source conversation; nothing flows the other way. PD-18 payroll
 * (TeacherPayrollService) lives here too, behind the same confinement.
 */
@Module({
  imports: [CommunicationModule],
  controllers: [TeacherFileController],
  providers: [TeacherFileService, TeacherPayrollService],
})
export class TeacherFileModule {}
