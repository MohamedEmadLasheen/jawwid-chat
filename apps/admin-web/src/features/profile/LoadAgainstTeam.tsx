import { useI18n } from '@/core/i18n/I18nProvider'
import type { ReactNode } from 'react'
import type { StaffProfile, StaffSummary } from './api'
import { T, useCopy } from './copy'
import { useOrganization, useTeam } from './hooks'

/**
 * This person's assigned families against the people who report to the same
 * manager, as one quiet line for the families highlight: the team's average and
 * its heaviest load. The system records no capacity. Drawn only for a viewer who
 * can already read the team; null where there is nothing to compare against.
 */
export function useTeamLoadNote(profile: StaffProfile): ReactNode {
  const tx = useCopy()
  const { number, locale } = useI18n()
  const relation = profile.access.relation
  const team = useTeam(relation === 'team')
  const organization = useOrganization(relation === 'organization' && profile.viewer.organizationOverview)
  const managerId = profile.reportingManager?.staffId
  const peers: StaffSummary[] =
    relation === 'team'
      ? (team.data?.members ?? [])
      : relation === 'organization' && managerId
        ? (organization.data?.directory ?? []).filter((s) => s.reportingManager?.staffId === managerId)
        : []
  const active = peers.filter((s) => s.isActive)
  if (active.length < 2 || !active.some((s) => s.staffId === profile.staffId)) return null
  const loads = active.map((s) => (s.staffId === profile.staffId ? profile.workload.assignedFamilies : s.workload.assignedFamilies))
  const heaviest = Math.max(...loads)
  if (heaviest === 0) return null
  const average = Math.round((loads.reduce((a, b) => a + b, 0) / loads.length) * 10) / 10
  return `${tx(T.teamAverage, { n: number(average) })}${locale === 'ar' ? '، ' : ', '}${tx(T.heaviest, { n: number(heaviest) })}`
}
