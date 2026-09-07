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
import { S3ObjectStorage } from './attachments/s3-object-storage';
import { OutboxService } from './outbox/outbox.service';
import { OutboxWorker } from './outbox/outbox.worker';
import { NotificationService } from './notifications/notification.service';
import { ReminderService } from './notifications/reminder.service';
import { TemplateService } from './notifications/template.service';
import { QuietHoursService } from './notifications/quiet-hours.service';
import {
  LoggingPushProvider,
  PlatformRoutingPushProvider,
  type PushProvider,
} from './notifications/push.provider';
import { FcmPushProvider } from './notifications/fcm.provider';
import { ApnsPushProvider } from './notifications/apns.provider';
import { NotificationPreferenceService } from './notifications/preference.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { TypingService } from './realtime/typing.service';
import { PresenceService } from './realtime/presence.service';
import { redisProvider } from './realtime/redis.provider';
import { RelayRealtimePublisher } from '../infra/realtime/relay.publisher';
import { RealtimeRelay } from '../infra/realtime/realtime-relay.service';

import { ConversationController } from './api/conversation.controller';
import { MessageController, SearchController } from './api/message.controller';
import { ApprovalController } from './api/approval.controller';
import { CallController } from './api/call.controller';
import { NotificationController } from './api/notification.controller';

@Module({
  imports: [PlatformModule],
  controllers: [
    ConversationController,
    MessageController,
    SearchController,
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
    NotificationService,
    ReminderService,
    TemplateService,
    QuietHoursService,
    TypingService,
    PresenceService,
    RealtimeGateway,
    // Real object storage when the environment supplies it, the local signer
    // otherwise (Phase 2, architecture §2.5). `infra/env/manifest.tsv` marks
    // every STORAGE_* variable REQUIRED for staging and production, so a
    // deployment always gets S3/MinIO; a developer with no MinIO running gets
    // the reference signer rather than a boot failure.
    {
      provide: OBJECT_STORAGE,
      useClass: S3ObjectStorage.isConfigured() ? S3ObjectStorage : SignedLocalObjectStorage,
    },
    // Push goes out through the provider for the token's OWN platform. Which
    // concrete clients exist is decided by configuration, exactly as object
    // storage is: a developer with no Firebase project and no Apple key still
    // gets a working process, and a deployment -- where the credentials are
    // required -- gets the real ones.
    //
    // A platform with no configured provider is served by the logging provider,
    // which says so at WARN rather than reporting a delivery that did not
    // happen.
    {
      provide: PUSH_PROVIDER,
      useFactory: (): PushProvider => {
        const logging = new LoggingPushProvider();
        const byPlatform: Record<string, PushProvider> = {};
        if (FcmPushProvider.isConfigured()) byPlatform.android = new FcmPushProvider();
        if (ApnsPushProvider.isConfigured()) byPlatform.ios = new ApnsPushProvider();
        return new PlatformRoutingPushProvider(byPlatform, logging);
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
    ReminderService,
    OutboxWorker,
    RealtimeRelay,
  ],
})
export class CommunicationModule {}
