import { useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ActionDialog } from './ActionDialog'
import { TeachersAreaTabs } from './area'
import type { Pair } from './copy'
import { opsApi, type SuspensionDto } from './opsApi'
import { O, SUSPENSION_REASON, describeOpsError, fill, formatDay } from './opsCopy'
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
  // Both lists are read so both switches carry their count; the one shown is `q`.
  const paused = useSuspensions('temporary', 'active')
  const stopped = useSuspensions('permanent', 'active')
  const q = kind === 'temporary' ? paused : stopped
  const end = useOp((id: string) => opsApi.endSuspension(id))
  const extend = useOp((v: { id: string; returnOn: string }) => opsApi.extendSuspension(v.id, v.returnOn))
  const [extending, setExtending] = useState<SuspensionDto | null>(null)
  // Paused: the nearest return first (its schedule must be ready). Stopped: the latest first.
  const rows = useMemo(() => {
    const list = [...(q.data?.suspensions ?? [])]
    return kind === 'temporary'
      ? list.sort((a, b) => (a.returnOn ?? '9999').localeCompare(b.returnOn ?? '9999'))
      : list.sort((a, b) => b.startsOn.localeCompare(a.startsOn))
  }, [q.data, kind])
  const sep = locale === 'ar' ? '، ' : ', '
  // "Package left" is Core's (PD-10): until Core publishes it, it is said once for the list, not on every row.
  const packageKnown = rows.some((s) => s.packageBalance !== null)

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader
          title={tx(O.studentsTitle)}
          subtitle={tx(O.studentsSubtitle)}
          tabs={<TeachersAreaTabs />}
        />
        <section className="sheet" aria-label={tx(O.studentsTitle)}>
          <div className="sheet-bar">
            <div className="chips" role="tablist" aria-label={tx(O.studentsTitle)}>
              {(['temporary', 'permanent'] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} className="chip" onClick={() => setKind(k)}>
                  {tx(k === 'temporary' ? O.pausedList : O.stoppedList)}
                  {(k === 'temporary' ? paused : stopped).data && (
                    <span className="chip__count">{number((k === 'temporary' ? paused : stopped).data!.suspensions.length)}</span>
                  )}
                </button>
              ))}
            </div>
            {q.data && rows.length > 0 && !packageKnown && (
              <p className="sheet-bar__end st-package-note">
                {tx(O.package)}: <span>{tx(O.packageUnknown)}</span>
              </p>
            )}
          </div>
          <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
            {rows.length === 0 ? (
              <EmptyState title={tx(kind === 'temporary' ? O.nonePaused : O.noneStopped)} hint={tx(kind === 'temporary' ? O.nonePausedHint : O.noneStoppedHint)} />
            ) : (
              <table className="rowlist st-list">
                <thead>
                  <tr>
                    <th scope="col">{tx(O.learner)}</th>
                    <th scope="col">{tx(O.reason)}</th>
                    <th scope="col">{tx(kind === 'temporary' ? O.returnOn : O.since)}</th>
                    {packageKnown && <th scope="col">{tx(O.package)}</th>}
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
                            {s.family && (
                              <>
                                <bdi>{s.family.displayName}</bdi>
                                {sep}
                              </>
                            )}
                            {s.teacher ? (
                              <>
                                {tx(O.teacher)}: <bdi>{s.teacher.name}</bdi>
                              </>
                            ) : (
                              <span className="ts-gap">{tx(O.noTeacherYet)}</span>
                            )}
                          </span>
                        </span>
                      </th>
                      <td className="rw-meta">
                        <strong>{tx(SUSPENSION_REASON[s.reason] ?? { en: s.reason, ar: s.reason })}</strong>
                        {s.note && (
                          <div className="rw-sub st-note" dir="auto" title={s.note}>
                            {s.note}
                          </div>
                        )}
                      </td>
                      <td className="rw-dates">
                        {kind === 'temporary' && (
                          <span className="rw-date">
                            <span className="rw-fact__label">{tx(O.returnOn)}</span>
                            <span className="rw-date__v">{s.returnOn ? formatDay(s.returnOn, locale) : '—'}</span>
                            {s.returnOn && <ReturnsIn day={s.returnOn} />}
                          </span>
                        )}
                        <span className="rw-date">
                          <span className="rw-fact__label">{tx(O.since)}</span>
                          <span className="rw-date__v">{formatDay(s.startsOn, locale)}</span>
                        </span>
                      </td>
                      {packageKnown && (
                        <td className="rw-meta st-package">
                          <span className="rw-fact__label">{tx(O.package)}</span>
                          <div>{s.packageBalance ?? tx(O.packageUnknown)}</div>
                        </td>
                      )}
                      <td className="cell-actions">
                        {/* A pause states its one action; a stop is a record, its undoing kept behind "⋯". */}
                        <RowActions
                          primary={
                            kind === 'temporary' ? (
                              <button type="button" className="btn btn--sm" disabled={end.isPending} onClick={() => end.mutate(s.id)}>
                                {tx(O.endPause)}
                              </button>
                            ) : undefined
                          }
                          more={
                            kind === 'temporary'
                              ? [{ key: 'extend', label: tx(O.extend), icon: 'calendar', onSelect: () => setExtending(s) }]
                              : [{ key: 'end', label: tx(O.endStop), icon: 'undo', onSelect: () => end.mutate(s.id) }]
                          }
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

/** How near a return is: amber from two days out, when the family is told. */
function ReturnsIn({ day }: { day: string }) {
  const tx = useTx()
  const { number } = useI18n()
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - today) / 86_400_000)
  if (Number.isNaN(days) || days < 0) return null
  const text =
    days === 0 ? tx(O.returnsToday)
    : days === 1 ? tx(O.returnsTomorrow)
    : days === 2 ? tx(O.returnsTwo)
    : fill(tx(days > 10 ? O.returnsInMany : O.returnsIn), { n: number(days) })
  return <span className={days <= 2 ? 'st-soon st-soon--near' : 'st-soon'}>{text}</span>
}

function useTx() {
  const { locale } = useI18n()
  return (p: Pair) => (locale === 'ar' ? p.ar : p.en)
}
