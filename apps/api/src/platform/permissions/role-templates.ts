import type { PermissionKey } from './catalogue';

/**
 * PD-40 PR-4: the access roles every organization starts with. A template is
 * ordinary data once seeded: the super admin edits or archives it like any
 * role (chat.update_access_role, archive_access_role), and grants go through
 * the same rules (H1-H8, S1, C1). `is_template` only says where it came from.
 *
 * The migration 20261029190000_chat_pd040_designer_template.sql seeds these in
 * a generated block; pd040-role-templates.spec.ts fails when it differs. A
 * later template is a new entry here and a block in its own migration.
 */
export interface AccessRoleTemplate {
  key: string;
  nameEn: string;
  nameAr: string;
  description: string;
  maxTier: 'specialist' | 'supervisor' | 'manager';
  permissions: readonly PermissionKey[];
  /** The migration whose generated block seeds it. */
  migration: string;
  /**
   * 'super_admin': only the super admin may grant this role -- it carries a key
   * that is not delegable and in no legacy bundle, so no department manager
   * holds or grants it (H5). pd040-role-templates.spec.ts holds it to that.
   * Absent: a department manager who holds every key may grant it (S1).
   */
  grantedBy?: 'super_admin';
}

export const ACCESS_ROLE_TEMPLATES: readonly AccessRoleTemplate[] = [
  {
    // Plan §7, aligned with PD-41: designs and uploads, never sends, cancels or
    // declines (certificates.deliver is the requester's).
    key: 'designer',
    nameEn: 'Certificate designer',
    nameAr: 'مصمم الشهادات',
    description: 'Designs and uploads certificates. Never sends one to a family.',
    maxTier: 'specialist',
    permissions: ['certificates.design', 'certificates.view'],
    migration: '20261029190000_chat_pd040_designer_template.sql',
  },
  {
    // PD-48 (owner Q4): the teachers the super admin or the Teachers Manager
    // judge qualified to approve lesson voice-over. Two of them approve a clip.
    key: 'pronunciation_reviewer',
    nameEn: 'Pronunciation reviewer',
    nameAr: 'مراجع النطق',
    description: "Listens to the lessons' computer-voice clips and approves or rejects each one. Two reviewers approve a clip before it plays.",
    maxTier: 'specialist',
    permissions: ['lesson_audio.review', 'lesson_audio.view'],
    migration: '20261029230000_chat_pd048_lesson_audio.sql',
  },
  {
    // PD-49 (owner, 2026-10-29: "We have someone"): the qualified scholar who
    // signs the last step of children's Quran content -- tafsir, lessons,
    // stories, authenticated asbab -- and every game mechanic once. Content
    // only: no family, child, chat or finance key. The super admin alone grants it.
    key: 'scholar_reviewer',
    nameEn: 'Scholar reviewer',
    nameAr: 'المراجع الشرعي',
    description: "Signs the scholar's step of children's Quran content and of each game mechanic, after the source check and the teacher.",
    maxTier: 'specialist',
    permissions: ['lesson_content.review_scholar', 'lesson_content.view'],
    migration: '20261029235000_chat_pd049_lesson_content_review.sql',
    grantedBy: 'super_admin',
  },
];
