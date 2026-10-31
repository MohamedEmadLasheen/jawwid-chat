import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { LessonModule } from '../lessons/lesson.module';
import { SupervisionModule } from '../supervision/supervision.module';
import { DisciplineController } from './discipline.controller';
import { DisciplineService } from './discipline.service';

/**
 * PD-12 S2: the teacher discipline ladder. Its own module, depending one way:
 * on lessons (cancelling inside a suspension) and on the supervision
 * conversation (its cards); neither depends on it.
 */
@Module({
  imports: [CommunicationModule, SupervisionModule, LessonModule],
  controllers: [DisciplineController],
  providers: [DisciplineService],
  // PD-44: the Dashboard's Teachers section counts this page's list.
  exports: [DisciplineService],
})
export class DisciplineModule {}
