import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import {
  MEDIA_TOKEN_ISSUER,
  OBJECT_STORAGE,
  PUSH_PROVIDER,
  REALTIME_PUBLISHER,
} from '../platform/tokens';

import { ConversationService } from './conversations/conversation.service';
import { MessageService } from './messages/message.service';
import { ApprovalService } from './approvals/approval.service';
import { CallService } from './calls/call.service';
import { LiveKitTokenIssuer } from './calls/media-token';
import { AttachmentService } from './attachments/attachment.service';
import { SignedLocalObjectStorage } from './attachments/object-storage';
import { OutboxService } from './outbox/outbox.service';
import { OutboxWorker } from './outbox/outbox.worker';
import { WorkerScheduler } from './outbox/worker.scheduler';
import { NotificationService } from './notifications/notification.service';
import { ReminderService } from './notifications/reminder.service';
import { TemplateService } from './notifications/template.service';
import { QuietHoursService } from './notifications/quiet-hours.service';
import { LoggingPushProvider } from './notifications/push.provider';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { TypingService } from './realtime/typing.service';
import { PresenceService } from './realtime/presence.service';
import { redisProvider } from './realtime/redis.provider';

import { ConversationController } from './api/conversation.controller';
import { MessageController } from './api/message.controller';
import { ApprovalController } from './api/approval.controller';
import { CallController } from './api/call.controller';
import { NotificationController } from './api/notification.controller';

@Module({
  imports: [PlatformModule],
  controllers: [
    ConversationController,
    MessageController,
    ApprovalController,
    CallController,
    NotificationController,
  ],
  providers: [
    redisProvider,
    ConversationService,
    MessageService,
    ApprovalService,
    CallService,
    AttachmentService,
    OutboxService,
    OutboxWorker,
    WorkerScheduler,
    NotificationService,
    ReminderService,
    TemplateService,
    QuietHoursService,
    TypingService,
    PresenceService,
    RealtimeGateway,
    { provide: OBJECT_STORAGE, useClass: SignedLocalObjectStorage },
    { provide: PUSH_PROVIDER, useClass: LoggingPushProvider },
    { provide: MEDIA_TOKEN_ISSUER, useClass: LiveKitTokenIssuer },
    // The gateway is the realtime publisher; workers depend on the interface.
    { provide: REALTIME_PUBLISHER, useExisting: RealtimeGateway },
  ],
  exports: [
    ConversationService,
    MessageService,
    ApprovalService,
    CallService,
    NotificationService,
    ReminderService,
    OutboxWorker,
    WorkerScheduler,
  ],
})
export class CommunicationModule {}
