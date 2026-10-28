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

  adminOverview: ['admin', 'overview'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminConversations: ['admin', 'conversations'] as const,
  adminMessages: (id: string) => ['admin', 'conversations', id, 'messages'] as const,
  adminStories: ['admin', 'stories'] as const,

  teacherProfileReviews: ['teacher-profile-reviews'] as const,
  teacherProfileReview: (profileId: string) =>
    ['teacher-profile-reviews', profileId] as const,

  inbox: (section: AttentionBucket | 'covering') => ['inbox', section] as const,
  inboxAll: ['inbox'] as const,
  awaySummary: ['inbox', 'away-summary'] as const,
  shiftBanner: ['inbox', 'shift-banner'] as const,

  family: (id: string) => ['family', id] as const,
  familyMessages: (id: string) => ['family', id, 'messages'] as const,
  familyCases: (id: string) => ['family', id, 'cases'] as const,
  transferImpact: (id: string, to: string) => ['family', id, 'transfer-impact', to] as const,

  tasks: (filters: Record<string, unknown>) => ['tasks', filters] as const,
  tasksAll: ['tasks'] as const,

  coverageAll: ['coverage'] as const,

  dashboardHeader: ['dashboard', 'header'] as const,
  teamNow: ['dashboard', 'team-now'] as const,
  unattended: ['dashboard', 'unattended'] as const,
  needsAction: ['dashboard', 'needs-action'] as const,
  thisWeek: ['dashboard', 'this-week'] as const,
  dashboardAll: ['dashboard'] as const,

  // Stories studio: everything under ['stories'], so one invalidation of
  // studioAll refreshes the list, a story, its numbers and its viewers.
  studioAll: ['stories'] as const,
  studioStories: ['stories', 'list'] as const,
  studioStory: (id: string) => ['stories', 'one', id] as const,
  storyAnalytics: (id: string, tz: string) => ['stories', 'one', id, 'analytics', tz] as const,
  storyViewers: (id: string) => ['stories', 'one', id, 'viewers'] as const,
  storyAudienceFacts: ['stories', 'audience', 'facts'] as const,
  storyEstimateAll: ['stories', 'audience', 'estimate'] as const,
  storyEstimate: (key: string) => ['stories', 'audience', 'estimate', key] as const,
  storyFamiliesAll: ['stories', 'audience', 'families'] as const,
  storyFamilies: (filters: Record<string, unknown>) => ['stories', 'audience', 'families', filters] as const,
}
