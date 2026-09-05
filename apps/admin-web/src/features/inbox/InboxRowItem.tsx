import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, BucketDot, HandlingBadge, ResponseTargetBadge } from '@/shared/components/Badge'
import type { InboxRow } from '@/shared/types/domain'

/**
 * A row must let an operator understand the situation without opening it.
 * What it shows, and what it deliberately does not:
 *   - `top_reason` is server-supplied TEXT ("class started 5 minutes ago").
 *   - No attention score, no P1/P2/P3, no internal rule name.
 *   - No phone number anywhere.
 */
export function InboxRowItem({
  row,
  selected,
  onSelect,
}: {
  row: InboxRow
  selected: boolean
  onSelect: (familyId: string) => void
}) {
  const { t, duration, number } = useI18n()

  return (
    <button
      type="button"
      className="row"
      aria-current={selected}
      onClick={() => onSelect(row.family_id)}
    >
      <div className="row__top">
        <BucketDot bucket={row.bucket} />
        <span className="row__name">{row.display_name}</span>
        {row.waiting_since && (
          <span className="row__wait">{duration(row.waiting_since)}</span>
        )}
      </div>

      <div className="row__reason">{row.top_reason}</div>

      <div className="row__meta">
        <HandlingBadge mode={row.handling_mode} />
        {row.tier === 'priority' && <Badge tone="today">priority</Badge>}
        {row.state === 'at_risk' && <Badge tone="danger">at risk</Badge>}
        {row.state === 'renewal_due' && <Badge tone="today">renewal</Badge>}
        {row.open_case_count > 0 && (
          <Badge>{t('inbox.openCases', { count: number(row.open_case_count) })}</Badge>
        )}
        {row.response_target && (
          <ResponseTargetBadge
            elapsedPct={row.response_target.elapsed_pct}
            breached={row.response_target.breached}
          />
        )}
      </div>
    </button>
  )
}
