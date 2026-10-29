import { api } from '@/core/api/client'

/**
 * PD-44: GET /dashboard/<section> (apps/api src/dashboard). Each section is
 * counted by the service that owns the page its tiles link to, under that
 * page's scope; a tile the caller is not covered for is left out of `tiles`.
 */
export interface DashboardTile {
  key: string
  count: number
  /** The oldest item behind the count, or null. */
  oldestAt: string | null
  /** The count is a lower bound. */
  capped: boolean
}

export interface DashboardSection {
  generatedAt: string
  tiles: DashboardTile[]
}

export type DashboardSectionKey = 'chats' | 'cases' | 'lessons' | 'enrolment' | 'teachers' | 'tasks'

export const dashboardApi = {
  section: (key: DashboardSectionKey) => api.get<DashboardSection>(`/dashboard/${key}`),
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
  section: (key: DashboardSectionKey) => ['dashboard', key] as const,
}
