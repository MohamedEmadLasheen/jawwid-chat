import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { LessonModule } from '../lessons/lesson.module';
import { TeacherFileModule } from '../teacher-file/teacher-file.module';
import { SupervisionCaseController } from './supervision-case.controller';
import { SupervisionCaseService } from './supervision-case.service';

/**
 * PD-35 B5: escalation cases. LessonModule for the lesson standing and the
 * teacher scope a subject is checked against; TeacherFileModule for who a
 * parent's feedback is about (PD-32 keeps it there). Neither imports this
 * module, so no cycle. The worker runs SupervisionCaseService.sweepDueSoon.
 */
@Module({
  imports: [CommunicationModule, LessonModule, TeacherFileModule],
  controllers: [SupervisionCaseController],
  providers: [SupervisionCaseService],
  exports: [SupervisionCaseService],
})
export class SupervisionCaseModule {}
