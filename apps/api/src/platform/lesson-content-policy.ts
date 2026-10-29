import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { TeachersDepartmentRole } from './pd012-policy';
import type { PermissionKey } from './permissions/catalogue';
import type { Actor } from './types';

/**
 * PD-49: who sees and who signs children's Quran content and game mechanics
 * (docs/product/pd049-children-quran-experience-plan.md §F.2).
 *
 *   key                            the step it signs   today's holders (legacy bundles)
 *   lesson_content.view            (none: reads)       the Teachers department (manager + supervisors)
 *   lesson_content.check           check               the Teachers Manager; whoever they delegate it to
 *   lesson_content.review_teacher  teacher             the Teachers Manager; whoever they delegate it to
 *   lesson_content.review_scholar  scholar             nobody by bundle: the super admin grants the
 *                                                      Scholar reviewer role (owner, 2026-10-29)
 *
 * Two rules beyond the keys (review of #258):
 *   - the scholar's step counts only through an EXPLICIT grant of a role that
 *     carries review_scholar (scholar_reviewer). The super admin's implicit
 *     every-key (and the legacy bundle written for it below) never signs as
 *     the scholar;
 *   - the lessons are one set of static files for every academy, so their
 *     review belongs to ONE content organization (chat.config
 *     lesson_content.organization_id). Staff of any other organization -- or
 *     everyone, while it is unset -- see and sign nothing.
 *
 * A key is necessary, never sufficient: the database
 * (chat.review_lesson_content) checks the key of the step again, that the
 * signer is active, that steps come in order, and that one person signs one
 * step of a text.
 *
 * Pure: the caller resolves the department role and the permission set.
 */
export type ReviewStep = 'check' | 'teacher' | 'scholar';
export const REVIEW_STEPS: readonly ReviewStep[] = ['check', 'teacher', 'scholar'];

/** The key a step needs; the same map is chat.lesson_content_step_key. */
export const STEP_KEY: Readonly<Record<ReviewStep, PermissionKey>> = {
  check: 'lesson_content.check',
  teacher: 'lesson_content.review_teacher',
  scholar: 'lesson_content.review_scholar',
};

/** The keys the legacy bundles hand out (the scholar's is never among them). */
export const LESSON_CONTENT_BUNDLED_KEYS = ['lesson_content.view', 'lesson_content.check', 'lesson_content.review_teacher'] as const satisfies readonly PermissionKey[];

/** The keys an existing account's role and Teachers placement give it (the legacy bundles, written as a rule). */
export function legacyLessonContentKeys(actor: Actor, teachersRole: TeachersDepartmentRole): ReadonlySet<PermissionKey> {
  const keys = new Set<PermissionKey>();
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return keys;
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return new Set<PermissionKey>([...LESSON_CONTENT_BUNDLED_KEYS, 'lesson_content.review_scholar']);
  if (teachersRole === 'manager' && actor.staffRole === StaffRole.MANAGER) return new Set(LESSON_CONTENT_BUNDLED_KEYS);
  if (teachersRole === 'member' && (actor.staffRole === StaffRole.ADMIN || actor.staffRole === StaffRole.COVERAGE)) keys.add('lesson_content.view');
  return keys;
}

export interface LessonContentAccess {
  view: boolean;
  /** The steps this account may sign. */
  steps: ReviewStep[];
}

export interface LessonContentStanding {
  /** The content organization (chat.config lesson_content.organization_id), or null while unset. */
  contentOrganizationId: string | null;
  /** review_scholar through an explicitly granted role (never the super admin's implicit key). */
  scholarGranted: boolean;
}

/** What a set of keys opens. Signing any step implies seeing the content. */
export function lessonContentAccess(actor: Actor, permissions: ReadonlySet<string>, standing: LessonContentStanding): LessonContentAccess {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive) return { view: false, steps: [] };
  if (!standing.contentOrganizationId || actor.organizationId !== standing.contentOrganizationId) return { view: false, steps: [] };
  const steps = REVIEW_STEPS.filter((s) => permissions.has(STEP_KEY[s]) && (s !== 'scholar' || standing.scholarGranted));
  return { view: steps.length > 0 || permissions.has('lesson_content.view'), steps };
}
