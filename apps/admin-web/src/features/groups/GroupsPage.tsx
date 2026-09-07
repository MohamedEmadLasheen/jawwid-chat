import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCreateGroup, useGroups } from './hooks'
import { Badge } from '@/shared/components/Badge'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import { useSession } from '@/core/auth/SessionProvider'
import { hasPermission } from '@/core/permissions/capabilities'

export function GroupsPage() {
  const [includeArchived, setIncludeArchived] = useState(false)
  const [name, setName] = useState('')
  const groups = useGroups(includeArchived)
  const create = useCreateGroup()
  const { permissions } = useSession()
  const canManage = hasPermission(permissions, 'groups.manage')

  return (
    <div className="page">
      <header className="page__header">
        <h1>Groups</h1>
        <label className="chip">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />{' '}
          Show archived
        </label>
      </header>

      {canManage && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(name, { onSuccess: () => setName('') })
          }}
        >
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New group name"
            aria-label="New group name"
          />
          <button type="submit" className="button" disabled={!name.trim() || create.isPending}>
            Create group
          </button>
        </form>
      )}

      {groups.isLoading ? (
        <LoadingState />
      ) : groups.isError ? (
        <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
      ) : (groups.data?.groups.length ?? 0) === 0 ? (
        <EmptyState title="No groups yet." />
      ) : (
        <ul className="list">
          {groups.data!.groups.map((group) => (
            <li key={group.id} className="list__row">
              <Link to={`/groups/${group.id}`} className="list__primary">
                {group.name}
              </Link>
              <Badge tone={group.state === 'active' ? 'ok' : group.state === 'closed' ? 'today' : 'neutral'}>
                {group.state}
              </Badge>
              {group.replacedByGroupId && (
                <Link to={`/groups/${group.replacedByGroupId}`} className="muted">
                  replaced by →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
