import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { LessonModule } from '../lessons/lesson.module';
import { SupervisionModule } from '../supervision/supervision.module';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';

/**
 * PD-12 S1: teacher leave. Its own module so the dependency runs one way:
 * leave uses lessons (to cancel the ones inside an approved leave) and the
 * supervision conversation (to post its cards), and neither uses leave.
 */
@Module({
  imports: [CommunicationModule, SupervisionModule, LessonModule],
  controllers: [LeaveController],
  providers: [LeaveService],
})
export class LeaveModule {}
