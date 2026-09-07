import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useGroup, useGroupActions, useGroupHistory, useGroupMembers, useGroupTeachers } from './hooks'
import { Badge } from '@/shared/components/Badge'
import { CurrentSection, HistoryRow, HistorySection, formatDate } from '@/shared/components/History'
import { ErrorState, LoadingState } from '@/shared/components/States'
import { splitCurrent } from '@/shared/types/directory'
import { useSession } from '@/core/auth/SessionProvider'
import { hasPermission } from '@/core/permissions/capabilities'

/**
 * ONE GROUP.
 *
 * The scenario this screen has to make legible is
 * `Ahmed + Islam → Islam leaves → Ahmed + Mahmoud`: Mahmoud under "Teachers /
 * Current", Islam under "Previous teachers" with the date he left. The same
 * split applies to members.
 *
 * An ARCHIVED group renders read-only. Every mutation control disappears, and
 * the database refuses the change anyway -- the UI simply stops offering what
 * cannot succeed.
 */
export function GroupDetailPage() {
  const { groupId = '' } = useParams()
  const group = useGroup(groupId)
  const members = useGroupMembers(groupId)
  const teachers = useGroupTeachers(groupId)
  const history = useGroupHistory(groupId)
  const actions = useGroupActions(groupId)
  const { permissions } = useSession()

  const [reason, setReason] = useState('')
  const [learnerId, setLearnerId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [replacementName, setReplacementName] = useState('')

  if (group.isLoading) return <LoadingState />
  if (group.isError) return <ErrorState error={group.error} onRetry={() => void group.refetch()} />
  if (!group.data) return null

  const archived = group.data.state === 'archived'
  const canManage = hasPermission(permissions, 'groups.manage') && !archived
  const m = splitCurrent(members.data?.members ?? [])
  const t = splitCurrent(teachers.data?.teachers ?? [])

  return (
    <div className="page">
      <header className="page__header">
        <h1>{group.data.name}</h1>
        <Badge tone={group.data.state === 'active' ? 'ok' : group.data.state === 'closed' ? 'today' : 'neutral'}>
          {group.data.state}
        </Badge>
        {/* The stable id is shown deliberately: it is what survives a rename,
            a roster change and archival, and it is what a replacement does NOT
            inherit. */}
        <code className="muted">{group.data.id}</code>
      </header>

      {archived && (
        <p className="banner">
          This group is archived. Its history is preserved and readable; it can no longer be
          changed.
          {group.data.replacedByGroupId && (
            <>
              {' '}
              <Link to={`/groups/${group.data.replacedByGroupId}`}>See the replacement group →</Link>
            </>
          )}
        </p>
      )}

      <CurrentSection title="Teachers" empty="No current teacher.">
        {t.current.map((row) => (
          <li key={row.id} className="list__row">
            <span className="list__primary">{row.teacherName ?? row.teacherId}</span>
            <span className="muted">since {formatDate(row.startedAt)}</span>
            {canManage && (
              <button
                type="button"
                className="button"
                disabled={!reason.trim()}
                onClick={() => actions.removeTeacher.mutate({ teacherId: row.teacherId, reason })}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </CurrentSection>

      <HistorySection title="Previous teachers" empty="No previous teacher.">
        {t.former.map((row) => (
          <HistoryRow
            key={row.id}
            who={row.teacherName ?? row.teacherId}
            started={row.startedAt}
            ended={row.endedAt}
            reason={row.removedReason}
          />
        ))}
      </HistorySection>

      <CurrentSection title="Students" empty="No current members.">
        {m.current.map((row) => (
          <li key={row.id} className="list__row">
            <span className="list__primary">{row.learnerName ?? row.learnerId}</span>
            <span className="muted">since {formatDate(row.joinedAt)}</span>
            {canManage && (
              <button
                type="button"
                className="button"
                disabled={!reason.trim()}
                onClick={() => actions.removeMember.mutate({ learnerId: row.learnerId, reason })}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </CurrentSection>

      <HistorySection title="Former students" empty="No former members.">
        {m.former.map((row) => (
          <HistoryRow
            key={row.id}
            who={row.learnerName ?? row.learnerId}
            started={row.joinedAt}
            ended={row.leftAt}
            reason={row.removedReason}
          />
        ))}
      </HistorySection>

      {canManage && (
        <section className="panel">
          <h3 className="panel__title">Manage</h3>
          <label className="field">
            Reason
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="inline-form">
            <input
              className="input"
              value={learnerId}
              onChange={(e) => setLearnerId(e.target.value)}
              placeholder="Student id"
              aria-label="Student id"
            />
            <button
              type="button"
              className="button"
              disabled={!learnerId.trim()}
              onClick={() => actions.addMember.mutate(learnerId)}
            >
              Add student
            </button>
          </div>
          <div className="inline-form">
            <input
              className="input"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              placeholder="Teacher id"
              aria-label="Teacher id"
            />
            <button
              type="button"
              className="button"
              disabled={!teacherId.trim()}
              onClick={() => actions.addTeacher.mutate(teacherId)}
            >
              Add teacher
            </button>
          </div>
          <div className="actions">
            {group.data.state === 'active' && (
              <button
                type="button"
                className="button"
                disabled={!reason.trim()}
                onClick={() => actions.close.mutate(reason)}
              >
                Close group
              </button>
            )}
            {group.data.state === 'closed' && (
              <button
                type="button"
                className="button"
                disabled={!reason.trim()}
                onClick={() => actions.archive.mutate(reason)}
              >
                Archive group
              </button>
            )}
          </div>
        </section>
      )}

      {hasPermission(permissions, 'groups.manage') && !group.data.replacedByGroupId && (
        <section className="panel">
          <h3 className="panel__title">Replacement</h3>
          <p className="muted">
            A replacement is a NEW group with its own id. This group keeps its id, its roster and
            its history.
          </p>
          <div className="inline-form">
            <input
              className="input"
              value={replacementName}
              onChange={(e) => setReplacementName(e.target.value)}
              placeholder="Replacement group name"
              aria-label="Replacement group name"
            />
            <button
              type="button"
              className="button"
              disabled={!reason.trim()}
              onClick={() => actions.replace.mutate({ name: replacementName, reason })}
            >
              Create replacement
            </button>
          </div>
        </section>
      )}

      <HistorySection title="Group history" empty="No history recorded.">
        {(history.data?.history ?? []).map((entry, i) => (
          <HistoryRow key={`${entry.at}-${i}`} who={entry.type} started={entry.at} ended={entry.at} />
        ))}
      </HistorySection>
    </div>
  )
}
