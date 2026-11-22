import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { TeachersDepartmentRole } from './pd012-policy';
import type { PermissionKey } from './permissions/catalogue';
import type { Actor } from './types';

/**
 * Educational materials: who writes, who approves, who manages
 * (owner decision, 2026-11-22; supabase/migrations/20261122100000_chat_materials_author_review.sql).
 *
 *   key                what it allows                                            today's holders (legacy bundles)
 *   materials.author   write DRAFTS, edit one's own draft, submit it for review  the Teachers manager (to designate
 *                                                                                authors); anyone granted the Content author role
 *   materials.review   approve (publish) or return an item in review, never      the Teachers supervisors and the Teachers
 *                      one's own and never changing what it says                 manager
 *   materials.manage   the whole library: retire, import, recitations, edit a    the super admin and the Teachers manager
 *                      published item (chat.can_manage_materials; unchanged)
 *   materials.view     use APPROVED items to teach (unchanged)                    unchanged
 *
 * Writing is a deliberate grant, not a job title: a Teachers supervisor reviews, and writes only once
 * given the Content author role. A key is necessary, never sufficient: the service and the database
 * (chat.guard_material_item) check the item's state and its author again.
 *
 * Pure: the caller resolves the department role and the permission set.
 */
export const MATERIAL_ROLE_KEYS = ['materials.author', 'materials.review'] as const satisfies readonly PermissionKey[];

/** The keys an existing account's role and Teachers placement give it (the legacy bundles, written as a rule). */
export function legacyMaterialsKeys(actor: Actor, teachersRole: TeachersDepartmentRole): ReadonlySet<PermissionKey> {
  const keys = new Set<PermissionKey>();
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return keys;
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return new Set(MATERIAL_ROLE_KEYS);
  if (teachersRole === 'manager' && actor.staffRole === StaffRole.MANAGER) return new Set(MATERIAL_ROLE_KEYS);
  if (teachersRole === 'member' && (actor.staffRole === StaffRole.ADMIN || actor.staffRole === StaffRole.COVERAGE)) keys.add('materials.review');
  return keys;
}

export interface MaterialsAccess {
  /** The library workspace: any of the three jobs. */
  open: boolean;
  manage: boolean;
  author: boolean;
  review: boolean;
}

/** An item's states and who moves it where. Pure: the same table the database trigger enforces. */
export type MaterialStatus = 'draft' | 'in_review' | 'published' | 'retired';

export interface MaterialMove {
  /** The item's author (created_by) and its last editor (updated_by). */
  createdBy: string;
  updatedBy: string;
}

/**
 * May `actorId`, holding `access`, change an item from `from` to `to`? (Content changes are a separate
 * question: only a manager edits anything but their own draft.)
 */
export function mayMoveMaterial(access: Pick<MaterialsAccess, 'manage' | 'author' | 'review'>, actorId: string, item: MaterialMove, from: MaterialStatus, to: MaterialStatus): boolean {
  if (access.manage) return true;
  if (from === 'draft' && (to === 'draft' || to === 'in_review')) return access.author && item.createdBy === actorId;
  if (from === 'in_review' && (to === 'published' || to === 'draft')) return access.review && item.createdBy !== actorId && item.updatedBy !== actorId;
  return false;
}
