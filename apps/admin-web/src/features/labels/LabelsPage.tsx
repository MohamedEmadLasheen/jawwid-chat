import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { familyApi, labelApi } from '@/core/api/directory'
import { qk } from '@/core/api/queryKeys'
import { Badge } from '@/shared/components/Badge'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import { useSession } from '@/core/auth/SessionProvider'
import { hasPermission } from '@/core/permissions/capabilities'
import type { BulkOutcome } from '@/shared/types/directory'

/**
 * LABELS -- the vocabulary, and bulk filing.
 *
 * The screen mirrors the permission split exactly: creating, renaming and
 * deleting a label need `labels.manage` (a manager's act, because the
 * vocabulary is shared), while adding or removing FAMILIES needs
 * `families.manage` and is narrowed to the operator's own families by the
 * server.
 *
 * A bulk result is shown PER FAMILY. A supervisor pasting a list of ids sees
 * exactly which were applied, which were already filed, and which were skipped
 * because they are not theirs -- rather than a single "done" that quietly did
 * less than it appears.
 */
export function LabelsPage() {
  const qc = useQueryClient()
  const { permissions } = useSession()
  const canCurate = hasPermission(permissions, 'labels.manage')
  const canFile = hasPermission(permissions, 'families.manage')

  const labels = useQuery({ queryKey: qk.labels, queryFn: () => labelApi.list() })
  const families = useQuery({
    queryKey: qk.directoryFamilies({}),
    queryFn: () => familyApi.list({}),
  })

  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [selectedLabel, setSelectedLabel] = useState<string>('')
  const [selectedFamilies, setSelectedFamilies] = useState<string[]>([])
  const [outcomes, setOutcomes] = useState<BulkOutcome[] | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.labels })
    void qc.invalidateQueries({ queryKey: qk.directory })
  }

  const create = useMutation({
    mutationFn: () => labelApi.create({ name }),
    onSuccess: () => {
      setName('')
      refresh()
    },
  })
  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      labelApi.update(input.id, { name: input.name }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => labelApi.remove(id, reason || 'no longer used'),
    onSuccess: refresh,
  })
  const bulkAdd = useMutation({
    mutationFn: () => labelApi.addFamilies(selectedLabel, selectedFamilies),
    onSuccess: (r) => {
      setOutcomes(r.outcomes)
      refresh()
    },
  })
  const bulkRemove = useMutation({
    mutationFn: () => labelApi.removeFamilies(selectedLabel, selectedFamilies),
    onSuccess: (r) => {
      setOutcomes(r.outcomes)
      refresh()
    },
  })

  const toggleFamily = (id: string) =>
    setSelectedFamilies((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  if (labels.isLoading) return <LoadingState />
  if (labels.isError) return <ErrorState error={labels.error} onRetry={() => void labels.refetch()} />

  return (
    <div className="page">
      <header className="page__header">
        <h1>Labels</h1>
      </header>

      {canCurate && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New label name"
            aria-label="New label name"
          />
          <button type="submit" className="button" disabled={!name.trim() || create.isPending}>
            Create label
          </button>
        </form>
      )}
      {create.isError && <p className="error">{(create.error as Error).message}</p>}

      {(labels.data?.labels.length ?? 0) === 0 ? (
        <EmptyState title="No labels yet." />
      ) : (
        <ul className="list">
          {labels.data!.labels.map((label) => (
            <li key={label.id} className="list__row">
              <span className="list__primary">{label.name}</span>
              <Badge tone="internal">{label.familyCount} families</Badge>
              {canCurate && (
                <>
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      const next = window.prompt('Rename label', label.name)
                      // Renaming keeps the label's identity: every family filed
                      // under it stays filed.
                      if (next && next.trim()) rename.mutate({ id: label.id, name: next.trim() })
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => remove.mutate(label.id)}
                    title="Deleting a label never deletes families, students or conversations"
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canFile && (
        <section className="panel">
          <h3 className="panel__title">Bulk apply</h3>
          <label className="field">
            Label
            <select
              className="input"
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
            >
              <option value="">Choose a label…</option>
              {labels.data!.labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="filters">
            <legend className="muted">Families (only those you supervise are listed)</legend>
            {(families.data?.families ?? []).map((f) => (
              <label key={f.id} className="chip">
                <input
                  type="checkbox"
                  checked={selectedFamilies.includes(f.id)}
                  onChange={() => toggleFamily(f.id)}
                />{' '}
                {f.displayName}
              </label>
            ))}
          </fieldset>

          <label className="field">
            Reason (for deletion)
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>

          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={!selectedLabel || selectedFamilies.length === 0 || bulkAdd.isPending}
              onClick={() => bulkAdd.mutate()}
            >
              Add {selectedFamilies.length} to label
            </button>
            <button
              type="button"
              className="button"
              disabled={!selectedLabel || selectedFamilies.length === 0 || bulkRemove.isPending}
              onClick={() => bulkRemove.mutate()}
            >
              Remove {selectedFamilies.length} from label
            </button>
          </div>

          {outcomes && (
            <ul className="list list--history">
              {outcomes.map((o) => (
                <li key={o.familyId} className="list__row">
                  <code className="muted">{o.familyId.slice(0, 8)}</code>
                  <Badge
                    tone={
                      o.status === 'applied' ? 'ok' : o.status === 'already' ? 'neutral' : 'danger'
                    }
                  >
                    {o.status.replace('_', ' ')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
