import { StaffToolsController } from './api/staff-tools.controller';
import { StaffToolsService } from './staff-tools/staff-tools.service';
import { StarredController } from './api/starred.controller';
import { PresenceController } from './api/presence.controller';
import { PresencePolicy } from './realtime/presence-policy';
import { ExportController } from './api/export.controller';
import { ChatThemeController } from './api/chat-theme.controller';
import { ChatThemeService } from './themes/chat-theme.service';
import { ConversationExportService } from './export/conversation-export.service';
import { ProfilePhotoController } from './api/profile-photo.controller';
import { TimeZoneController } from './api/time-zone.controller';
import { AvatarService } from './profile/avatar.service';
import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AuthModule } from '../platform/auth/auth.module';
import {
  MEDIA_TOKEN_ISSUER,
  MEDIA_ROOM_CONTROL,
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
import { StoryService } from './stories/story.service';
import { StoryAudienceResolver } from './stories/story-audience.resolver';
import { StorySweeper } from './stories/story-sweeper.service';
import { OutboxService } from './outbox/outbox.service';
import { OutboxWorker } from './outbox/outbox.worker';
import { NotificationService } from './notifications/notification.service';
import { ReminderService } from './notifications/reminder.service';
import { TemplateService } from './notifications/template.service';
import { QuietHoursService } from './notifications/quiet-hours.service';
import { NotificationPipeline } from './notifications/notification-pipeline.service';
import { NotificationInboxService } from './notifications/notification-inbox.service';
import { selectPushProvider } from './notifications/push.provider.selector';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { RevocationConfirmer } from './realtime/revocation-confirmer.service';
import { TypingService } from './realtime/typing.service';
import { PresenceService } from './realtime/presence.service';
import { RedisClientShutdown, redisProvider } from './realtime/redis.provider';
import { RelayRealtimePublisher } from '../infra/realtime/relay.publisher';
import { RealtimeRelay } from '../infra/realtime/realtime-relay.service';

import { ConversationController } from './api/conversation.controller';
import { MessageController } from './api/message.controller';
import { ApprovalController } from './api/approval.controller';
import { CallController } from './api/call.controller';
import { LiveKitWebhookController } from './api/livekit-webhook.controller';
import { LiveKitWebhookVerifier } from './calls/livekit-webhook.verifier';
import { LiveKitRoomControl } from './calls/media-room-control';
import { MediaPresenceService } from './calls/media-presence.service';
import { NotificationController } from './api/notification.controller';
import { NotificationInboxController } from './api/notification-inbox.controller';
import { StorageController } from './api/storage.controller';
import { MediaController } from './api/media.controller';
import { StoryController } from './api/story.controller';
import { TeacherProfileController } from './api/teacher-profile.controller';
import { TeacherMediaController } from './api/teacher-media.controller';
import { TeacherProfileService } from './teacher-profile/teacher-profile.service';
import { ParentProfileController } from './api/parent-profile.controller';
import { ParentProfileService } from './profile/parent-profile.service';
import { ConversationSeatService } from './seats/conversation-seat.service';
import { SeatPolicyRegistry } from './seats/seat-policy';
import { SeatController } from './seats/seat.controller';

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
    NotificationInboxController,
    StorageController,
    MediaController,
    ProfilePhotoController,
    TimeZoneController,
    StarredController,
    StaffToolsController,
    ExportController,
    ChatThemeController,
    StoryController,
    TeacherProfileController,
    TeacherMediaController,
    ParentProfileController,
    SeatController,
    PresenceController,
  ],
  providers: [
    redisProvider,
    RedisClientShutdown,
    ConversationService,
    // PD-35: the visible seat; features register their reasons' policies.
    SeatPolicyRegistry,
    ConversationSeatService,
    TeacherProfileService,
    MessageService,
    ApprovalService,
    CallService,
    MediaPresenceService,
    LiveKitWebhookVerifier,
    AttachmentService,
    ParentProfileService,
    StoryService,
    AvatarService,
    StaffToolsService,
    ConversationExportService,
    ChatThemeService,
    StoryAudienceResolver,
    StorySweeper,
    OutboxService,
    OutboxWorker,
    NotificationService,
    ReminderService,
    TemplateService,
    QuietHoursService,
    NotificationPipeline,
    NotificationInboxService,
    TypingService,
    PresenceService,
    PresencePolicy,
    RealtimeGateway,
    RevocationConfirmer,
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
    { provide: MEDIA_ROOM_CONTROL, useClass: LiveKitRoomControl },
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
    SeatPolicyRegistry,
    ConversationSeatService,
    OutboxService,
    MessageService,
    ApprovalService,
    CallService,
    StoryService,
    StorySweeper,
    NotificationService,
    ReminderService,
    NotificationPipeline,
    OutboxWorker,
    RealtimeRelay,
    // PD-17: the Parent and Student Profiles show and (for a parent) change photos.
    AvatarService,
  ],
})
export class CommunicationModule {}
