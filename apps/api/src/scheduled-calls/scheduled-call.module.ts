import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { SupervisionModule } from '../supervision/supervision.module';
import { ScheduledCallController } from './scheduled-call.controller';
import { ScheduledCallService } from './scheduled-call.service';

/**
 * PD-13: scheduled calls and call links. Consumes the frozen call stack
 * (CallService) and the shared card poster; PlatformModule is @Global.
 */
@Module({
  imports: [CommunicationModule, SupervisionModule],
  controllers: [ScheduledCallController],
  providers: [ScheduledCallService],
})
export class ScheduledCallModule {}
