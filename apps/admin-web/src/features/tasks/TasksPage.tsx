import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { taskScopeFor, isDepartment } from '@/core/permissions/capabilities'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import { useTasks, useUpdateTask } from './hooks'

/**
 * Departments see only their own tasks; managers see the team; admins see
 * theirs. The scope is chosen from the role and enforced by the server.
 *
 * `?overdue=true` is a real entry point: the manager dashboard drills in here.
 */
export function TasksPage() {
  const { t, date } = useI18n()
  const { staff } = useSession()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [showOverdueOnly, setShowOverdueOnly] = useState(searchParams.get('overdue') === 'true')

  const scope = staff ? taskScopeFor(staff.role, staff.department) : 'mine'
  const query = useTasks({ scope, overdue: showOverdueOnly || undefined })
  const update = useUpdateTask()

  const isOverdue = (dueAt: string | null, status: string) =>
    Boolean(dueAt && status !== 'done' && status !== 'cancelled' && new Date(dueAt) < new Date())

  return (
    <div className="page">
      <h1 className="page__title">{scope === 'team' ? t('task.team') : t('task.mine')}</h1>

      <div className="card" style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="composer__tab"
          aria-pressed={!showOverdueOnly}
          onClick={() => setShowOverdueOnly(false)}
        >
          {t('nav.tasks')}
        </button>
        <button
          type="button"
          className="composer__tab"
          aria-pressed={showOverdueOnly}
          onClick={() => setShowOverdueOnly(true)}
        >
          {t('task.overdue')}
        </button>
      </div>

      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={query.tasks.length === 0}
        emptyTitle={t('task.empty')}
        onRetry={() => void query.refetch()}
      >
        <table className="table">
          <thead>
            <tr>
              <th>{t('action.task')}</th>
              <th>{t('nav.families')}</th>
              <th>{t('family.owner')}</th>
              <th>{t('task.due', { date: '' })}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.tasks.map((task) => {
              const overdue = isOverdue(task.due_at, task.status)
              return (
                <tr key={task.id}>
                  <td>
                    <strong>{task.title}</strong>
                    <div className="row__meta">
                      <Badge>{task.type}</Badge>
                      <Badge tone={task.status === 'done' ? 'ok' : 'neutral'}>{task.status}</Badge>
                      {overdue && <Badge tone="danger">{t('task.overdue')}</Badge>}
                    </div>
                  </td>
                  <td>
                    {/* Departments may not open family records (AI #5 matrix). */}
                    {staff && isDepartment(staff.role, staff.department) ? (
                      (task.family_name ?? '—')
                    ) : (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => navigate(`/inbox/${task.family_id}`)}
                      >
                        {task.family_name ?? task.family_id}
                      </button>
                    )}
                  </td>
                  <td>{task.owner_name ?? '—'}</td>
                  <td>{task.due_at ? date(task.due_at) : '—'}</td>
                  <td>
                    {task.status === 'done' ? (
                      <button
                        type="button"
                        className="btn btn--sm"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: task.id, patch: { status: 'open' } })}
                      >
                        {t('task.reopen')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: task.id, patch: { status: 'done' } })}
                      >
                        {t('task.complete')}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {query.hasNextPage && (
          <button
            type="button"
            className="btn"
            style={{ marginBlockStart: 12 }}
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('common.loadMore')}
          </button>
        )}
      </QueryBoundary>
    </div>
  )
}
