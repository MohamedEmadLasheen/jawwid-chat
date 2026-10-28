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
];
