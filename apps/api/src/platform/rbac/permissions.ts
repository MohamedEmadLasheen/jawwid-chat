/**
 * The permission vocabulary and the default role mapping.
 *
 * THIS FILE IS A MIRROR, NOT A SOURCE. chat.permission and
 * chat.role_permission (20260907100100_chat_phase1_rbac.sql) are authoritative;
 * this exists so TypeScript can reason about permissions without a round trip,
 * and test/unit/authorization/rbac-mirror.spec.ts asserts the two are identical.
 * If they ever disagree, the migration is right and this file is wrong.
 *
 * Canonical design: docs/architecture/AUTHORIZATION-MODEL.md 3.
 */

export const Permission = {
  CONVERSATIONS_READ: 'conversations.read',
  CONVERSATIONS_MANAGE: 'conversations.manage',
  MESSAGES_READ: 'messages.read',
  MESSAGES_SEND: 'messages.send',
  MESSAGES_DELETE: 'messages.delete',
  MESSAGES_MODERATE: 'messages.moderate',
  MESSAGES_INTERNAL: 'messages.internal',
  FAMILIES_READ: 'families.read',
  FAMILIES_ASSIGN: 'families.assign',
  /** Phase 3: family/student profile and lifecycle, and filing a family under a label. */
  FAMILIES_MANAGE: 'families.manage',
  /** Phase 3: assign or transfer the teacher of a student. */
  LEARNERS_ASSIGN_TEACHER: 'learners.assign_teacher',
  GROUPS_READ: 'groups.read',
  GROUPS_MANAGE: 'groups.manage',
  LABELS_READ: 'labels.read',
  /** Phase 3: curating the label VOCABULARY, which every supervisor shares. */
  LABELS_MANAGE: 'labels.manage',
  CONTACTS_VIEW_PRIVATE: 'contacts.view_private',
  CALLS_START: 'calls.start',
  CALLS_ACCEPT: 'calls.accept',
  /** Phase 5: start a FOLLOW-UP call, which is a call that may be recorded. */
  CALLS_RECORD: 'calls.record',
  /** Phase 5: play back a recording, and know that one exists. */
  RECORDINGS_READ: 'recordings.read',
  /** Phase 5: see the stories published to you. */
  STORIES_READ: 'stories.read',
  /** Phase 5: create and publish a story to a resolved audience. */
  STORIES_PUBLISH: 'stories.publish',
  BROADCASTS_SEND: 'broadcasts.send',
  AUDIT_READ: 'audit.read',
  SETTINGS_MANAGE: 'settings.manage',
  USERS_MANAGE: 'users.manage',
  SESSIONS_MANAGE: 'sessions.manage',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

/**
 * The role an actor holds for permission purposes. `parent` and `teacher` are
 * roles here even though they are not staff roles: a permission model that only
 * describes staff has to answer "may a parent send" somewhere else, and
 * somewhere else is where rules rot.
 */
export const AuthzRole = {
  PARENT: 'parent',
  TEACHER: 'teacher',
  ADMIN: 'admin',
  COVERAGE_ADMIN: 'coverage_admin',
  MANAGER: 'manager',
  SUPER_ADMIN: 'super_admin',
} as const;
export type AuthzRole = (typeof AuthzRole)[keyof typeof AuthzRole];

const P = Permission;

/**
 * The DEFAULT mapping. Scope narrows every one of these to a set of records;
 * holding `conversations.read` says nothing about WHICH conversations.
 */
export const ROLE_PERMISSIONS: Readonly<Record<AuthzRole, readonly Permission[]>> = {
  [AuthzRole.PARENT]: [
    P.CONVERSATIONS_READ, P.MESSAGES_READ, P.MESSAGES_SEND, P.FAMILIES_READ,
    P.CALLS_START, P.CALLS_ACCEPT, P.SESSIONS_MANAGE,
    // Phase 5: reading the stories published to them. Note the absence of
    // CALLS_RECORD and RECORDINGS_READ -- a parent was on the call, which is
    // not the same as being entitled to keep a copy of it.
    P.STORIES_READ,
  ],
  [AuthzRole.TEACHER]: [
    P.CONVERSATIONS_READ, P.MESSAGES_READ, P.MESSAGES_SEND, P.FAMILIES_READ,
    P.CALLS_START, P.CALLS_ACCEPT, P.SESSIONS_MANAGE,
    // A teacher sees the groups they teach and nothing else about groups. The
    // roster policy narrows even that to their own groups.
    P.GROUPS_READ,
    // Phase 5. A teacher READS stories and does not publish them: publishing
    // reaches families the teacher has no supervisory relationship with.
    P.STORIES_READ,
  ],
  [AuthzRole.ADMIN]: [
    P.CONVERSATIONS_READ, P.CONVERSATIONS_MANAGE, P.MESSAGES_READ, P.MESSAGES_SEND,
    P.MESSAGES_MODERATE, P.MESSAGES_INTERNAL, P.FAMILIES_READ,
    P.CALLS_START, P.CALLS_ACCEPT, P.SESSIONS_MANAGE,
    // Phase 3. Note the absence of LABELS_MANAGE: an admin files their own
    // families under an existing label, but renaming or deleting one changes
    // what every other supervisor sees, so curation is a manager's act.
    P.FAMILIES_MANAGE, P.LEARNERS_ASSIGN_TEACHER,
    P.GROUPS_READ, P.GROUPS_MANAGE, P.LABELS_READ,
    // Phase 5. Publishing is Manager/Admin per the Phase 5 brief; the audience
    // resolver still narrows an admin to their own families, so "publish" here
    // means "to my families", not "to the academy".
    P.STORIES_READ, P.STORIES_PUBLISH, P.CALLS_RECORD, P.RECORDINGS_READ,
  ],
  [AuthzRole.COVERAGE_ADMIN]: [
    P.CONVERSATIONS_READ, P.CONVERSATIONS_MANAGE, P.MESSAGES_READ, P.MESSAGES_SEND,
    P.MESSAGES_MODERATE, P.MESSAGES_INTERNAL, P.FAMILIES_READ,
    P.CALLS_START, P.CALLS_ACCEPT, P.SESSIONS_MANAGE,
    P.FAMILIES_MANAGE, P.LEARNERS_ASSIGN_TEACHER,
    P.GROUPS_READ, P.GROUPS_MANAGE, P.LABELS_READ,
    // Phase 5. IDENTICAL to admin above, which is the invariant this model
    // rests on: the two roles differ in SCOPE, never in keys. A coverage admin
    // publishes to the families they are covering right now -- the audience
    // resolver narrows every clause to live scope -- and when the cover ends so
    // does the reach, with no permission change at all.
    P.STORIES_READ, P.STORIES_PUBLISH, P.CALLS_RECORD, P.RECORDINGS_READ,
  ],
  [AuthzRole.MANAGER]: [
    P.CONVERSATIONS_READ, P.CONVERSATIONS_MANAGE, P.MESSAGES_READ, P.MESSAGES_SEND,
    P.MESSAGES_DELETE, P.MESSAGES_MODERATE, P.MESSAGES_INTERNAL,
    P.FAMILIES_READ, P.FAMILIES_ASSIGN, P.CONTACTS_VIEW_PRIVATE,
    P.CALLS_START, P.CALLS_ACCEPT, P.BROADCASTS_SEND, P.AUDIT_READ,
    P.SETTINGS_MANAGE, P.SESSIONS_MANAGE,
    P.FAMILIES_MANAGE, P.LEARNERS_ASSIGN_TEACHER,
    P.GROUPS_READ, P.GROUPS_MANAGE, P.LABELS_READ, P.LABELS_MANAGE,
    P.STORIES_READ, P.STORIES_PUBLISH, P.CALLS_RECORD, P.RECORDINGS_READ,
  ],
  [AuthzRole.SUPER_ADMIN]: [
    P.CONVERSATIONS_READ, P.CONVERSATIONS_MANAGE, P.MESSAGES_READ, P.MESSAGES_SEND,
    P.MESSAGES_DELETE, P.MESSAGES_MODERATE, P.MESSAGES_INTERNAL,
    P.FAMILIES_READ, P.FAMILIES_ASSIGN, P.CONTACTS_VIEW_PRIVATE,
    P.CALLS_START, P.CALLS_ACCEPT, P.BROADCASTS_SEND, P.AUDIT_READ,
    P.SETTINGS_MANAGE, P.USERS_MANAGE, P.SESSIONS_MANAGE,
    P.FAMILIES_MANAGE, P.LEARNERS_ASSIGN_TEACHER,
    P.GROUPS_READ, P.GROUPS_MANAGE, P.LABELS_READ, P.LABELS_MANAGE,
    P.STORIES_READ, P.STORIES_PUBLISH, P.CALLS_RECORD, P.RECORDINGS_READ,
  ],
};

export const OverrideEffect = { ALLOW: 'allow', DENY: 'deny' } as const;
export type OverrideEffect = (typeof OverrideEffect)[keyof typeof OverrideEffect];

export interface PermissionOverride {
  readonly permission: string;
  readonly effect: string;
  /** null = never expires. */
  readonly expiresAt?: Date | null;
}

/**
 * PRECEDENCE, and the only place it is defined:
 *
 *   1. an unexpired DENY   -> refused, whatever the role grants
 *   2. an unexpired ALLOW  -> granted, even though the role does not
 *   3. the role default
 *   4. otherwise refused
 *
 * DENY winning is the point. Without it, restricting one person means inventing
 * a role for them, and role vocabularies that grow per-person stop describing
 * anything. An expired override is not an override: it falls back to the role,
 * so a temporary grant cannot outlive its window by being forgotten.
 */
export function resolveEffectivePermissions(
  role: AuthzRole | string | null,
  overrides: readonly PermissionOverride[] = [],
  now: Date = new Date(),
): ReadonlySet<string> {
  const live = overrides.filter((o) => !o.expiresAt || o.expiresAt > now);
  const denied = new Set(live.filter((o) => o.effect === OverrideEffect.DENY).map((o) => o.permission));
  const allowed = new Set(live.filter((o) => o.effect === OverrideEffect.ALLOW).map((o) => o.permission));

  const base = role && role in ROLE_PERMISSIONS ? ROLE_PERMISSIONS[role as AuthzRole] : [];
  const effective = new Set<string>(base);
  for (const key of allowed) effective.add(key);
  for (const key of denied) effective.delete(key);
  return effective;
}
