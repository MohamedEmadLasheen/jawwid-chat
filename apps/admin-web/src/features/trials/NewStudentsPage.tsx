import { useI18n } from '@/core/i18n/I18nProvider'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Pair } from '../teachers/copy'
import type { NewStudentDto } from './api'
import { TrialsAreaTabs } from './area'
import { TR, formatWhen } from './copy'
import { useNewStudents } from './hooks'
import '../teachers/teachers.css'

/**
 * Operations' New Students page (PD-11 T4): subscriptions Core confirmed whose
 * student has no group yet -- the work -- and subscriptions Sales recorded that
 * Core has not confirmed -- information only. A student leaves the first list
 * when their group exists; the page has no "done" button to forget.
 */
export function NewStudentsPage() {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const q = useNewStudents()

  const table = (rows: NewStudentDto[], confirmed: boolean) => (
    <div className="card card--flush">
      <div className="table-wrap">
        <table className="table ts-plain-rows">
          <thead>
            <tr>
              <th scope="col">{tx(TR.prospect)}</th>
              <th scope="col">{tx(TR.teacher)}</th>
              <th scope="col">{tx(TR.trialOn)}</th>
              <th scope="col">{tx(confirmed ? TR.confirmedOn : TR.recordedOn)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.lessonId}>
                <th scope="row" dir="auto">{r.prospect.displayName}</th>
                <td>{r.teacher.name}</td>
                <td>{formatWhen(r.trialAt, locale)}</td>
                <td>{formatWhen((confirmed ? r.confirmedAt : r.recordedAt) ?? r.recordedAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="page">
      <div className="page__inner">
        <TrialsAreaTabs />
        <PageHeader title={tx(TR.newTitle)} subtitle={tx(TR.newSubtitle)} />
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          <section className="ts-section" aria-labelledby="ns-ready">
            <h2 id="ns-ready" className="ts-subtitle ts-section__head">
              {tx(TR.ready)} <span className="badge">{q.data?.readyForSetup.length ?? 0}</span>
            </h2>
            <p className="ts-muted ts-section__hint">{tx(TR.readyHint)}</p>
            {(q.data?.readyForSetup.length ?? 0) === 0 ? <EmptyState title={tx(TR.nothingReady)} /> : table(q.data!.readyForSetup, true)}
          </section>
          <section className="ts-section" aria-labelledby="ns-student">
            <h2 id="ns-student" className="ts-subtitle ts-section__head">
              {tx(TR.awaitingStudent)} <span className="badge">{q.data?.awaitingStudent?.length ?? 0}</span>
            </h2>
            <p className="ts-muted ts-section__hint">{tx(TR.awaitingStudentHint)}</p>
            {(q.data?.awaitingStudent?.length ?? 0) === 0 ? (
              <EmptyState title={tx(TR.nothingAwaitingStudent)} />
            ) : (
              table(q.data!.awaitingStudent!, true)
            )}
          </section>
          <section className="ts-section" aria-labelledby="ns-core">
            <h2 id="ns-core" className="ts-subtitle ts-section__head">
              {tx(TR.awaitingCore)} <span className="badge">{q.data?.awaitingCore.length ?? 0}</span>
            </h2>
            <p className="ts-muted ts-section__hint">{tx(TR.awaitingCoreHint)}</p>
            {(q.data?.awaitingCore.length ?? 0) === 0 ? <EmptyState title={tx(TR.nothingAwaiting)} /> : table(q.data!.awaitingCore, false)}
          </section>
        </QueryBoundary>
      </div>
    </div>
  )
}
