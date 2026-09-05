import type { AttentionBucket } from '@/shared/types/domain'

/**
 * Centralised query keys. Realtime events invalidate through these, so every
 * key must be derivable from an event payload without guessing.
 */
export const qk = {
  me: ['me'] as const,
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
