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

type Kind = 'temporary' | 'permanent'

/**
 * The two lists the administration works from (PD-11): students paused until a
 * return date, and students who stopped, with their reasons. A pause can be
 * moved or ended early here; it also ends by itself on its date. "Package
 * left" is Core's (PD-10) and reads as such until Core publishes it.
 */
export function StudentsPage() {
  const tx = useTx()
  const { locale } = useI18n()
  const [kind, setKind] = useState<Kind>('temporary')
  const q = useSuspensions(kind, 'active')
  const end = useOp((id: string) => opsApi.endSuspension(id))
  const extend = useOp((v: { id: string; returnOn: string }) => opsApi.extendSuspension(v.id, v.returnOn))
  const [extending, setExtending] = useState<SuspensionDto | null>(null)
  const rows = q.data?.suspensions ?? []

  return (
    <div className="page">
      <div className="page__inner">
        <TeachersAreaTabs />
        <PageHeader title={tx(O.studentsTitle)} subtitle={tx(O.studentsSubtitle)} />
        <div className="org-tabs" role="tablist" aria-label={tx(O.studentsTitle)}>
          {(['temporary', 'permanent'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className="org-tab" onClick={() => setKind(k)}>
              {tx(k === 'temporary' ? O.pausedList : O.stoppedList)}
            </button>
          ))}
        </div>
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          {rows.length === 0 ? (
            <EmptyState title={tx(O.noneList)} />
          ) : (
            <div className="card card--flush">
              <div className="table-wrap">
                <table className="table ts-plain-rows">
                  <thead>
                    <tr>
                      <th scope="col">{tx(O.learner)}</th>
                      <th scope="col">{tx(O.family)}</th>
                      <th scope="col">{tx(O.teacher)}</th>
                      <th scope="col">{tx(O.reason)}</th>
                      <th scope="col">{tx(O.since)}</th>
                      {kind === 'temporary' && <th scope="col">{tx(O.returnOn)}</th>}
                      <th scope="col">{tx(O.package)}</th>
                      <th scope="col">{tx(O.actions)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id}>
                        <th scope="row">{s.learner.name}</th>
                        <td>{s.family?.displayName ?? '—'}</td>
                        <td>{s.teacher?.name ?? '—'}</td>
                        <td>
                          {tx(SUSPENSION_REASON[s.reason] ?? { en: s.reason, ar: s.reason })}
                          {s.note && <div className="ts-muted" dir="auto">{s.note}</div>}
                        </td>
                        <td>{formatDay(s.startsOn, locale)}</td>
                        {kind === 'temporary' && <td>{s.returnOn ? formatDay(s.returnOn, locale) : '—'}</td>}
                        <td className="ts-muted">{s.packageBalance ?? tx(O.packageUnknown)}</td>
                        <td className="ts-actions-cell">
                          {kind === 'temporary' && (
                            <button type="button" className="btn btn--sm" onClick={() => setExtending(s)}>{tx(O.extend)}</button>
                          )}
                          <button type="button" className="btn btn--sm" disabled={end.isPending} onClick={() => end.mutate(s.id)}>
                            {tx(O.endPause)}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {end.error && <div className="banner banner--danger" role="alert">{describeOpsError(end.error, locale)}</div>}
        </QueryBoundary>
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
