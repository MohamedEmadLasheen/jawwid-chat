import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { RewardController } from './reward.controller';
import { RewardService } from './reward.service';

/** PD-55: rewards for children during a lesson. */
@Module({
  imports: [CommunicationModule],
  controllers: [RewardController],
  providers: [RewardService],
  exports: [RewardService],
})
export class RewardModule {}
