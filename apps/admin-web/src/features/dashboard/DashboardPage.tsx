import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { Badge, WorkloadBadge } from '@/shared/components/Badge'
import { useActivateBackup } from '@/features/coverage/hooks'

/**
 * Every tile is a link into the list it summarises. A dashboard that only shows
 * numbers is explicitly rejected (role brief §78) — the manager's job is to act
 * on what she sees, not to read it and then go hunting.
 */
function Metric({
  value,
  label,
  alert,
  onClick,
}: {
  value: string
  label: string
  alert?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className={alert ? 'metric metric--alert' : 'metric'}
      onClick={onClick}
      disabled={!onClick}
    >
      <div className="metric__value">{value}</div>
      <div className="metric__label">{label}</div>
    </button>
  )
}

export function DashboardPage() {
  const { t, number } = useI18n()
  const navigate = useNavigate()

  const header = useQuery({ queryKey: qk.dashboardHeader, queryFn: () => dashboardApi.header() })
  const teamNow = useQuery({ queryKey: qk.teamNow, queryFn: () => dashboardApi.teamNow() })
  const needsAction = useQuery({ queryKey: qk.needsAction, queryFn: () => dashboardApi.needsAction() })
  const thisWeek = useQuery({ queryKey: qk.thisWeek, queryFn: () => dashboardApi.thisWeek() })
  const activateBackup = useActivateBackup()

  const unattended = header.data?.unattended_count ?? 0

  return (
    <div className="page">
      <h1 className="page__title">{t('nav.dashboard')}</h1>

      <div className="grid grid--metrics" style={{ marginBlockEnd: 'var(--space-4)' }}>
        <Metric
          value={number(unattended)}
          label={t('dashboard.unattended')}
          alert={unattended > 0}
          onClick={() => navigate('/families?bucket=now')}
        />
        <Metric
          value={number(header.data?.open_escalations ?? 0)}
          label={t('dashboard.escalations')}
        />
      </div>

      {/* The target is zero, so zero deserves to be said out loud. */}
      {header.data && unattended === 0 && (
        <div className="banner banner--info">{t('dashboard.unattendedZero')}</div>
      )}

      <section className="card">
        <h2 className="panel__title">{t('dashboard.teamNow')}</h2>
        <QueryBoundary
          isLoading={teamNow.isLoading}
          error={teamNow.error}
          isEmpty={(teamNow.data ?? []).length === 0}
          emptyTitle={t('common.none')}
          onRetry={() => void teamNow.refetch()}
        >
          <table className="table">
            <thead>
              <tr>
                <th>{t('family.owner')}</th>
                <th>presence</th>
                <th className="num">{t('bucket.now')}</th>
                <th className="num">{t('bucket.today')}</th>
                <th className="num">late</th>
                <th>{t('dashboard.workload')}</th>
              </tr>
            </thead>
            <tbody>
              {(teamNow.data ?? []).map((row) => (
                <tr key={row.staff_id}>
                  <td>
                    {row.name}{' '}
                    {row.inactivity_warning && <Badge tone="danger">inactive</Badge>}
                  </td>
                  <td><Badge tone={row.presence === 'online' ? 'ok' : 'neutral'}>{row.presence}</Badge></td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/families?bucket=now&owner_id=${row.staff_id}`)}
                    >
                      {number(row.now_count)}
                    </button>
                  </td>
                  <td className="num">{number(row.today_count)}</td>
                  <td className="num">{number(row.late_replies)}</td>
                  <td>
                    {/* Score and level are both server-computed (brief §7). */}
                    <WorkloadBadge level={row.workload_level} score={row.workload_score} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </QueryBoundary>
      </section>

      <section className="card">
        <h2 className="panel__title">{t('dashboard.needsAction')}</h2>
        <QueryBoundary
          isLoading={needsAction.isLoading}
          error={needsAction.error}
          isEmpty={(needsAction.data ?? []).length === 0}
          emptyTitle={t('dashboard.unattendedZero')}
          onRetry={() => void needsAction.refetch()}
        >
          {(needsAction.data ?? []).map((item, index) => (
            <div className="kv" key={index}>
              <span className="kv__k">
                <Badge tone="danger">{item.kind}</Badge> {item.description}
              </span>
              <span className="kv__v">
                {item.family_id && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => navigate(`/inbox/${item.family_id}`)}
                  >
                    {item.family_name ?? item.family_id}
                  </button>
                )}
                {item.kind === 'auto_detected_absence' && item.absence_id && (
                  <button
                    type="button"
                    className="btn btn--sm btn--primary"
                    disabled={activateBackup.isPending}
                    onClick={() => activateBackup.mutate(item.absence_id!)}
                  >
                    {t('coverage.activateBackup')}
                  </button>
                )}
              </span>
            </div>
          ))}
        </QueryBoundary>
      </section>

      <section className="card">
        <h2 className="panel__title">{t('dashboard.thisWeek')}</h2>
        <QueryBoundary
          isLoading={thisWeek.isLoading}
          error={thisWeek.error}
          onRetry={() => void thisWeek.refetch()}
        >
          {thisWeek.data && (
            <>
              <div className="grid grid--metrics">
                <Metric value={number(thisWeek.data.renewals.due)} label="renewals due" />
                <Metric value={number(thisWeek.data.renewals.renewed)} label="renewed" />
                <Metric value={number(thisWeek.data.renewals.no_reply)} label="no reply" />
                <Metric value={number(thisWeek.data.renewals.refused)} label="refused" />
                <Metric
                  value={`${number(thisWeek.data.target_compliance_pct)}%`}
                  label="response target compliance"
                />
              </div>

              {thisWeek.data.at_risk.length > 0 && (
                <div style={{ marginBlockStart: 'var(--space-4)' }}>
                  {thisWeek.data.at_risk.map((entry) => (
                    <div className="kv" key={entry.reason}>
                      <span className="kv__k">{entry.reason}</span>
                      <span className="kv__v">{number(entry.count)}</span>
                    </div>
                  ))}
                </div>
              )}

              {thisWeek.data.median_first_reply_by_shift.length > 0 && (
                <table className="table" style={{ marginBlockStart: 'var(--space-4)' }}>
                  <thead>
                    <tr>
                      <th>shift</th>
                      <th className="num">median first reply (min)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {thisWeek.data.median_first_reply_by_shift.map((entry) => (
                      <tr key={entry.shift}>
                        <td>{entry.shift}</td>
                        <td className="num">{number(entry.median_minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </QueryBoundary>
      </section>
    </div>
  )
}
