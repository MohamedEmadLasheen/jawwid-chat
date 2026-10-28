/**
 * PD-34: what each notification IS, in one typed place.
 *
 * chat.notification_rule says WHEN and HOW a delivery goes out (offset, channel,
 * quiet hours, on/off) and stays the switchboard Admin Web edits. This catalog
 * says what the Notification Center makes of it: the category it is filed under
 * (and the tab it shows in), its severity, the in-app template, the lock-screen
 * variant used for someone who turned names on, and the button it carries.
 *
 * Keyed by rule key first, then by event type for rows written without a rule
 * (payment_received, story_published...). Bump `version` when a definition's
 * meaning changes; it is stored on every item it produces.
 */
export type NotificationCategory =
  | 'lesson'
  | 'payment'
  | 'conversation'
  | 'call'
  | 'task'
  | 'announcement'
  | 'system'
  | 'marketing';

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'lesson', 'payment', 'conversation', 'call', 'task', 'announcement', 'system', 'marketing',
];

export type NotificationSeverity = 'critical' | 'high' | 'normal' | 'low';

/** What the item's button opens. The client maps a kind to a screen; never a URL. */
export type ActionKind =
  | 'open_conversation'
  | 'view_lesson'
  | 'view_payments'
  | 'open_stories'
  | 'open_calls';

export interface CatalogEntry {
  version: number;
  category: NotificationCategory;
  /** The in-app template (chat.notification_template key). */
  inbox: string;
  /** The push template with names, for someone who turned lock-screen names on. */
  namedPush?: string;
  action?: ActionKind;
  /** Shown in the Center at all. A ringing call is over when it stops ringing. */
  listed?: boolean;
}

const BY_RULE: Readonly<Record<string, CatalogEntry>> = {
  lesson_parent_t24h: { version: 1, category: 'lesson', inbox: 'inbox.lesson_reminder_tomorrow', namedPush: 'lesson_reminder_tomorrow_named', action: 'view_lesson' },
  lesson_parent_t30m: { version: 1, category: 'lesson', inbox: 'inbox.lesson_reminder_soon', namedPush: 'lesson_reminder_soon_named', action: 'view_lesson' },
  lesson_teacher_t15m: { version: 1, category: 'lesson', inbox: 'inbox.lesson_reminder_teacher', namedPush: 'lesson_reminder_teacher_named', action: 'view_lesson' },
  lesson_clock_shift_parent: { version: 1, category: 'lesson', inbox: 'inbox.lesson_clock_shift', action: 'view_lesson' },
  payment_d7: { version: 1, category: 'payment', inbox: 'inbox.payment_reminder', namedPush: 'payment_reminder_named', action: 'view_payments' },
  payment_d3: { version: 1, category: 'payment', inbox: 'inbox.payment_reminder', namedPush: 'payment_reminder_named', action: 'view_payments' },
  payment_d0: { version: 1, category: 'payment', inbox: 'inbox.payment_reminder', namedPush: 'payment_reminder_named', action: 'view_payments' },
  payment_p3: { version: 1, category: 'payment', inbox: 'inbox.payment_reminder', namedPush: 'payment_reminder_named', action: 'view_payments' },
  payment_p7: { version: 1, category: 'payment', inbox: 'inbox.payment_reminder', namedPush: 'payment_reminder_named', action: 'view_payments' },
  new_message: { version: 1, category: 'conversation', inbox: 'inbox.new_messages', action: 'open_conversation' },
  missed_call: { version: 1, category: 'call', inbox: 'inbox.missed_call', action: 'open_calls' },
  incoming_call: { version: 1, category: 'call', inbox: 'inbox.generic', listed: false },
  group_call_started: { version: 1, category: 'call', inbox: 'inbox.generic', listed: false },
  story_published: { version: 1, category: 'announcement', inbox: 'inbox.story_published', action: 'open_stories' },
  // PD-36 mentions: their own Center entry, under Conversations (PD-34 QA 2026-10-27).
  mention: { version: 1, category: 'conversation', inbox: 'inbox.mention', action: 'open_conversation' },
  mention_group: { version: 1, category: 'conversation', inbox: 'inbox.mention_group', action: 'open_conversation' },
};

const BY_EVENT: Readonly<Record<string, CatalogEntry>> = {
  message_published: BY_RULE.new_message,
  call_missed: BY_RULE.missed_call,
  call_started: BY_RULE.incoming_call,
  group_call_started: BY_RULE.group_call_started,
  story_published: BY_RULE.story_published,
  payment_received: { version: 1, category: 'payment', inbox: 'inbox.payment_received', action: 'view_payments' },
  payment_receipt_rejected: { version: 1, category: 'payment', inbox: 'inbox.payment_receipt_rejected', action: 'view_payments' },
  // PD-30 (#126) writes these without a rule; filed under payments until it moves onto the pipeline.
  subscription_grace: { version: 1, category: 'payment', inbox: 'inbox.generic', action: 'view_payments' },
  subscription_locked: { version: 1, category: 'payment', inbox: 'inbox.generic', action: 'view_payments' },
  subscription_unlocked: { version: 1, category: 'payment', inbox: 'inbox.generic', action: 'view_payments' },
  subscription_renewal_requested: { version: 1, category: 'task', inbox: 'inbox.generic' },
  // PD-43 §3.4, §3.7: for the Teachers manager (the super admin when there is none).
  teacher_added_unsupervised: { version: 1, category: 'task', inbox: 'inbox.teacher_added_unsupervised' },
  teacher_duplicate_hidden: { version: 1, category: 'task', inbox: 'inbox.teacher_duplicate_hidden' },
  teacher_supervisor_left: { version: 1, category: 'task', inbox: 'inbox.teacher_supervisor_left' },
};

const FALLBACK: CatalogEntry = { version: 1, category: 'system', inbox: 'inbox.generic' };

export function catalogEntry(ruleKey: string | null | undefined, eventType: string): CatalogEntry {
  return (ruleKey ? BY_RULE[ruleKey] : undefined) ?? BY_EVENT[eventType] ?? FALLBACK;
}

/** The severity a rule's delivery priority means in the Center. */
export function severityOf(priority: string | null | undefined): NotificationSeverity {
  return priority === 'critical' || priority === 'high' || priority === 'low' ? priority : 'normal';
}

/** The Center's tabs, and which categories each one shows. */
export const INBOX_TABS = ['all', 'unread', 'action', 'lessons', 'payments', 'conversations', 'announcements'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export const TAB_CATEGORIES: Readonly<Partial<Record<InboxTab, readonly NotificationCategory[]>>> = {
  lessons: ['lesson'],
  payments: ['payment'],
  conversations: ['conversation', 'call'],
  announcements: ['announcement', 'system', 'marketing'],
};
