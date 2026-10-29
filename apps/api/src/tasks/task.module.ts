import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

/**
 * PD-47: tasks. CommunicationModule for the outbox. Scope is read from the
 * database (chat.work_task_standing), so nothing else is imported, and none
 * imports this module yet (PR-2's sources will).
 */
@Module({
  imports: [CommunicationModule],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
