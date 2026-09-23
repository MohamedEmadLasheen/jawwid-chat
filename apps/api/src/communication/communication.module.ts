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
import { LocalFsBlobStore } from './attachments/blob-store';
import { OutboxService } from './outbox/outbox.service';
import { OutboxWorker } from './outbox/outbox.worker';
import { NotificationService } from './notifications/notification.service';
import { NotificationCenterService } from './notifications/notification-center.service';
import { DeliveryService } from './notifications/delivery.service';
import { PreferenceService } from './notifications/preference.service';
import { RecipientResolver } from './notifications/recipient-resolver.service';
import { RetentionService } from './notifications/retention.service';
import { ReminderService } from './notifications/reminder.service';
import { TemplateService } from './notifications/template.service';
import { QuietHoursService } from './notifications/quiet-hours.service';
import { LoggingPushProvider } from './notifications/push.provider';
import { FcmPushProvider, fcmConfigFromEnvironment } from './notifications/fcm.provider';
import { AnnouncementService } from './announcements/announcement.service';
import { ClassScheduleService } from './schedule/class-schedule.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { TypingService } from './realtime/typing.service';
import { PresenceService } from './realtime/presence.service';
import { redisProvider } from './realtime/redis.provider';
import { RelayRealtimePublisher } from '../infra/realtime/relay.publisher';
import { RealtimeRelay } from '../infra/realtime/realtime-relay.service';

import { ConversationController } from './api/conversation.controller';
import { MessageController } from './api/message.controller';
import { ApprovalController } from './api/approval.controller';
import { CallController } from './api/call.controller';
import { NotificationController } from './api/notification.controller';
import { AnnouncementController } from './api/announcement.controller';
import { ClassScheduleController } from './api/class-schedule.controller';
import { StorageController } from './api/storage.controller';

@Module({
  imports: [PlatformModule],
  controllers: [
    ConversationController,
    MessageController,
    ApprovalController,
    CallController,
    NotificationController,
    AnnouncementController,
    ClassScheduleController,
    StorageController,
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
    NotificationService,
    NotificationCenterService,
    DeliveryService,
    PreferenceService,
    RecipientResolver,
    RetentionService,
    AnnouncementService,
    ClassScheduleService,
    ReminderService,
    TemplateService,
    QuietHoursService,
    TypingService,
    PresenceService,
    RealtimeGateway,
    LocalFsBlobStore,
    { provide: OBJECT_STORAGE, useClass: SignedLocalObjectStorage },
    // Real push when the service account is configured, and a provider that
    // only logs when it is not. Selected at wiring time rather than branched on
    // inside a service: a deployment either has credentials or it does not, and
    // there is no runtime flag that can put a configured environment into
    // "pretend to send" mode.
    {
      provide: PUSH_PROVIDER,
      useFactory: () => {
        const config = fcmConfigFromEnvironment();
        return config ? new FcmPushProvider(config) : new LoggingPushProvider();
      },
    },
    { provide: MEDIA_TOKEN_ISSUER, useClass: LiveKitTokenIssuer },
    // AI #7 (D-2). The gateway ALONE cannot be the publisher: in the worker
    // process there is no Socket.IO server, so gateway.toThread()'s
    // `this.server?.` made every emit a silent no-op while OutboxWorker still
    // marked the row published. RelayRealtimePublisher delegates to the gateway
    // when this process owns a server and otherwise publishes over Redis to the
    // instances that do -- throwing if none received it, so the outbox retries.
    RelayRealtimePublisher,
    RealtimeRelay,
    { provide: REALTIME_PUBLISHER, useExisting: RelayRealtimePublisher },
  ],
  exports: [
    ConversationService,
    MessageService,
    ApprovalService,
    CallService,
    NotificationService,
    NotificationCenterService,
    DeliveryService,
    PreferenceService,
    RecipientResolver,
    RetentionService,
    AnnouncementService,
    ClassScheduleService,
    ReminderService,
    OutboxWorker,
    RealtimeRelay,
  ],
})
export class CommunicationModule {}
