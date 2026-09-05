import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import {
  useAbsences,
  useActivateBackup,
  useCoverageGaps,
  useCoverageRules,
  useCoverageTonight,
  useDeleteRule,
  useDeleteShift,
  useShifts,
} from './hooks'

const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function days(list: number[]): string {
  return list.map((day) => DAY_KEYS[day] ?? String(day)).join(' ')
}

/**
 * Manager coverage configuration.
 *
 * Nothing here is hardcoded: shifts, rules, absences and the resulting duty
 * chain all come from the backend's config tables. The brief's initial setup
 * (owners 09:00-17:00, a covering admin on Friday, and so on) is seed data the
 * manager edits here — not a constant in this file.
 *
 * Overlap and conflict validation is the server's job; a 409 surfaces here.
 */
export function CoveragePage() {
  const { t, date } = useI18n()

  const tonight = useCoverageTonight()
  const gaps = useCoverageGaps(7)
  const shifts = useShifts()
  const rules = useCoverageRules()
  const absences = useAbsences()

  const deleteShift = useDeleteShift()
  const deleteRule = useDeleteRule()
  const activateBackup = useActivateBackup()

  return (
    <div className="page">
      <h1 className="page__title">{t('nav.coverage')}</h1>

      <section className="card">
        <h2 className="panel__title">{t('coverage.tonight')}</h2>
        <QueryBoundary
          isLoading={tonight.isLoading}
          error={tonight.error}
          isEmpty={(tonight.data ?? []).length === 0}
          emptyTitle={t('coverage.noGaps')}
          onRetry={() => void tonight.refetch()}
        >
          {(tonight.data ?? []).map((entry, index) => (
            <div className="kv" key={`${entry.covering_id}-${index}`}>
              <span className="kv__k">{entry.covered_name ?? t('coverage.allOwners')}</span>
              <span className="kv__v">→ {entry.covering_name}</span>
            </div>
          ))}
        </QueryBoundary>
      </section>

      <section className="card">
        <h2 className="panel__title">{t('coverage.gaps')}</h2>
        <QueryBoundary
          isLoading={gaps.isLoading}
          error={gaps.error}
          isEmpty={(gaps.data ?? []).length === 0}
          emptyTitle={t('coverage.noGaps')}
          onRetry={() => void gaps.refetch()}
        >
          {(gaps.data ?? []).map((gap, index) => (
            <div className="kv" key={index}>
              <span className="kv__k">
                <Badge tone="danger">{gap.kind}</Badge> {gap.description}
              </span>
              <span className="kv__v">
                {date(gap.starts_at)} → {date(gap.ends_at)}
              </span>
            </div>
          ))}
        </QueryBoundary>
      </section>

      <section className="card">
        <h2 className="panel__title">{t('coverage.schedule')}</h2>
        <QueryBoundary
          isLoading={shifts.isLoading}
          error={shifts.error}
          isEmpty={(shifts.data ?? []).length === 0}
          emptyTitle={t('common.none')}
          onRetry={() => void shifts.refetch()}
        >
          <table className="table">
            <thead>
              <tr>
                <th>{t('family.owner')}</th>
                <th>{t('coverage.schedule')}</th>
                <th>{t('coverage.tonight')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(shifts.data ?? []).map((shift) => (
                <tr key={shift.id}>
                  <td>{shift.staff_name ?? shift.staff_id}</td>
                  <td>{days(shift.days)}</td>
                  <td>{shift.starts} – {shift.ends}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={deleteShift.isPending}
                      onClick={() => deleteShift.mutate(shift.id)}
                    >
                      {t('common.cancel')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </QueryBoundary>
      </section>

      <section className="card">
        <h2 className="panel__title">{t('coverage.rules')}</h2>
        <QueryBoundary
          isLoading={rules.isLoading}
          error={rules.error}
          isEmpty={(rules.data ?? []).length === 0}
          emptyTitle={t('common.none')}
          onRetry={() => void rules.refetch()}
        >
          <table className="table">
            <thead>
              <tr>
                <th>covering</th>
                <th>covers</th>
                <th>{t('coverage.schedule')}</th>
                <th>window</th>
                <th className="num">priority</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(rules.data ?? []).map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.covering_name ?? rule.covering_id}</td>
                  <td>{rule.covered_name ?? t('coverage.allOwners')}</td>
                  <td>{days(rule.days)}</td>
                  <td>
                    {rule.window === 'custom'
                      ? `${rule.custom_from ?? ''} – ${rule.custom_to ?? ''}`
                      : rule.window}
                  </td>
                  <td className="num">{rule.priority}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={deleteRule.isPending}
                      onClick={() => deleteRule.mutate(rule.id)}
                    >
                      {t('common.cancel')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </QueryBoundary>
      </section>

      <section className="card">
        <h2 className="panel__title">{t('coverage.absences')}</h2>
        <QueryBoundary
          isLoading={absences.isLoading}
          error={absences.error}
          isEmpty={(absences.data ?? []).length === 0}
          emptyTitle={t('common.none')}
          onRetry={() => void absences.refetch()}
        >
          <table className="table">
            <thead>
              <tr>
                <th>{t('family.owner')}</th>
                <th>from</th>
                <th>to</th>
                <th>backup</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(absences.data ?? []).map((absence) => (
                <tr key={absence.id}>
                  <td>
                    {absence.staff_name ?? absence.staff_id}{' '}
                    {absence.type === 'auto_detected' && <Badge tone="today">{absence.type}</Badge>}
                  </td>
                  <td>{date(absence.from)}</td>
                  <td>{date(absence.to)}</td>
                  <td>{absence.backup_name ?? <Badge tone="danger">{t('common.none')}</Badge>}</td>
                  <td>
                    {absence.backup_id && (
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        disabled={activateBackup.isPending}
                        onClick={() => activateBackup.mutate(absence.id)}
                      >
                        {t('coverage.activateBackup')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </QueryBoundary>
      </section>
    </div>
  )
}
