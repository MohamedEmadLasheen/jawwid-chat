import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AuthModule } from '../platform/auth/auth.module';
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
import { selectObjectStorage } from './attachments/storage.provider';
import { LocalFsBlobStore } from './attachments/blob-store';
import { OutboxService } from './outbox/outbox.service';
import { OutboxWorker } from './outbox/outbox.worker';
import { NotificationService } from './notifications/notification.service';
import { ReminderService } from './notifications/reminder.service';
import { TemplateService } from './notifications/template.service';
import { QuietHoursService } from './notifications/quiet-hours.service';
import { selectPushProvider } from './notifications/push.provider.selector';
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
import { LiveKitWebhookController } from './api/livekit-webhook.controller';
import { LiveKitWebhookVerifier } from './calls/livekit-webhook.verifier';
import { MediaPresenceService } from './calls/media-presence.service';
import { NotificationController } from './api/notification.controller';
import { StorageController } from './api/storage.controller';

@Module({
  // AuthModule exports AuthService, which RealtimeGateway uses to verify the
  // handshake token. The dependency runs one way only -- platform never imports
  // communication -- so there is no cycle.
  imports: [PlatformModule, AuthModule],
  controllers: [
    ConversationController,
    MessageController,
    ApprovalController,
    CallController,
    LiveKitWebhookController,
    NotificationController,
    StorageController,
  ],
  providers: [
    redisProvider,
    ConversationService,
    MessageService,
    ApprovalService,
    CallService,
    MediaPresenceService,
    LiveKitWebhookVerifier,
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
    LocalFsBlobStore,
    // Chosen from configuration, not compiled in: S3-compatible storage when
    // the bucket and credentials are set, the local reference implementation
    // otherwise, and a startup failure when the configuration is half-present.
    // See storage.provider.ts.
    { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage },
    // W8-W1. Configured, not compiled -- the same shape as OBJECT_STORAGE
    // above. With no credentials set this resolves to LoggingPushProvider,
    // which is exactly the previous behaviour; a partial configuration refuses
    // to start. See push.provider.selector.ts.
    { provide: PUSH_PROVIDER, useFactory: () => selectPushProvider().provider },
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
