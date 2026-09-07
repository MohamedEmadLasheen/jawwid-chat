import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  useFamily,
  useFamilyAssignments,
  useFamilyLabels,
  useFamilyLearners,
  useFamilyLifecycle,
  useFamilyLifecycleActions,
  useLearnerLifecycle,
} from './hooks'
import { TeacherPanel } from './TeacherPanel'
import { Badge } from '@/shared/components/Badge'
import { CurrentSection, HistoryRow, HistorySection, formatDate } from '@/shared/components/History'
import { ErrorState, LoadingState } from '@/shared/components/States'
import { familyIsActive } from '@/shared/types/directory'
import { useSession } from '@/core/auth/SessionProvider'
import { hasPermission } from '@/core/permissions/capabilities'

/**
 * ONE FAMILY -- profile, students, supervisor and labels.
 *
 * Current state and history are rendered in SEPARATE, LABELLED sections
 * throughout (CurrentSection / HistorySection). A former supervisor and a
 * former teacher both remain visible here, and neither is ever shown where the
 * current one belongs.
 */
export function FamilyDetailPage() {
  const { familyId = '' } = useParams()
  const { permissions } = useSession()
  const family = useFamily(familyId)
  const learners = useFamilyLearners(familyId)
  const assignments = useFamilyAssignments(familyId)
  const lifecycle = useFamilyLifecycle(familyId)
  const labels = useFamilyLabels(familyId)
  const actions = useFamilyLifecycleActions(familyId)
  const learnerActions = useLearnerLifecycle(familyId)

  const [reason, setReason] = useState('')
  const canManage = hasPermission(permissions, 'families.manage')

  if (family.isLoading) return <LoadingState />
  if (family.isError) return <ErrorState error={family.error} onRetry={() => void family.refetch()} />
  if (!family.data) return null

  const active = familyIsActive(family.data.state)
  const supervisors = assignments.data?.assignments ?? []
  const currentSupervisors = supervisors.filter((a) => a.endedAt === null)
  const formerSupervisors = supervisors.filter((a) => a.endedAt !== null)

  return (
    <div className="page">
      <header className="page__header">
        <h1>{family.data.displayName}</h1>
        <Badge tone={active ? 'ok' : 'neutral'}>{family.data.state}</Badge>
        {labels.data?.labels.map((l) => (
          <Badge key={l.id} tone="internal">
            {l.name}
          </Badge>
        ))}
      </header>

      {canManage && (
        <section className="panel">
          <h3 className="panel__title">Lifecycle</h3>
          <label className="field">
            Reason
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this changing?"
            />
          </label>
          {/* Two named operations. There is no control that sets an arbitrary
              state: at_risk and renewal_due belong to the frozen renewal
              machinery and are displayed but never offered. */}
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={!active || !reason.trim() || actions.deactivate.isPending}
              onClick={() => actions.deactivate.mutate({ reason, state: 'paused' })}
            >
              Pause family
            </button>
            <button
              type="button"
              className="button"
              disabled={!active || !reason.trim() || actions.deactivate.isPending}
              onClick={() => actions.deactivate.mutate({ reason, state: 'churned' })}
            >
              Mark churned
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={active || !reason.trim() || actions.activate.isPending}
              onClick={() => actions.activate.mutate(reason)}
            >
              Reactivate
            </button>
          </div>
          <p className="muted">
            Deactivating never deletes anything: students, supervisor, labels and conversations
            are all preserved, and the family can be reactivated.
          </p>
        </section>
      )}

      <CurrentSection title="Supervisor" empty="No current supervisor.">
        {currentSupervisors.map((a) => (
          <li key={a.id} className="list__row">
            <span className="list__primary">{a.staffName ?? a.staffId}</span>
            <Badge tone={a.kind === 'temporary' ? 'coverage' : 'ok'}>{a.kind}</Badge>
            <span className="muted">since {formatDate(a.startsAt)}</span>
          </li>
        ))}
      </CurrentSection>

      <HistorySection title="Previous supervisors" empty="No previous supervisor.">
        {formerSupervisors.map((a) => (
          <HistoryRow
            key={a.id}
            who={a.staffName ?? a.staffId}
            started={a.startsAt}
            ended={a.endedAt}
            reason={a.reason}
          />
        ))}
      </HistorySection>

      <section className="panel">
        <h3 className="panel__title">Students</h3>
        {learners.isLoading ? (
          <LoadingState />
        ) : (
          <ul className="list">
            {(learners.data?.learners ?? []).map((learner) => (
              <li key={learner.id} className="list__row list__row--stacked">
                <div>
                  <span className="list__primary">{learner.name}</span>
                  <Badge tone={learner.isActive ? 'ok' : 'neutral'}>
                    {learner.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  {learner.deactivatedAt && (
                    <span className="muted"> since {formatDate(learner.deactivatedAt)}</span>
                  )}
                </div>
                <TeacherPanel
                  learnerId={learner.id}
                  familyId={familyId}
                  canManage={hasPermission(permissions, 'learners.assign_teacher')}
                />
                {canManage && (
                  <div className="actions">
                    <button
                      type="button"
                      className="button"
                      disabled={!reason.trim()}
                      onClick={() =>
                        learner.isActive
                          ? learnerActions.deactivate.mutate({ id: learner.id, reason })
                          : learnerActions.activate.mutate({ id: learner.id, reason })
                      }
                    >
                      {learner.isActive ? 'Deactivate student' : 'Reactivate student'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <HistorySection title="Lifecycle history" empty="No lifecycle changes recorded.">
        {(lifecycle.data?.history ?? []).map((entry, i) => (
          <HistoryRow
            key={`${entry.at}-${i}`}
            who={`${entry.from ?? '—'} → ${entry.to ?? '—'}`}
            started={entry.at}
            ended={entry.at}
            reason={entry.reason}
          />
        ))}
      </HistorySection>
    </div>
  )
}
