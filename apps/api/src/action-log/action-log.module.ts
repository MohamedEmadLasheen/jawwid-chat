import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { ActionLogController } from './action-log.controller';
import { ActionLogService } from './action-log.service';

/** PD-35 B7: a staff member's action log, read from what is already recorded. */
@Module({
  imports: [CommunicationModule],
  controllers: [ActionLogController],
  providers: [ActionLogService],
})
export class ActionLogModule {}
