import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { CardPoster } from './card-poster';
import { SupervisionController } from './supervision.controller';
import { SupervisionConversationService } from './supervision-conversation.service';

/**
 * PD-11 / PD-12: the teacher supervision conversation, and the card poster the
 * PD-12 tickets share. PlatformModule is @Global (Prisma, authorization, audit).
 */
@Module({
  imports: [CommunicationModule],
  controllers: [SupervisionController],
  providers: [SupervisionConversationService, CardPoster],
  exports: [SupervisionConversationService, CardPoster],
})
export class SupervisionModule {}
