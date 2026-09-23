/**
 * THE notification type registry.
 *
 * A notification type is defined here once and nowhere else. Every property a
 * type has -- its category, its priority, whether it is essential, whether push
 * may carry content, which template renders it, how it groups, and where it
 * deep links -- is a field on one record.
 *
 * This is the file that stops "notification behaviour implemented separately in
 * every UI component". A feature that wants to notify somebody adds a row here
 * and calls NotificationService; it does not decide any of these things itself.
 *
 * A TYPE ONLY EXISTS IF A REAL EVENT IN THIS PRODUCT PRODUCES IT.
 * Types that were considered and deliberately left out -- attendance, progress
 * updates, package balances -- are listed in
 * docs/communication/notification-platform.md §7, with the missing producer
 * named in each case. An unproduced type is worse than a missing one: it looks
 * implemented.
 */

// ---------------------------------------------------------------------------
// Vocabulary. Mirrors the check constraints in
// supabase/migrations/20260923120000_chat_notification_platform.sql.
// ---------------------------------------------------------------------------

export const NotificationCategory = {
  MESSAGING: 'messaging',
  CALLS: 'calls',
  CLASSES: 'classes',
  ACADEMY: 'academy',
  BILLING: 'billing',
  APPROVALS: 'approvals',
  ACCOUNT: 'account',
} as const;
export type NotificationCategory =
  (typeof NotificationCategory)[keyof typeof NotificationCategory];

/** Categories a parent may mute. Mirrors chat.notification_category.is_optional. */
export const OPTIONAL_CATEGORIES: ReadonlySet<NotificationCategory> = new Set([
  NotificationCategory.MESSAGING,
  NotificationCategory.CALLS,
  NotificationCategory.CLASSES,
  NotificationCategory.ACADEMY,
  NotificationCategory.BILLING,
]);

export const NotificationPriority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;
export type NotificationPriority =
  (typeof NotificationPriority)[keyof typeof NotificationPriority];

export const PRIORITY_RANK: Record<NotificationPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

export const DeliveryChannel = { IN_APP: 'in_app', PUSH: 'push' } as const;
export type DeliveryChannel = (typeof DeliveryChannel)[keyof typeof DeliveryChannel];

export const DeliveryStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

/** Why a delivery was deliberately not attempted. Recorded, never inferred. */
export const SkipReason = {
  /** The recipient is looking at the conversation right now. */
  RECIPIENT_ACTIVE: 'RECIPIENT_ACTIVE',
  /** They muted this category, and the type is not essential. */
  PREFERENCE_OFF: 'PREFERENCE_OFF',
  /** They have muted this conversation. */
  CONVERSATION_MUTED: 'CONVERSATION_MUTED',
  /** No active device token; the in-app notification still exists. */
  NO_DEVICE_TOKEN: 'NO_DEVICE_TOKEN',
  /** Superseded by a grouped rollup. */
  GROUPED: 'GROUPED',
  /** The rule that produced it asked for in-app only. */
  RULE_IN_APP_ONLY: 'RULE_IN_APP_ONLY',
} as const;
export type SkipReason = (typeof SkipReason)[keyof typeof SkipReason];

export const EntityType = {
  CONVERSATION: 'conversation',
  MESSAGE: 'message',
  CALL: 'call',
  LEARNER: 'learner',
  ANNOUNCEMENT: 'announcement',
  SUBSCRIPTION: 'subscription',
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

// ---------------------------------------------------------------------------
// The types
// ---------------------------------------------------------------------------

export const NotificationType = {
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
  VOICE_MESSAGE_RECEIVED: 'VOICE_MESSAGE_RECEIVED',
  MEDIA_MESSAGE_RECEIVED: 'MEDIA_MESSAGE_RECEIVED',
  ACADEMY_MESSAGE: 'ACADEMY_MESSAGE',

  INCOMING_CALL: 'INCOMING_CALL',
  MISSED_CALL: 'MISSED_CALL',

  CLASS_REMINDER: 'CLASS_REMINDER',
  CLASS_SCHEDULED: 'CLASS_SCHEDULED',
  CLASS_SCHEDULE_CHANGED: 'CLASS_SCHEDULE_CHANGED',
  CLASS_CANCELLED: 'CLASS_CANCELLED',

  ACADEMY_ANNOUNCEMENT: 'ACADEMY_ANNOUNCEMENT',
  IMPORTANT_ANNOUNCEMENT: 'IMPORTANT_ANNOUNCEMENT',
  URGENT_ANNOUNCEMENT: 'URGENT_ANNOUNCEMENT',

  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
  APPROVAL_DECIDED: 'APPROVAL_DECIDED',

  RENEWAL_REMINDER: 'RENEWAL_REMINDER',
  PAYMENT_REMINDER: 'PAYMENT_REMINDER',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** The deep-link target a type needs. Missing ids degrade to the parent route. */
export interface DeepLinkContext {
  conversationId?: string | null;
  messageId?: string | null;
  callId?: string | null;
  learnerId?: string | null;
  announcementId?: string | null;
}

export interface NotificationDefinition {
  readonly type: NotificationType;
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
  /**
   * Bypasses category muting. Reserved for notifications whose loss materially
   * affects a child's schooling or an account's safety -- not for anything that
   * merely feels important to whoever is adding it.
   */
  readonly essential: boolean;
  /**
   * Whether a push may carry the notification's own title and body onto a lock
   * screen. False means the push is a knock on the door: "Jawwid", "You have a
   * new message", and the content stays behind authentication.
   */
  readonly pushCarriesContent: boolean;
  /** Bypasses the recipient's quiet-hours window. */
  readonly bypassQuietHours: boolean;
  /** Collapsible with its siblings. See groupKey below. */
  readonly groupable: boolean;
  readonly entityType: EntityType;
  readonly templateKey: string;
  /** Template used when the notification is about a specific child. */
  readonly childTemplateKey?: string;
  readonly deepLink: (ctx: DeepLinkContext) => string;
  /**
   * The collapse key, or null for "never group this one". Same key inside the
   * grouping window means the same rollup.
   */
  readonly groupKey?: (ctx: DeepLinkContext & { senderId?: string | null }) => string | null;
}

const conversationLink = (ctx: DeepLinkContext): string => {
  if (!ctx.conversationId) return '/chats';
  return ctx.messageId
    ? `/chats/${ctx.conversationId}?message=${ctx.messageId}`
    : `/chats/${ctx.conversationId}`;
};

const callLink = (ctx: DeepLinkContext): string => {
  if (!ctx.conversationId) return '/calls';
  return ctx.callId
    ? `/chats/${ctx.conversationId}?call=${ctx.callId}`
    : `/chats/${ctx.conversationId}`;
};

const classLink = (ctx: DeepLinkContext): string =>
  ctx.learnerId ? `/learners/${ctx.learnerId}/classes` : '/chats';

const announcementLink = (ctx: DeepLinkContext): string =>
  ctx.announcementId ? `/announcements/${ctx.announcementId}` : '/chats';

/** Messaging groups per (conversation, sender): one rollup per person per thread. */
const messageGroupKey = (ctx: DeepLinkContext & { senderId?: string | null }): string | null =>
  ctx.conversationId ? `msg:${ctx.conversationId}:${ctx.senderId ?? 'system'}` : null;

const define = (d: NotificationDefinition): NotificationDefinition => Object.freeze(d);

export const NOTIFICATION_REGISTRY: Readonly<
  Record<NotificationType, NotificationDefinition>
> = Object.freeze({
  // -- Messaging ------------------------------------------------------------
  // Groupable, and content stays off the lock screen: a message preview is the
  // single most private thing this system handles.
  [NotificationType.MESSAGE_RECEIVED]: define({
    type: NotificationType.MESSAGE_RECEIVED,
    category: NotificationCategory.MESSAGING,
    priority: NotificationPriority.NORMAL,
    essential: false,
    pushCarriesContent: false,
    bypassQuietHours: false,
    groupable: true,
    entityType: EntityType.MESSAGE,
    templateKey: 'message_received',
    childTemplateKey: 'message_received_child',
    deepLink: conversationLink,
    groupKey: messageGroupKey,
  }),

  [NotificationType.VOICE_MESSAGE_RECEIVED]: define({
    type: NotificationType.VOICE_MESSAGE_RECEIVED,
    category: NotificationCategory.MESSAGING,
    priority: NotificationPriority.NORMAL,
    essential: false,
    pushCarriesContent: false,
    bypassQuietHours: false,
    groupable: true,
    entityType: EntityType.MESSAGE,
    templateKey: 'voice_message_received',
    childTemplateKey: 'voice_message_received_child',
    deepLink: conversationLink,
    groupKey: messageGroupKey,
  }),

  [NotificationType.MEDIA_MESSAGE_RECEIVED]: define({
    type: NotificationType.MEDIA_MESSAGE_RECEIVED,
    category: NotificationCategory.MESSAGING,
    priority: NotificationPriority.NORMAL,
    essential: false,
    pushCarriesContent: false,
    bypassQuietHours: false,
    groupable: true,
    entityType: EntityType.MESSAGE,
    templateKey: 'media_message_received',
    childTemplateKey: 'media_message_received_child',
    deepLink: conversationLink,
    groupKey: messageGroupKey,
  }),

  [NotificationType.ACADEMY_MESSAGE]: define({
    type: NotificationType.ACADEMY_MESSAGE,
    category: NotificationCategory.MESSAGING,
    priority: NotificationPriority.NORMAL,
    essential: false,
    pushCarriesContent: false,
    bypassQuietHours: false,
    groupable: true,
    entityType: EntityType.MESSAGE,
    templateKey: 'academy_message',
    deepLink: conversationLink,
    groupKey: messageGroupKey,
  }),

  // -- Calls ----------------------------------------------------------------
  // An incoming call is a VoIP wake-up, not a notification to read later; the
  // ringing UI is driven by the realtime `call.incoming` event. This exists so
  // a backgrounded device wakes at all.
  [NotificationType.INCOMING_CALL]: define({
    type: NotificationType.INCOMING_CALL,
    category: NotificationCategory.CALLS,
    priority: NotificationPriority.URGENT,
    essential: true,
    pushCarriesContent: false,
    bypassQuietHours: true,
    groupable: false,
    entityType: EntityType.CALL,
    templateKey: 'incoming_call',
    deepLink: callLink,
  }),

  // NEVER grouped. "3 missed calls" from two different teachers about two
  // different children is exactly the information a parent needs kept apart.
  //
  // NOT essential, deliberately, and this is the subtle one. `essential` means
  // "ignore the parent's preference", and the Calls category exists in settings
  // precisely so a parent can say "don't buzz me about missed calls". If this
  // were essential that switch would do nothing, which is worse than not
  // offering it. Nothing is lost by honouring it: in-app delivery is never
  // disableable, so the missed call still lands in the centre, still increments
  // the badge, and still stays in the history forever. Only the buzz is the
  // parent's to decline.
  [NotificationType.MISSED_CALL]: define({
    type: NotificationType.MISSED_CALL,
    category: NotificationCategory.CALLS,
    priority: NotificationPriority.HIGH,
    essential: false,
    pushCarriesContent: true,
    bypassQuietHours: false,
    groupable: false,
    entityType: EntityType.CALL,
    templateKey: 'missed_call',
    childTemplateKey: 'missed_call_child',
    deepLink: callLink,
  }),

  // -- Classes --------------------------------------------------------------
  [NotificationType.CLASS_REMINDER]: define({
    type: NotificationType.CLASS_REMINDER,
    category: NotificationCategory.CLASSES,
    priority: NotificationPriority.NORMAL,
    essential: false,
    pushCarriesContent: true,
    bypassQuietHours: false,
    groupable: false,
    entityType: EntityType.LEARNER,
    templateKey: 'class_reminder',
    deepLink: classLink,
  }),

  [NotificationType.CLASS_SCHEDULED]: define({
    type: NotificationType.CLASS_SCHEDULED,
    category: NotificationCategory.CLASSES,
    priority: NotificationPriority.NORMAL,
    essential: false,
    pushCarriesContent: true,
    bypassQuietHours: false,
    groupable: false,
    entityType: EntityType.LEARNER,
    templateKey: 'class_scheduled',
    deepLink: classLink,
  }),

  // Essential, un-groupable, quiet-hours-exempt. A parent who is not told the
  // class moved sends their child to an empty room; there is no version of
  // "later" that repairs that.
  [NotificationType.CLASS_SCHEDULE_CHANGED]: define({
    type: NotificationType.CLASS_SCHEDULE_CHANGED,
    category: NotificationCategory.CLASSES,
    priority: NotificationPriority.HIGH,
    essential: true,
    pushCarriesContent: true,
    bypassQuietHours: true,
    groupable: false,
    entityType: EntityType.LEARNER,
    templateKey: 'class_schedule_changed',
    deepLink: classLink,
  }),

  [NotificationType.CLASS_CANCELLED]: define({
    type: NotificationType.CLASS_CANCELLED,
    category: NotificationCategory.CLASSES,
    priority: NotificationPriority.HIGH,
    essential: true,
    pushCarriesContent: true,
    bypassQuietHours: true,
    groupable: false,
    entityType: EntityType.LEARNER,
    templateKey: 'class_cancelled',
    deepLink: classLink,
  }),

  // -- Academy --------------------------------------------------------------
  [NotificationType.ACADEMY_ANNOUNCEMENT]: define({
    type: NotificationType.ACADEMY_ANNOUNCEMENT,
    category: NotificationCategory.ACADEMY,
    priority: NotificationPriority.LOW,
    essential: false,
    pushCarriesContent: true,
    bypassQuietHours: false,
    groupable: false,
    entityType: EntityType.ANNOUNCEMENT,
    templateKey: 'announcement',
    deepLink: announcementLink,
  }),

  [NotificationType.IMPORTANT_ANNOUNCEMENT]: define({
    type: NotificationType.IMPORTANT_ANNOUNCEMENT,
    category: NotificationCategory.ACADEMY,
    priority: NotificationPriority.HIGH,
    essential: false,
    pushCarriesContent: true,
    bypassQuietHours: false,
    groupable: false,
    entityType: EntityType.ANNOUNCEMENT,
    templateKey: 'announcement_important',
    deepLink: announcementLink,
  }),

  // The only type in the registry that is BOTH essential and quiet-hours
  // exempt on the academy's own say-so. The database refuses to create one
  // unless an admin or a manager is behind it.
  [NotificationType.URGENT_ANNOUNCEMENT]: define({
    type: NotificationType.URGENT_ANNOUNCEMENT,
    category: NotificationCategory.ACADEMY,
    priority: NotificationPriority.URGENT,
    essential: true,
    pushCarriesContent: true,
    bypassQuietHours: true,
    groupable: false,
    entityType: EntityType.ANNOUNCEMENT,
    templateKey: 'announcement_urgent',
    deepLink: announcementLink,
  }),

  // -- Approvals (staff-facing; a parent never sees the request side) --------
  [NotificationType.APPROVAL_REQUESTED]: define({
    type: NotificationType.APPROVAL_REQUESTED,
    category: NotificationCategory.APPROVALS,
    priority: NotificationPriority.HIGH,
    essential: true,
    pushCarriesContent: false,
    bypassQuietHours: false,
    groupable: false,
    entityType: EntityType.MESSAGE,
    templateKey: 'pending_approval',
    deepLink: conversationLink,
  }),

  [NotificationType.APPROVAL_DECIDED]: define({
    type: NotificationType.APPROVAL_DECIDED,
    category: NotificationCategory.APPROVALS,
    priority: NotificationPriority.NORMAL,
    essential: true,
    pushCarriesContent: false,
    bypassQuietHours: false,
    groupable: false,
    entityType: EntityType.MESSAGE,
    templateKey: 'approval_decision',
    deepLink: conversationLink,
  }),

  // -- Billing --------------------------------------------------------------
  [NotificationType.RENEWAL_REMINDER]: define({
    type: NotificationType.RENEWAL_REMINDER,
    category: NotificationCategory.BILLING,
    priority: NotificationPriority.NORMAL,
    essential: false,
    pushCarriesContent: true,
    bypassQuietHours: false,
    groupable: false,
    entityType: EntityType.SUBSCRIPTION,
    templateKey: 'renewal_reminder',
    deepLink: () => '/billing',
  }),

  [NotificationType.PAYMENT_REMINDER]: define({
    type: NotificationType.PAYMENT_REMINDER,
    category: NotificationCategory.BILLING,
    priority: NotificationPriority.NORMAL,
    essential: false,
    pushCarriesContent: true,
    bypassQuietHours: false,
    groupable: false,
    entityType: EntityType.SUBSCRIPTION,
    templateKey: 'payment_reminder',
    deepLink: () => '/billing',
  }),
});

export function definitionOf(type: NotificationType): NotificationDefinition {
  const def = NOTIFICATION_REGISTRY[type];
  if (!def) {
    // A caller invented a type. Failing here is the point: the alternative is a
    // notification with no category, no priority and no deep link reaching a
    // parent's phone.
    throw new Error(`unknown notification type: ${String(type)}`);
  }
  return def;
}

/** The template a type renders with, given whether a child is in context. */
export function templateKeyFor(
  def: NotificationDefinition,
  hasChildContext: boolean,
): string {
  return hasChildContext && def.childTemplateKey ? def.childTemplateKey : def.templateKey;
}

/**
 * Maps the message type a conversation carries onto the notification type.
 * `system` messages notify nobody -- they are the conversation narrating itself.
 */
export function messageNotificationType(messageType: string): NotificationType | null {
  switch (messageType) {
    case 'text':
      return NotificationType.MESSAGE_RECEIVED;
    case 'voice':
      return NotificationType.VOICE_MESSAGE_RECEIVED;
    case 'image':
    case 'video':
    case 'file':
      return NotificationType.MEDIA_MESSAGE_RECEIVED;
    default:
      return null;
  }
}

/** Announcement priority -> notification type. */
export function announcementNotificationType(priority: string): NotificationType {
  switch (priority) {
    case 'urgent':
      return NotificationType.URGENT_ANNOUNCEMENT;
    case 'important':
      return NotificationType.IMPORTANT_ANNOUNCEMENT;
    default:
      return NotificationType.ACADEMY_ANNOUNCEMENT;
  }
}

/**
 * chat.notification_rule.event_type -> notification type.
 *
 * Reminder rules are DATA: their offsets, templates, channels and quiet-hours
 * exemptions live in rows so operations can retune a reminder schedule without
 * a deploy. What a rule cannot carry is the notification's semantics -- its
 * category, whether it is essential, where it deep links -- because those are
 * not operational settings and must not be editable by an UPDATE. This map is
 * the join between the two: a rule says WHEN, the registry says WHAT.
 */
const RULE_EVENT_TYPES: Readonly<Record<string, NotificationType>> = Object.freeze({
  class_scheduled: NotificationType.CLASS_REMINDER,
  schedule_changed: NotificationType.CLASS_SCHEDULE_CHANGED,
  class_cancelled: NotificationType.CLASS_CANCELLED,
  renewal_due: NotificationType.RENEWAL_REMINDER,
  payment_due: NotificationType.PAYMENT_REMINDER,
  message_published: NotificationType.MESSAGE_RECEIVED,
  approval_requested: NotificationType.APPROVAL_REQUESTED,
  approval_decided: NotificationType.APPROVAL_DECIDED,
  call_started: NotificationType.INCOMING_CALL,
  group_call_started: NotificationType.INCOMING_CALL,
  call_missed: NotificationType.MISSED_CALL,
  announcement_published: NotificationType.ACADEMY_ANNOUNCEMENT,
});

/**
 * Null when a rule names an event this product has no notification type for.
 * The rule is then skipped rather than guessed at: an operator who enables a
 * rule for an event nobody produces should get nothing, not a notification with
 * invented semantics.
 */
export function ruleEventNotificationType(eventType: string): NotificationType | null {
  return RULE_EVENT_TYPES[eventType] ?? null;
}
