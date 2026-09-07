import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFamilies, useLabels } from './hooks'
import { Badge } from '@/shared/components/Badge'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import { useDebounced } from '@/shared/hooks/useDebounced'
import { familyIsActive } from '@/shared/types/directory'

/**
 * THE FAMILY DIRECTORY -- list, search and label filter in one scoped query.
 *
 * Search and label filtering both NARROW a set the server has already scoped to
 * this operator. Neither can widen it, so a supervisor filtering by "VIP" sees
 * their own VIP families and gets the same empty result for a family they do
 * not supervise whether or not it exists.
 *
 * Selecting several labels INTERSECTS them, which is the "VIP + Renewal" case
 * from the requirement. The intersection is computed by the database, not here.
 */
export function DirectoryPage() {
  const [term, setTerm] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [activeOnly, setActiveOnly] = useState(false)
  const q = useDebounced(term, 250)

  const labels = useLabels()
  const filters = useMemo(
    () => ({ q: q || undefined, label: selected, activeOnly }),
    [q, selected, activeOnly],
  )
  const families = useFamilies(filters)

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className="page">
      <header className="page__header">
        <h1>Families</h1>
        <input
          className="input"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search families"
          aria-label="Search families"
        />
      </header>

      <div className="filters" role="group" aria-label="Filter by label">
        {(labels.data?.labels ?? []).map((label) => (
          <button
            key={label.id}
            type="button"
            className={selected.includes(label.id) ? 'chip chip--on' : 'chip'}
            aria-pressed={selected.includes(label.id)}
            onClick={() => toggle(label.id)}
          >
            {label.name}
            <span className="muted"> · {label.familyCount}</span>
          </button>
        ))}
        <label className="chip">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />{' '}
          Active only
        </label>
      </div>

      {selected.length > 1 && (
        <p className="muted">
          Showing families carrying <strong>all {selected.length}</strong> selected labels.
        </p>
      )}

      {families.isLoading ? (
        <LoadingState />
      ) : families.isError ? (
        <ErrorState error={families.error} onRetry={() => void families.refetch()} />
      ) : (families.data?.families.length ?? 0) === 0 ? (
        <EmptyState title="No families match these filters." />
      ) : (
        <ul className="list">
          {families.data!.families.map((family) => (
            <li key={family.id} className="list__row">
              <Link to={`/directory/${family.id}`} className="list__primary">
                {family.displayName}
              </Link>
              {/* The stored state is always shown, including the frozen
                  renewal states, which are readable but never settable here. */}
              <Badge tone={familyIsActive(family.state) ? 'ok' : 'neutral'}>{family.state}</Badge>
              <span className="muted">{family.supervisorName ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
