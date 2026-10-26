import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { SupervisionModule } from '../supervision/supervision.module';
import { LessonModule } from '../lessons/lesson.module';
import { TeacherSupervisorController } from './teacher-supervisor.controller';
import { TeacherSupervisorService } from './teacher-supervisor.service';

/**
 * PD-35: teacher supervisors. CommunicationModule for the seat primitive it
 * registers the 'supervision' reason with; SupervisionModule and LessonModule
 * for the supervision conversation and trial group it re-seats when a teacher's
 * supervisor changes.
 */
@Module({
  imports: [CommunicationModule, SupervisionModule, LessonModule],
  controllers: [TeacherSupervisorController],
  providers: [TeacherSupervisorService],
  exports: [TeacherSupervisorService],
})
export class TeacherSupervisorModule {}
