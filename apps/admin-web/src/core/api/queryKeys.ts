import type { AttentionBucket } from '@/shared/types/domain'

/**
 * Centralised query keys. Realtime events invalidate through these, so every
 * key must be derivable from an event payload without guessing.
 */
export const qk = {
  me: ['me'] as const,

  // --- Communication Operations Console (canonical) -------------------------
  // Keyed so a realtime payload can invalidate without guessing: every event
  // that matters carries a `conversationId`, and that is the key segment.
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
  conversationMessages: (id: string) => ['conversations', id, 'messages'] as const,
  conversationSearch: (q: string) => ['conversations', 'search', q] as const,
  messageSearch: (input: Record<string, unknown>) => ['search', 'messages', input] as const,

  // --- Phase 3 business model (directory, groups, labels) ------------------
  // ADDITIVE ONLY. Nothing above is edited or reordered: the console's keys and
  // the realtime invalidation that depends on them are untouched. Phase 3 emits
  // no realtime events, so these keys are invalidated by mutations alone.
  directory: ['directory'] as const,
  directoryFamilies: (filters: Record<string, unknown>) => ['directory', 'families', filters] as const,
  directoryFamily: (id: string) => ['directory', 'families', id] as const,
  familyLearners: (id: string) => ['directory', 'families', id, 'learners'] as const,
  familyAssignments: (id: string) => ['directory', 'families', id, 'assignments'] as const,
  familyLifecycle: (id: string) => ['directory', 'families', id, 'history'] as const,
  familyLabels: (id: string) => ['directory', 'families', id, 'labels'] as const,
  learnerTeacherHistory: (id: string) => ['directory', 'learners', id, 'teacher-history'] as const,

  groups: (includeArchived: boolean) => ['groups', { includeArchived }] as const,
  groupsAll: ['groups'] as const,
  group: (id: string) => ['groups', id] as const,
  groupMembers: (id: string) => ['groups', id, 'members'] as const,
  groupTeachers: (id: string) => ['groups', id, 'teachers'] as const,
  groupHistory: (id: string) => ['groups', id, 'history'] as const,

  labels: ['labels'] as const,

  // --- Phase 5 (stories, broadcast) ----------------------------------------
  // ADDITIVE ONLY, as Phase 3's keys were. Broadcast progress is polled rather
  // than invalidated by an event: the fan-out runs in a worker and its
  // progress event goes to the SENDER's actor room, so a console that is open
  // but not the sender's would otherwise never refresh.
  stories: ['stories'] as const,
  broadcasts: ['broadcasts'] as const,

  // --- Phase 6 (moderation, Command Center) --------------------------------
  // ADDITIVE ONLY, as Phase 3's and Phase 5's keys were. The queue is keyed by
  // its FILTER so switching to "escalated only" is a different query rather
  // than a refetch of the same one, and the two `*All` prefixes exist so a
  // realtime event can invalidate everything moderation-shaped without knowing
  // which filter happens to be open.
  moderationAll: ['moderation'] as const,
  moderationQueue: (filter: Record<string, unknown>) => ['moderation', 'queue', filter] as const,
  moderationRules: ['moderation', 'rules'] as const,

  commandCenterAll: ['command-center'] as const,
  commandCenterKpis: ['command-center', 'kpis'] as const,
  commandCenterSupervisors: ['command-center', 'supervisors'] as const,
  commandCenterAttention: (staffId?: string) =>
    ['command-center', 'attention', staffId ?? 'all'] as const,

  // --- Frozen (brief-era CRM). Unrouted; see PHASE-0-ADMIN-WEB-RECONCILIATION.

  duty: ['me', 'duty'] as const,
  config: ['config'] as const,
  staff: ['staff'] as const,

  inbox: (section: AttentionBucket | 'covering') => ['inbox', section] as const,
  inboxAll: ['inbox'] as const,
  awaySummary: ['inbox', 'away-summary'] as const,
  shiftBanner: ['inbox', 'shift-banner'] as const,

  family: (id: string) => ['family', id] as const,
  familyMessages: (id: string) => ['family', id, 'messages'] as const,
  familyCases: (id: string) => ['family', id, 'cases'] as const,
  families: (filters: Record<string, unknown>) => ['families', filters] as const,
  transferImpact: (id: string, to: string) => ['family', id, 'transfer-impact', to] as const,

  tasks: (filters: Record<string, unknown>) => ['tasks', filters] as const,
  tasksAll: ['tasks'] as const,

  shifts: ['coverage', 'shifts'] as const,
  coverageRules: ['coverage', 'rules'] as const,
  absences: ['coverage', 'absences'] as const,
  coverageTonight: ['coverage', 'tonight'] as const,
  coverageGaps: (days: number) => ['coverage', 'gaps', days] as const,
  coverageAll: ['coverage'] as const,

  dashboardHeader: ['dashboard', 'header'] as const,
  teamNow: ['dashboard', 'team-now'] as const,
  unattended: ['dashboard', 'unattended'] as const,
  needsAction: ['dashboard', 'needs-action'] as const,
  thisWeek: ['dashboard', 'this-week'] as const,
  dashboardAll: ['dashboard'] as const,
}
