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

/**
 * The canonical staff roles (PD-5, closed 2026-09-07). The brief-era vocabulary
 * `coverage | finance | technical | academic` is gone: `coverage` was renamed,
 * and the other three were never roles -- they are DEPARTMENTS.
 *
 * Mirrors the CHECK on chat.staff.role.
 */
export const StaffRole = {
  SUPER_ADMIN: 'super_admin',
  MANAGER: 'manager',
  ADMIN: 'admin',
  COVERAGE_ADMIN: 'coverage_admin',
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];

/** Roles that see the whole organization rather than an assigned scope. */
export const ORGANIZATION_WIDE_STAFF_ROLES: ReadonlySet<string> = new Set([
  StaffRole.MANAGER,
  StaffRole.SUPER_ADMIN,
]);

/**
 * A routing attribute for task work, never a role. A staff member carrying one
 * completes tasks and takes no part in family communication.
 */
export const Department = {
  FINANCE: 'finance',
  TECHNICAL: 'technical',
  ACADEMIC: 'academic',
} as const;
export type Department = (typeof Department)[keyof typeof Department];

/**
 * Staff roles that may take part in family communication at all.
 *
 * Holding one of these is NECESSARY, never sufficient: a departmental staff
 * member is excluded by isFamilyFacingStaff(), and scope decides which families
 * are reachable. See AUTHORIZATION-MODEL.md 2.
 */
export const FAMILY_FACING_STAFF_ROLES: ReadonlySet<string> = new Set([
  StaffRole.SUPER_ADMIN,
  StaffRole.MANAGER,
  StaffRole.ADMIN,
  StaffRole.COVERAGE_ADMIN,
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

/**
 * The reactions a client may send.
 *
 * An allow-list rather than "any grapheme cluster". A free-text reaction column
 * is a second message body with none of a message body's controls: it bypasses
 * approval, it is not searchable or moderatable, and it cannot be edited or
 * deleted for everyone. Six emoji cover what the product asked for, and adding
 * one is a one-line change here plus a client string.
 *
 * Mirrors the mobile client's list in lib/shared/models/message.dart.
 */
export const REACTION_EMOJI: readonly string[] = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export const ALLOWED_REACTIONS: ReadonlySet<string> = new Set(REACTION_EMOJI);

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
