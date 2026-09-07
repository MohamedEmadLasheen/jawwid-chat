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

export const CallType = { DIRECT: 'direct', GROUP: 'group', CLASS: 'class' } as const;
export type CallType = (typeof CallType)[keyof typeof CallType];

/**
 * `initiated` is the entry state of the machine: the call row exists and
 * nobody has been invited yet. It is not observable through the API, because
 * `CallService.start` invites in the SAME transaction that creates the call --
 * a call that reached a client has always already reached `ringing`. It is a
 * state rather than an implicit prelude so that the machine has one declared
 * entry point, and so that a dispatch failure has somewhere lawful to end from.
 */
export const CallStatus = {
  INITIATED: 'initiated',
  RINGING: 'ringing',
  ACTIVE: 'active',
  ENDED: 'ended',
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

/**
 * How a call ended. `ended` is the single terminal STATUS and this says what
 * happened, which is why the Phase 5 brief's `declined` / `missed` / `failed`
 * "states" are outcomes here -- see 20260907150000_chat_phase5_calls.sql for
 * why one terminal status carrying an outcome beats four terminal statuses.
 *
 * CANCELLED and FAILED are new. Both used to be recorded as MISSED, which reads
 * as "the recipient did not pick up" and blames the wrong party: the caller
 * hanging up before an answer is not the recipient's doing, and neither is the
 * media layer breaking.
 */
export const CallOutcome = {
  ANSWERED: 'answered',
  MISSED: 'missed',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
} as const;
export type CallOutcome = (typeof CallOutcome)[keyof typeof CallOutcome];

/**
 * NORMAL_CALL records nothing. FOLLOW_UP_CALL may be recorded.
 *
 * The mode is fixed when the call is created, by an actor holding
 * `calls.record`, and it is never a per-request flag -- "record this call" must
 * not be something a client can switch on mid-call or ask for on a call it
 * merely joined. A database trigger refuses a recording row for a `normal`
 * call, so the guarantee survives a bug in this service.
 */
export const CallMode = { NORMAL: 'normal', FOLLOW_UP: 'follow_up' } as const;
export type CallMode = (typeof CallMode)[keyof typeof CallMode];

/**
 * Per-invitee lifecycle, independent of the call's.
 *
 * A group call does not end because one invitee refused, and it does not start
 * ringing again because one invitee left. Before Phase 5 a refusal could only
 * be recorded by stamping `left_at`, which is indistinguishable from somebody
 * who joined and hung up.
 */
export const CallParticipantState = {
  INVITED: 'invited',
  JOINED: 'joined',
  DECLINED: 'declined',
  LEFT: 'left',
  MISSED: 'missed',
} as const;
export type CallParticipantState =
  (typeof CallParticipantState)[keyof typeof CallParticipantState];

export const RecordingStatus = {
  PENDING: 'pending',
  AVAILABLE: 'available',
  FAILED: 'failed',
  DELETED: 'deleted',
} as const;
export type RecordingStatus = (typeof RecordingStatus)[keyof typeof RecordingStatus];

// --- Stories and broadcast (Phase 5) ---------------------------------------

export const StoryState = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  EXPIRED: 'expired',
  DELETED: 'deleted',
} as const;
export type StoryState = (typeof StoryState)[keyof typeof StoryState];

/**
 * THE audience vocabulary -- one language, shared by stories and broadcast.
 *
 * Two vocabularies would let "the Thursday group" mean different sets of people
 * depending on which feature asked, which is exactly the class of divergence
 * an audience resolver exists to prevent. Mirrors the CHECK on both
 * chat.story_audience.kind and chat.broadcast_audience.kind.
 */
export const AudienceKind = {
  /** Every family in the organization. Organization-wide roles only. */
  ALL_FAMILIES: 'all_families',
  /** Every active teacher in the organization. */
  ALL_TEACHERS: 'all_teachers',
  /** The families currently assigned to the author. */
  ASSIGNED_FAMILIES: 'assigned_families',
  FAMILY: 'family',
  GROUP: 'group',
  LABEL: 'label',
  TEACHER: 'teacher',
  /** One named actor: a contact or a teacher. */
  USER: 'user',
} as const;
export type AudienceKind = (typeof AudienceKind)[keyof typeof AudienceKind];

/** Kinds that name no particular record, so they carry no ref id. */
export const UNREFERENCED_AUDIENCE_KINDS: ReadonlySet<string> = new Set([
  AudienceKind.ALL_FAMILIES,
  AudienceKind.ALL_TEACHERS,
  AudienceKind.ASSIGNED_FAMILIES,
]);

export const BroadcastState = {
  DRAFT: 'draft',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  /** Some recipients were delivered and some were not. A real, terminal answer. */
  PARTIAL_FAILURE: 'partial_failure',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type BroadcastState = (typeof BroadcastState)[keyof typeof BroadcastState];

/**
 * Per-recipient delivery state.
 *
 * SENT and DELIVERED are deliberately different things. SENT means the message
 * row was written and a notification scheduled -- work this system actually
 * did. DELIVERED means a client or a push provider acknowledged receipt. A
 * successful database insert is never promoted to DELIVERED, because that would
 * make the delivery report a report on our own optimism.
 */
export const BroadcastRecipientStatus = {
  PENDING: 'pending',
  QUEUED: 'queued',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
} as const;
export type BroadcastRecipientStatus =
  (typeof BroadcastRecipientStatus)[keyof typeof BroadcastRecipientStatus];

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
