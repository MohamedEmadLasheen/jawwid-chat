/**
 * Responsibility categories -- mirrors the CHECK on
 * chat.staff_responsibility.category (20261013150000). Add a value in both
 * places in the same change, or the database will refuse what the API allows.
 *
 * These are LABELS describing what someone works on. None of them grants
 * access to any module: `teacher_supervision` does not let anyone read a
 * teacher's conversations, and `message_moderation` does not make anyone an
 * approver -- canApprove decides that, from role and family ownership.
 *
 * No equivalent taxonomy existed: `chat.staff.role` is an authorization role,
 * and the legacy finance/technical/academic values are departments slated for
 * PD-5's own `department` attribute. Neither is reused as a responsibility,
 * because a label that doubled as a role would become a permission.
 */
export const RESPONSIBILITY_CATEGORIES = [
  'family_follow_up',
  'student_follow_up',
  'teacher_supervision',
  'teaching_quality',
  'academic_progress',
  'attendance_monitoring',
  'operations_scheduling',
  'message_moderation',
  'content_materials',
  'customer_support',
  'complaints_escalations',
  'sales_admissions',
  'team_management',
  'other',
] as const;
export type ResponsibilityCategory = (typeof RESPONSIBILITY_CATEGORIES)[number];

export function isResponsibilityCategory(value: unknown): value is ResponsibilityCategory {
  return typeof value === 'string' && (RESPONSIBILITY_CATEGORIES as readonly string[]).includes(value);
}

/** Audit vocabulary: entity is always `staff_profile`, entity_id the staff id. */
export const ProfileAuditAction = {
  UPDATED: 'staff_profile.updated',
  PHOTO_SET: 'staff_profile.photo_set',
  PHOTO_REMOVED: 'staff_profile.photo_removed',
  RESPONSIBILITY_ASSIGNED: 'staff_responsibility.assigned',
  RESPONSIBILITY_ENDED: 'staff_responsibility.ended',
  REPORTING_LINE_SET: 'staff_reporting_line.set',
  REPORTING_LINE_CLEARED: 'staff_reporting_line.cleared',
} as const;
export type ProfileAuditAction = (typeof ProfileAuditAction)[keyof typeof ProfileAuditAction];

export const PROFILE_AUDIT_ENTITY = 'staff_profile';
export const PROFILE_AUDIT_ACTIONS: readonly string[] = Object.values(ProfileAuditAction);
