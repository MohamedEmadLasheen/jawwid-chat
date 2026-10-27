import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { LessonModule } from '../lessons/lesson.module';
import { TeacherFileController } from './teacher-file.controller';
import { TeacherFileService } from './teacher-file.service';
import { TeacherPayrollService } from './teacher-payroll.service';
import { ParentFeedbackController } from './parent-feedback.controller';
import { ParentFeedbackService } from './parent-feedback.service';
import { SupervisionModule } from '../supervision/supervision.module';
import { TeacherEvaluationController } from './teacher-evaluation.controller';
import { TeacherEvaluationService } from './teacher-evaluation.service';

/**
 * PD-10: the administration-only Teacher File. The only module that may read
 * chat.teacher_file or chat.teacher_supervision_entry. ConversationService
 * comes from CommunicationModule for actor resolution and the read check on a
 * complaint's source conversation; nothing flows the other way. PD-18 payroll
 * (TeacherPayrollService) lives here too, behind the same confinement, and so
 * does PD-32 parent feedback (ParentFeedbackService): a parent's complaint is a
 * supervision entry. PD-35's evaluations and improvement plans live here too;
 * SupervisionModule posts their cards in the teacher's supervision conversation.
 */
@Module({
  // LessonModule: PD-11's bonus ticket, which a reward with its amount extends
  // (PD-26). Nothing under LessonModule or SupervisionModule imports this
  // module, so no cycle.
  imports: [CommunicationModule, SupervisionModule, LessonModule],
  controllers: [TeacherFileController, ParentFeedbackController, TeacherEvaluationController],
  providers: [TeacherFileService, TeacherPayrollService, ParentFeedbackService, TeacherEvaluationService],
})
export class TeacherFileModule {}
