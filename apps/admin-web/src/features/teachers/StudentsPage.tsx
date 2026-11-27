import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ActionDialog } from './ActionDialog'
import { TeachersAreaTabs } from './area'
import type { Pair } from './copy'
import { opsApi, type SuspensionDto } from './opsApi'
import { O, SUSPENSION_REASON, describeOpsError, formatDay } from './opsCopy'
import { useOp, useSuspensions } from './opsHooks'
import './teachers.css'
import './rows.css'
import { Avatar } from '@/shared/components/Avatar'
import { RowActions } from '@/shared/components/RowActions'

type Kind = 'temporary' | 'permanent'

/**
 * The two lists the administration works from (PD-11): students paused until a
 * return date, and students who stopped, with their reasons. A pause can be
 * moved or ended early here; it also ends by itself on its date. "Package
 * left" is Core's (PD-10) and reads as such until Core publishes it.
 */
export function StudentsPage() {
  const tx = useTx()
  const { locale, number } = useI18n()
  const [kind, setKind] = useState<Kind>('temporary')
  const q = useSuspensions(kind, 'active')
  const end = useOp((id: string) => opsApi.endSuspension(id))
  const extend = useOp((v: { id: string; returnOn: string }) => opsApi.extendSuspension(v.id, v.returnOn))
  const [extending, setExtending] = useState<SuspensionDto | null>(null)
  const rows = q.data?.suspensions ?? []

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader
          title={tx(O.studentsTitle)}
          subtitle={tx(O.studentsSubtitle)}
          figures={q.data ? [{ key: 'n', label: tx(kind === 'temporary' ? O.pausedList : O.stoppedList), value: number(rows.length), tone: 'key' }] : undefined}
          tabs={<TeachersAreaTabs />}
        />
        <section className="sheet" aria-label={tx(O.studentsTitle)}>
          <div className="sheet-bar">
            <div className="chips" role="tablist" aria-label={tx(O.studentsTitle)}>
              {(['temporary', 'permanent'] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} className="chip" onClick={() => setKind(k)}>
                  {tx(k === 'temporary' ? O.pausedList : O.stoppedList)}
                </button>
              ))}
            </div>
          </div>
          <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
            {rows.length === 0 ? (
              <EmptyState title={tx(kind === 'temporary' ? O.nonePaused : O.noneStopped)} hint={tx(kind === 'temporary' ? O.nonePausedHint : O.noneStoppedHint)} />
            ) : (
              <table className="rowlist">
                <thead>
                  <tr>
                    <th scope="col">{tx(O.learner)}</th>
                    <th scope="col">{tx(O.reason)}</th>
                    <th scope="col">{tx(kind === 'temporary' ? O.returnOn : O.since)}</th>
                    <th scope="col">{tx(O.package)}</th>
                    <th scope="col">{tx(O.actions)}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <th scope="row" className="rw-who">
                        <Avatar name={s.learner.name} seed={s.learner.id} />
                        <span className="rw-who__text">
                          <span className="rw-name">
                            <bdi>{s.learner.name}</bdi>
                          </span>
                          <span className="rw-sub">
                            <bdi>{s.family?.displayName ?? '—'}</bdi> · {tx(O.teacher)}: <bdi>{s.teacher?.name ?? '—'}</bdi>
                          </span>
                        </span>
                      </th>
                      <td className="rw-meta">
                        <strong>{tx(SUSPENSION_REASON[s.reason] ?? { en: s.reason, ar: s.reason })}</strong>
                        {s.note && (
                          <div className="rw-sub" dir="auto">
                            {s.note}
                          </div>
                        )}
                      </td>
                      <td className="rw-dates">
                        {kind === 'temporary' && (
                          <span className="rw-date">
                            <span className="rw-fact__label">{tx(O.returnOn)}</span>
                            <span className="rw-date__v">{s.returnOn ? formatDay(s.returnOn, locale) : '—'}</span>
                          </span>
                        )}
                        <span className="rw-date">
                          <span className="rw-fact__label">{tx(O.since)}</span>
                          <span className="rw-date__v">{formatDay(s.startsOn, locale)}</span>
                        </span>
                      </td>
                      <td className="rw-meta">
                        <span className="rw-fact__label">{tx(O.package)}</span>
                        <div>{s.packageBalance ?? tx(O.packageUnknown)}</div>
                      </td>
                      <td className="cell-actions">
                        <RowActions
                          primary={
                            <button type="button" className="btn btn--sm" disabled={end.isPending} onClick={() => end.mutate(s.id)}>
                              {tx(O.endPause)}
                            </button>
                          }
                          more={kind === 'temporary' ? [{ key: 'extend', label: tx(O.extend), icon: 'calendar', onSelect: () => setExtending(s) }] : []}
                          label={`${tx(O.actions)}: ${s.learner.name}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {end.error && <div className="banner banner--danger" role="alert">{describeOpsError(end.error, locale)}</div>}
          </QueryBoundary>
        </section>
        {extending && (
          <ActionDialog
            title={`${tx(O.extend)} — ${extending.learner.name}`}
            fields={[{ key: 'returnOn', label: O.returnOn, type: 'date', required: true, initial: extending.returnOn ?? '' }]}
            onSubmit={(v) => extend.mutateAsync({ id: extending.id, returnOn: v('returnOn') })}
            onClose={() => setExtending(null)}
          />
        )}
      </div>
    </div>
  )
}

function useTx() {
  const { locale } = useI18n()
  return (p: Pair) => (locale === 'ar' ? p.ar : p.en)
}
