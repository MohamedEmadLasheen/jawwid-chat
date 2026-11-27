import { useI18n } from '@/core/i18n/I18nProvider'
import type { StaffProfile, StaffSummary } from './api'
import { T, useCopy } from './copy'
import { useOrganization, useTeam } from './hooks'

/**
 * One bar: this person's assigned families against the people who report to
 * the same manager, with a gold marker at the team's average.
 *
 * The system records no capacity, so the bar's full length is the heaviest
 * load in the team, and the caption says so. It is drawn only for a viewer who
 * can already read the team (their manager, via /staff-profiles/team; the super
 * admin, via the organization directory); for anyone else, and for a team of
 * one, there is nothing to compare against and nothing is shown.
 */
export function LoadAgainstTeam({ profile }: { profile: StaffProfile }) {
  const tx = useCopy()
  const { number } = useI18n()
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

  const mine = profile.workload.assignedFamilies
  const loads = active.map((s) => (s.staffId === profile.staffId ? mine : s.workload.assignedFamilies))
  const heaviest = Math.max(...loads)
  if (heaviest === 0) return null
  const average = loads.reduce((a, b) => a + b, 0) / loads.length
  const share = Math.round((mine / heaviest) * 100)
  const averageAt = Math.min(100, (average / heaviest) * 100)
  const averageText = number(Math.round(average * 10) / 10)

  return (
    <section className="pp-sec sp-load" aria-labelledby="sp-load">
      <div className="pp-sec__head">
        <h2 id="sp-load" className="pp-sec__title">{tx(T.loadTitle)}</h2>
      </div>
      <p className="sp-load__line">
        <span className="numeral sp-load__n">{number(mine)}</span>
        <span>{tx(T.loadFamilies)}</span>
        <span className="sp-load__share">{tx(T.loadShare, { pct: number(share) })}</span>
      </p>
      {/* A scale reads from its start in both languages; it is a picture, described in the line above. */}
      <div className="sp-load__bar" aria-hidden="true">
        <span className="sp-load__fill" style={{ inlineSize: `${share}%` }} />
        <span className="sp-load__avg" style={{ insetInlineStart: `${averageAt}%` }} />
      </div>
      <p className="sp-load__legend">
        <span className="sp-load__key" aria-hidden="true" />
        <span>{tx(T.teamAverage, { n: averageText })}</span>
        <span>{tx(T.heaviest, { n: number(heaviest) })}</span>
      </p>
      <p className="pp-rule">{tx(T.peers, { n: number(active.length) })}</p>
    </section>
  )
}
