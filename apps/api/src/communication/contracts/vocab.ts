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
