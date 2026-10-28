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
  /**
   * PD-5: the organization owner. Granted only by the bootstrap procedure
   * (20261013120000 guards the column). NOT in FAMILY_FACING_STAFF_ROLES: that
   * set also decides stories and the legacy SQL helpers. PD-8 (2026-10-15)
   * gives it full read AND write in every conversation of its organization,
   * through CONVERSATION_STAFF_ROLES below.
   */
  SUPER_ADMIN: 'super_admin',
  /**
   * PD-40: a department account -- the Designer, later the Accountant or
   * Marketing. Holds NOTHING by its role: every page and action comes from the
   * access roles it is granted (chat.staff_access_profile). Not family-facing,
   * never a department supervisor or manager.
   */
  SPECIALIST: 'specialist',
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

/**
 * PD-8: staff roles that take part in conversations -- the family-facing roles
 * plus the super admin, who has full read and write (owner decision 2026-10-15).
 * Which conversations is decided by chat.staff_conversation_access, never by
 * the role alone.
 */
export const CONVERSATION_STAFF_ROLES: ReadonlySet<string> = new Set([
  ...FAMILY_FACING_STAFF_ROLES,
  StaffRole.SUPER_ADMIN,
]);

export const ConversationType = {
  DIRECT: 'direct',
  STUDENT_GROUP: 'student_group',
  CLASS_GROUP: 'class_group',
  OFFICIAL: 'official',
  /**
   * PD-8: a group a supervisor creates about one or more children of ONE
   * family (chat.conversation_learner). Moderated like a Student Group.
   */
  FAMILY_GROUP: 'family_group',
  /**
   * PD-11 / PD-12: one staff-only conversation per teacher with the Teachers
   * department (chat.conversation.supervised_teacher_id). Never a contact.
   */
  TEACHER_SUPERVISION: 'teacher_supervision',
  /**
   * PD-11 T4: one staff-only conversation per teacher with Sales (and the
   * Teachers department) about their trial lessons
   * (chat.conversation.trial_teacher_id). Never a contact or a prospect.
   */
  TRIAL_GROUP: 'trial_group',
  /**
   * PD-35 B6: one staff-only room per department (chat.conversation.department_id):
   * the department's manager and its members. Never a contact or a teacher.
   */
  DEPARTMENT_ROOM: 'department_room',
} as const;

/** Group conversations: BR-1 admin presence (C-4) applies. */
export const GROUP_CONVERSATION_TYPES: ReadonlySet<string> = new Set([
  ConversationType.STUDENT_GROUP,
  ConversationType.CLASS_GROUP,
  ConversationType.FAMILY_GROUP,
]);
/**
 * PD-19, second amendment (2026-10-22): conversations whose calls are GROUP
 * calls. The family-facing
 * groups above plus the staff-only groups around one teacher -- the trial group
 * and the supervision conversation -- which seat the teacher with several staff
 * and so cannot be a two-seat DIRECT call (chat.assert_call_br1). Deliberately a
 * separate set: C-4 admin presence stays keyed on GROUP_CONVERSATION_TYPES.
 */
export const GROUP_CALL_CONVERSATION_TYPES: ReadonlySet<string> = new Set([
  ...GROUP_CONVERSATION_TYPES,
  ConversationType.TRIAL_GROUP,
  ConversationType.TEACHER_SUPERVISION,
]);
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
  /** PD-11: a ticket's card. Written by the server only; a client can never author one. */
  CARD: 'card',
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

/** `audio` is a voice story (20261017120000). A story with no media is a text story. */
export const StoryMediaKind = { IMAGE: 'image', VIDEO: 'video', AUDIO: 'audio' } as const;
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
  /**
   * 20261017120000: a FILTER rather than a record -- user type, plus, for
   * families, subscription plan length, number of children and country. See
   * StorySegmentFilter in story-audience.resolver.ts.
   */
  SEGMENT: 'segment',
} as const;
export type StoryAudienceKind = (typeof StoryAudienceKind)[keyof typeof StoryAudienceKind];

/** The kinds that name no particular record and therefore carry no ref id. */
export const UNSCOPED_STORY_AUDIENCE_KINDS: ReadonlySet<string> = new Set([
  StoryAudienceKind.ALL_FAMILIES,
  StoryAudienceKind.ALL_TEACHERS,
  StoryAudienceKind.ASSIGNED_FAMILIES,
  StoryAudienceKind.SEGMENT,
]);

/**
 * Staff roles that may publish a story: the family-facing set plus the super
 * admin (owner decision 2026-10-17 -- the Admin Portal is its publishing
 * surface, and PD-8 already gave it full write). Mirrors
 * chat.current_can_publish_story().
 */
export const STORY_PUBLISHER_ROLES: ReadonlySet<string> = new Set([
  ...FAMILY_FACING_STAFF_ROLES,
  StaffRole.SUPER_ADMIN,
]);

/** A story's one call to action. Mirrors `story_cta_shape`. */
export const StoryCtaKind = {
  /** Open the ACADEMY's WhatsApp number. */
  WHATSAPP: 'whatsapp',
  /** Open a direct conversation with the staff member who published it. */
  MESSAGE_PUBLISHER: 'message_publisher',
  /** Open an https link. */
  LINK: 'link',
} as const;
export type StoryCtaKind = (typeof StoryCtaKind)[keyof typeof StoryCtaKind];

/** Backgrounds a text or voice story may use. Mirrors `story_background_check`. */
export const STORY_BACKGROUNDS = [
  'teal', 'gold', 'plum', 'ink', 'rose', 'sky', 'forest', 'sunset',
] as const;
export type StoryBackground = (typeof STORY_BACKGROUNDS)[number];

/** Subscription plan lengths, in months. Mirrors `family_subscription_plan_months_check`. */
export const SUBSCRIPTION_PLAN_MONTHS = [1, 3, 6, 12] as const;

// ---------------------------------------------------------------------------
// PD-9 / PD-11: lessons. Mirrors the checks of 20261018120000.
// ---------------------------------------------------------------------------

/** PD-11 T4: `trial` is a lesson for a prospect (no learner), handled by TrialService only. */
export const LessonKind = { REGULAR: 'regular', MAKEUP: 'makeup', TRIAL: 'trial' } as const;
export type LessonKind = (typeof LessonKind)[keyof typeof LessonKind];

export const LessonOutcome = {
  HELD: 'held',
  STUDENT_APOLOGY: 'student_apology',
  TEACHER_APOLOGY: 'teacher_apology',
  ADMIN_CANCELLED: 'admin_cancelled',
  STUDENT_NO_SHOW: 'student_no_show',
  TEACHER_NO_SHOW: 'teacher_no_show',
  /** PD-11 T2: a future lesson replaced by a regular-time change. Not counted by statistics. */
  RESCHEDULED: 'rescheduled',
  /** PD-11 T3: a future lesson removed because the learner's study is paused or stopped. Not counted. */
  SUSPENDED: 'suspended',
  /** PD-15: its report was deleted and not resent. Gone from every statistic; final. */
  VOIDED: 'voided',
} as const;
export type LessonOutcome = (typeof LessonOutcome)[keyof typeof LessonOutcome];

export const CardKind = {
  LESSON_REPORT: 'lesson_report',
  /** PD-15: an outcome corrected by the Teachers or Operations department or the super admin. */
  LESSON_CORRECTED: 'lesson_corrected',
  LESSON_ABSENCE: 'lesson_absence',
  LESSON_APOLOGY: 'lesson_apology',
  LESSON_TEACHER_APOLOGY: 'lesson_teacher_apology',
  /** An admin cancellation or a teacher absence: the lesson will not happen. */
  LESSON_CANCELLED: 'lesson_cancelled',
  LESSON_LATE_APOLOGY: 'lesson_late_apology',
  LESSON_RULING: 'lesson_ruling',
  LESSON_MAKEUP_BOOKED: 'lesson_makeup_booked',
  /** PD-31: one lesson moved to another time. */
  LESSON_MOVED: 'lesson_moved',
  /** PD-31: a one-off lesson a change of teacher could not carry; a new time follows. */
  LESSON_UNSCHEDULED: 'lesson_unscheduled',
  LESSON_MAKEUP_RESOLVED: 'lesson_makeup_resolved',
  SCHEDULE_CHANGE_REQUESTED: 'schedule_change_requested',
  SCHEDULE_CHANGE_DECIDED: 'schedule_change_decided',
  LEARNER_TRANSFERRED: 'learner_transferred',
  LEARNER_HANDOVER: 'learner_handover',
  LEARNER_SUSPENDED: 'learner_suspended',
  LEARNER_RETURN_SOON: 'learner_return_soon',
  LEARNER_RESUMED: 'learner_resumed',
  TEACHER_BONUS: 'teacher_bonus',
  /** PD-12: posted in the teacher supervision conversation. */
  CERTIFICATE_REQUESTED: 'certificate_requested',
  /** PD-12: posted in the learner's group, carrying the certificate file as its attachment. */
  CERTIFICATE_ISSUED: 'certificate_issued',
  CERTIFICATE_DECLINED: 'certificate_declined',
  LEAVE_REQUESTED: 'leave_requested',
  LEAVE_APPROVED: 'leave_approved',
  LEAVE_DECLINED: 'leave_declined',
  LEAVE_WITHDRAWN: 'leave_withdrawn',
  LEAVE_CANCELLED: 'leave_cancelled',
  /** PD-11 T4: posted in the teacher's trial group. */
  TRIAL_BOOKED: 'trial_booked',
  TRIAL_CANCELLED: 'trial_cancelled',
  TRIAL_REPORT: 'trial_report',
  TRIAL_NO_SHOW: 'trial_no_show',
  /** Sales' decision. Never carries the not-subscribed reason: the teacher reads this group. */
  TRIAL_DECISION: 'trial_decision',
  /** Trial journey: a supervisor corrected a trial's outcome. Carries the new result only. */
  TRIAL_CORRECTION: 'trial_correction',
  /** A booked trial moved to another time, or away to another teacher's group. */
  TRIAL_RESCHEDULED: 'trial_rescheduled',
  /** PD-12 S2: a confirmed ladder step, in the teacher's supervision conversation. */
  DISCIPLINE_WARNING: 'discipline_warning',
  DISCIPLINE_DEDUCTION: 'discipline_deduction',
  DISCIPLINE_SUSPENSION: 'discipline_suspension',
  /** PD-13: a call scheduled for a date and time, in the conversation it will happen in. */
  CALL_SCHEDULED: 'call_scheduled',
  /** PD-13: a members-only call link, joinable from the moment it is posted. */
  CALL_LINK: 'call_link',
  /** PD-13: the scheduled call announced above will not happen. */
  CALL_SCHEDULE_CANCELLED: 'call_schedule_cancelled',
  /**
   * PD-30, in the family's direct chat with its supervisor (PD-4): the
   * subscription's lessons are used up and N grace lessons are left. Never in
   * the group -- the teacher sees nothing financial.
   */
  SUBSCRIPTION_GRACE: 'subscription_grace',
  /** PD-30, in the family's direct chat: the child's lessons are paused, and why (lessons used up / instalment overdue). */
  SUBSCRIPTION_LOCKED: 'subscription_locked',
  /** PD-30, in the child's group: the lessons are paused -- no reason, no amount (the teacher reads the group). */
  LESSONS_PAUSED: 'lessons_paused',
  /** PD-30, in the child's group: the lessons are back on. */
  SUBSCRIPTION_UNLOCKED: 'subscription_unlocked',
  /** PD-30, in the family's direct chat: a parent asked to renew. */
  RENEWAL_REQUESTED: 'subscription_renewal_requested',
  // PD-35: report corrections and evaluations, in the teacher's supervision conversation.
  REPORT_CORRECTION_REQUESTED: 'report_correction_requested',
  EVALUATION_SHARED: 'evaluation_shared',
  IMPROVEMENT_PLAN_SHARED: 'improvement_plan_shared',
  // PD-35 B6: an escalation case, announced in its target department's room (ids and names only).
  CASE_ESCALATED: 'case_escalated',
} as const;
export type CardKind = (typeof CardKind)[keyof typeof CardKind];

export const RulingKind = { LATE_APOLOGY: 'late_apology', MAKEUP_FOLLOWUP: 'makeup_followup' } as const;

/** PD-11: what a supervisor did about a teacher-cancelled lesson no make-up replaced. */
export const MakeupAction = {
  SUBSTITUTE_TEACHER: 'substitute_teacher',
  FAMILY_CREDIT: 'family_credit',
  PACKAGE_EXTENSION: 'package_extension',
  WAIVED: 'waived',
} as const;
export type MakeupAction = (typeof MakeupAction)[keyof typeof MakeupAction];

/** The outcomes that owe the family a make-up: the teacher did not give the lesson. */
export const MAKEUP_OWING_OUTCOMES: ReadonlySet<string> = new Set(['teacher_apology', 'teacher_no_show']);

/** PD-12: a student certificate's life. */
export const CertificateState = { REQUESTED: 'requested', ISSUED: 'issued', DECLINED: 'declined' } as const;
export type CertificateState = (typeof CertificateState)[keyof typeof CertificateState];

/** PD-12: a leave request's life. */
export const LeaveState = {
  REQUESTED: 'requested',
  APPROVED: 'approved',
  DECLINED: 'declined',
  WITHDRAWN: 'withdrawn',
  CANCELLED: 'cancelled',
} as const;
export type LeaveState = (typeof LeaveState)[keyof typeof LeaveState];
export const RulingDecision = { EXCUSED: 'excused', TEACHER_CREDITED: 'teacher_credited' } as const;
export type RulingDecision = (typeof RulingDecision)[keyof typeof RulingDecision];

// PD-11 T3: the fixed reason lists of 20261018160000 (free text goes in `note`).
export const TRANSFER_REASONS: ReadonlySet<string> = new Set([
  'family_request', 'teacher_request', 'schedule_fit', 'level_fit', 'quality', 'teacher_leaving', 'other',
]);
export const SUSPENSION_REASONS: ReadonlySet<string> = new Set([
  'travel', 'exams', 'health', 'holiday', 'financial', 'schedule', 'quality', 'finished', 'moved_elsewhere', 'other',
]);
export const SupervisionKind = {
  BONUS: 'bonus',
  COMPLAINT: 'complaint',
  MONTHLY_COMMENT: 'monthly_comment',
  NOTE: 'note',
} as const;

/** PD-13: what a chat.scheduled_call row is. */
export const ScheduledCallKind = { SCHEDULED: 'scheduled', LINK: 'link' } as const;
export type ScheduledCallKind = (typeof ScheduledCallKind)[keyof typeof ScheduledCallKind];
