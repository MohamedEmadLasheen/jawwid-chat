import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { Icon } from '@/shared/components/Icon'
import { AssignSupervisorDialog } from '@/features/organization/OrgDialogs'
import { useStructure } from '@/features/organization/hooks'
import { NewFamilyGroupDialog } from '@/features/chat/NewFamilyGroupDialog'
import { EnrollmentDialog } from '@/features/journey/GroupChildren'
import { J } from '@/features/journey/copy'
import type { Pair } from '../teachers/copy'
import { trialKeys, type NewStudentDto } from './api'
import { TrialsAreaTabs } from './area'
import { TR, formatWhen } from './copy'
import { useNewStudents } from './hooks'
import '../teachers/teachers.css'
import '@/features/journey/journey.css'

type Setup = { kind: 'supervisor' | 'group' | 'details'; row: NewStudentDto }

/**
 * Operations' New Students page (PD-11 T4): subscriptions Core confirmed whose
 * student has no group yet -- the work -- and subscriptions Sales recorded that
 * Core has not confirmed -- information only. A student leaves the first list
 * when their group exists; the page has no "done" button to forget.
 *
 * PD-15: the setup is done from here, in order -- the Operations manager
 * assigns the responsible supervisor (audited, with a reason), the supervisor
 * creates the family's group with the parent and the teacher, and records the
 * child's details (age, course, package). Each step is decided by the server.
 */
export function NewStudentsPage() {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const q = useNewStudents()
  const qc = useQueryClient()
  const navigate = useNavigate()
  // Only a manager reads the structure; anyone else simply is not offered "Assign".
  const structure = useStructure()
  const supervisors = (structure.data?.departments ?? []).find((d) => d.kind === 'operations')?.members.filter((m) => m.position === 'supervisor') ?? []
  const canAssign = !structure.error && supervisors.length > 0
  const [setup, setSetup] = useState<Setup | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: trialKeys.newStudents })

  const setupCells = (r: NewStudentDto) => {
    if (!r.learner) return <td colSpan={3} className="ts-muted">—</td>
    return (
      <>
        <td>
          {r.supervisor ? (
            <span dir="auto">{r.supervisor.name}</span>
          ) : canAssign ? (
            <button type="button" className="btn btn--sm btn--primary" onClick={() => setSetup({ kind: 'supervisor', row: r })}>
              {tx(J.assign)}
            </button>
          ) : (
            <span className="ts-muted">{tx(J.needsSupervisorFirst)}</span>
          )}
        </td>
        <td>
          <button type="button" className="btn btn--sm" disabled={!r.supervisor} title={r.supervisor ? undefined : tx(J.needsSupervisorFirst)} onClick={() => setSetup({ kind: 'group', row: r })}>
            <Icon name="plus" size={14} />
            {tx(J.createGroup)}
          </button>
        </td>
        <td>
          <button type="button" className="btn btn--sm" onClick={() => setSetup({ kind: 'details', row: r })}>
            {r.hasDetails && <Icon name="check" size={14} />}
            {tx(J.details)}
          </button>
        </td>
      </>
    )
  }

  const table = (rows: NewStudentDto[], confirmed: boolean, withSetup = false) => (
    <div className="card card--flush">
      <div className="table-wrap">
        <table className="table ts-plain-rows">
          <thead>
            <tr>
              <th scope="col">{tx(TR.prospect)}</th>
              <th scope="col">{tx(TR.teacher)}</th>
              <th scope="col">{tx(TR.trialOn)}</th>
              <th scope="col">{tx(confirmed ? TR.confirmedOn : TR.recordedOn)}</th>
              {withSetup && (
                <>
                  <th scope="col">{tx(J.supervisor)}</th>
                  <th scope="col">{tx(J.group)}</th>
                  <th scope="col">{tx(J.details)}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.lessonId}>
                <th scope="row" dir="auto">{r.prospect.displayName}</th>
                <td>{r.teacher.name}</td>
                <td>{formatWhen(r.trialAt, locale)}</td>
                <td>{formatWhen((confirmed ? r.confirmedAt : r.recordedAt) ?? r.recordedAt, locale)}</td>
                {withSetup && setupCells(r)}
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
            {(q.data?.readyForSetup.length ?? 0) === 0 ? <EmptyState title={tx(TR.nothingReady)} /> : table(q.data!.readyForSetup, true, true)}
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
        {setup?.kind === 'supervisor' && setup.row.learner && (
          <AssignSupervisorDialog
            learner={{
              learnerId: setup.row.learner.id,
              name: setup.row.learner.name,
              family: { id: setup.row.learner.familyId, displayName: '' },
              teacher: setup.row.assignedTeacher ?? null,
              supervisor: setup.row.supervisor ?? null,
            }}
            supervisors={supervisors}
            onClose={() => {
              setSetup(null)
              refresh()
            }}
          />
        )}
        {setup?.kind === 'group' && setup.row.learner && (
          <NewFamilyGroupDialog
            initialFamilyId={setup.row.learner.familyId}
            initialLearnerIds={[setup.row.learner.id]}
            onClose={() => setSetup(null)}
            onCreated={(id) => {
              setSetup(null)
              refresh()
              navigate(`/chat/${id}`)
            }}
          />
        )}
        {setup?.kind === 'details' && setup.row.learner && (
          <EnrollmentDialog
            learner={{ id: setup.row.learner.id, name: setup.row.learner.name }}
            onClose={() => {
              setSetup(null)
              refresh()
            }}
          />
        )}
      </div>
    </div>
  )
}
