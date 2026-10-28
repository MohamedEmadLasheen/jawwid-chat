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
];
