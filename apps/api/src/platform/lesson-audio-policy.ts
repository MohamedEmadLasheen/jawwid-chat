import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { TeachersDepartmentRole } from './pd012-policy';
import type { PermissionKey } from './permissions/catalogue';
import type { Actor } from './types';

/**
 * PD-48: who may listen to and who may approve the lessons' computer-voice
 * clips (docs/product/pd048-lesson-voice-over-design.md §8; owner Q4, 2026-10-28).
 *
 *   key                   what it allows                                  today's holders (legacy bundles)
 *   lesson_audio.view     the review page: listen, history, the reports   the Teachers department (manager + supervisors)
 *   lesson_audio.review   approve, reject, withdraw, decide "no audio"    the Teachers Manager; anyone granted the
 *                                                                         Pronunciation reviewer role
 *
 * Approving is a deliberate grant, not a job title: a Teachers supervisor
 * listens, and approves only once given the role. A key is necessary, never
 * sufficient: the database (chat.review_lesson_audio_clip) checks the key
 * again, that the reviewer is active, that two approvals are two people, and
 * that the hashes reviewed are the clip's.
 *
 * Pure: the caller resolves the department role and the permission set.
 */
export const LESSON_AUDIO_KEYS = ['lesson_audio.view', 'lesson_audio.review'] as const satisfies readonly PermissionKey[];

/** The keys an existing account's role and Teachers placement give it (the legacy bundles, written as a rule). */
export function legacyLessonAudioKeys(actor: Actor, teachersRole: TeachersDepartmentRole): ReadonlySet<PermissionKey> {
  const keys = new Set<PermissionKey>();
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return keys;
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return new Set(LESSON_AUDIO_KEYS);
  if (teachersRole === 'manager' && actor.staffRole === StaffRole.MANAGER) return new Set(LESSON_AUDIO_KEYS);
  if (teachersRole === 'member' && (actor.staffRole === StaffRole.ADMIN || actor.staffRole === StaffRole.COVERAGE)) keys.add('lesson_audio.view');
  return keys;
}

export interface LessonAudioAccess {
  view: boolean;
  review: boolean;
}

/** What a set of keys opens on the review page. Reviewing implies listening. */
export function lessonAudioAccess(actor: Actor, permissions: ReadonlySet<string>): LessonAudioAccess {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive) return { view: false, review: false };
  const review = permissions.has('lesson_audio.review');
  return { view: review || permissions.has('lesson_audio.view'), review };
}
