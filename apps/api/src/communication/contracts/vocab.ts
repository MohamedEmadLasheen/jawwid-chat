/**
 * The allowed values for every text-plus-check column in the chat schema.
 *
 * The database check constraints are authoritative; these constants mirror them
 * so TypeScript can reason about them. If you add a value here, add it to the
 * migration in the same change.
 */

export const ActorKind = {
  CONTACT: 'contact',
  STAFF: 'staff',
  TEACHER: 'teacher',
  SYSTEM: 'system',
} as const;
export type ActorKind = (typeof ActorKind)[keyof typeof ActorKind];

export const StaffRole = {
  ADMIN: 'admin',
  COVERAGE: 'coverage',
  MANAGER: 'manager',
  FINANCE: 'finance',
  TECHNICAL: 'technical',
  ACADEMIC: 'academic',
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];

/**
 * Staff roles that may take part in family communication at all.
 * finance / technical / academic staff complete tasks; they never message
 * families.
 */
export const FAMILY_FACING_STAFF_ROLES: ReadonlySet<string> = new Set([
  StaffRole.ADMIN,
  StaffRole.COVERAGE,
  StaffRole.MANAGER,
]);

export const ConversationType = {
  DIRECT: 'direct',
  STUDENT_GROUP: 'student_group',
  CLASS_GROUP: 'class_group',
  OFFICIAL: 'official',
} as const;
export type ConversationType = (typeof ConversationType)[keyof typeof ConversationType];

export const ConversationState = {
  OPEN: 'open',
  WAITING_ON_CUSTOMER: 'waiting_on_customer',
  WAITING_ON_JAWWID: 'waiting_on_jawwid',
  RESOLVED: 'resolved',
} as const;
export type ConversationState = (typeof ConversationState)[keyof typeof ConversationState];

export const MemberRole = {
  PARENT: 'parent',
  TEACHER: 'teacher',
  ADMIN: 'admin',
  OBSERVER: 'observer',
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

export const MessageType = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  VOICE: 'voice',
  FILE: 'file',
  SYSTEM: 'system',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const Visibility = { CUSTOMER: 'customer', INTERNAL: 'internal' } as const;
export type Visibility = (typeof Visibility)[keyof typeof Visibility];

export const Moderation = {
  PUBLISHED: 'published',
  PENDING: 'pending',
  REJECTED: 'rejected',
} as const;
export type Moderation = (typeof Moderation)[keyof typeof Moderation];

export const Origin = { USER: 'user', AUTOMATION: 'automation', BROADCAST: 'broadcast' } as const;
export type Origin = (typeof Origin)[keyof typeof Origin];

export const OnBehalfMode = {
  OWNER: 'owner',
  COVERAGE: 'coverage',
  ASSIST: 'assist',
  ESCALATION: 'escalation',
} as const;
export type OnBehalfMode = (typeof OnBehalfMode)[keyof typeof OnBehalfMode];

export const ReceiptState = { SENT: 'sent', DELIVERED: 'delivered', READ: 'read' } as const;
export type ReceiptState = (typeof ReceiptState)[keyof typeof ReceiptState];

export const RECEIPT_RANK: Record<string, number> = {
  [ReceiptState.SENT]: 0,
  [ReceiptState.DELIVERED]: 1,
  [ReceiptState.READ]: 2,
};

export const ApprovalDecision = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;
export type ApprovalDecision = (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

export const CallType = { DIRECT: 'direct', GROUP: 'group' } as const;
export type CallType = (typeof CallType)[keyof typeof CallType];

export const CallStatus = { RINGING: 'ringing', ACTIVE: 'active', ENDED: 'ended' } as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

export const CallOutcome = {
  ANSWERED: 'answered',
  MISSED: 'missed',
  DECLINED: 'declined',
} as const;
export type CallOutcome = (typeof CallOutcome)[keyof typeof CallOutcome];

export const NotificationStatus = {
  SCHEDULED: 'scheduled',
  SENT: 'sent',
  DELIVERED: 'delivered',
  OPENED: 'opened',
  FAILED: 'failed',
  SUPPRESSED: 'suppressed',
  CANCELLED: 'cancelled',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

export type Locale = 'ar' | 'en';

/**
 * Stories. Mirrors 20260928120000_chat_stories.sql.
 *
 * The transitions are enforced by chat.guard_story_transition() as well as by
 * StoryService, so this is a mirror of a database rule and not the rule itself:
 *   draft -> published -> expired, and any of the three -> deleted (terminal).
 */
export const StoryState = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  EXPIRED: 'expired',
  DELETED: 'deleted',
} as const;
export type StoryState = (typeof StoryState)[keyof typeof StoryState];

export const StoryMediaKind = { IMAGE: 'image', VIDEO: 'video' } as const;
export type StoryMediaKind = (typeof StoryMediaKind)[keyof typeof StoryMediaKind];

/**
 * The audience clauses a publisher may author.
 *
 * This is THIS schema's vocabulary. The abandoned Phase 5 lineage also had a
 * `label` kind backed by chat.family_label, and a `group` kind backed by
 * chat.group_member; neither table exists here. Labels are Phase 2 and unbuilt,
 * and a "group" on this schema IS a conversation -- hence CONVERSATION.
 */
export const StoryAudienceKind = {
  ALL_FAMILIES: 'all_families',
  ALL_TEACHERS: 'all_teachers',
  /** The families this staff author supervises (chat.family.owner_id). */
  ASSIGNED_FAMILIES: 'assigned_families',
  FAMILY: 'family',
  TEACHER: 'teacher',
  CONTACT: 'contact',
  /** The members of one student_group / class_group conversation. */
  CONVERSATION: 'conversation',
} as const;
export type StoryAudienceKind = (typeof StoryAudienceKind)[keyof typeof StoryAudienceKind];

/** The kinds that name no particular record and therefore carry no ref id. */
export const UNSCOPED_STORY_AUDIENCE_KINDS: ReadonlySet<string> = new Set([
  StoryAudienceKind.ALL_FAMILIES,
  StoryAudienceKind.ALL_TEACHERS,
  StoryAudienceKind.ASSIGNED_FAMILIES,
]);

/** Staff roles that may publish a story: the family-facing set, and only it. */
export const STORY_PUBLISHER_ROLES: ReadonlySet<string> = FAMILY_FACING_STAFF_ROLES;
