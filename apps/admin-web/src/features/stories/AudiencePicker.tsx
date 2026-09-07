import { useState } from 'react'
import type { AudienceClause, AudienceKind } from '@/core/api/phase5'
import { UNREFERENCED_AUDIENCE_KINDS } from '@/core/api/phase5'

/**
 * Compose an AUDIENCE, not a recipient list.
 *
 * The distinction is the whole design and it is visible in this component's
 * output type: it emits [AudienceClause]s -- "the Installments label", "the
 * Thursday group" -- and has no way to express "these 412 people". Resolving an
 * audience to people happens once, on the server, under the author's live
 * scope.
 *
 * That also means this picker CANNOT be a security control, and does not try to
 * be. An operator who hand-crafts a request naming a family they may not reach
 * gets the same refusal the picker would have prevented, because the refusal is
 * the server's.
 */
export function AudiencePicker({
  value,
  onChange,
  labels,
  groups,
  canTargetEveryone,
}: {
  value: AudienceClause[]
  onChange: (next: AudienceClause[]) => void
  labels: Array<{ id: string; name: string }>
  groups: Array<{ id: string; name: string }>
  /**
   * Whether this operator may target the whole academy.
   *
   * PRESENTATION ONLY. The server refuses `all_families` from anyone without an
   * organization-wide role, and hiding the option here just means an admin sees
   * "my families" instead of an option that would 403.
   */
  canTargetEveryone: boolean
}) {
  const [kind, setKind] = useState<AudienceKind>('assigned_families')
  const [refId, setRefId] = useState('')

  const needsRef = !UNREFERENCED_AUDIENCE_KINDS.includes(kind)

  const add = () => {
    if (needsRef && !refId) return
    const clause: AudienceClause = needsRef ? { kind, refId } : { kind }
    // Adding the same clause twice is the same audience. Deduplicated here so
    // the count shown is the count that will be delivered; the server's
    // composite key makes it true regardless.
    const already = value.some((c) => c.kind === clause.kind && c.refId === clause.refId)
    if (!already) onChange([...value, clause])
    setRefId('')
  }

  return (
    <div className="audience-picker">
      <div className="audience-picker__controls">
        <label>
          <span>Audience</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as AudienceKind)
              setRefId('')
            }}
          >
            <option value="assigned_families">My families</option>
            {canTargetEveryone && <option value="all_families">All families</option>}
            {canTargetEveryone && <option value="all_teachers">All teachers</option>}
            <option value="label">A label</option>
            <option value="group">A group</option>
          </select>
        </label>

        {kind === 'label' && (
          <label>
            <span>Label</span>
            <select value={refId} onChange={(e) => setRefId(e.target.value)}>
              <option value="">Choose…</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === 'group' && (
          <label>
            <span>Group</span>
            <select value={refId} onChange={(e) => setRefId(e.target.value)}>
              <option value="">Choose…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <button type="button" onClick={add} disabled={needsRef && !refId}>
          Add audience
        </button>
      </div>

      {/*
        Several clauses are the normal case, not an edge case: "Thursday
        families + the Installments label + the teachers" is the example the
        product was specified against.
      */}
      <ul className="audience-picker__chips" aria-label="Selected audiences">
        {value.map((clause, index) => (
          <li key={`${clause.kind}:${clause.refId ?? ''}`}>
            <span>{describe(clause, labels, groups)}</span>
            <button
              type="button"
              aria-label={`Remove ${describe(clause, labels, groups)}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </li>
        ))}
        {value.length === 0 && <li className="muted">No audience chosen yet.</li>}
      </ul>
    </div>
  )
}

export function describe(
  clause: AudienceClause,
  labels: Array<{ id: string; name: string }>,
  groups: Array<{ id: string; name: string }>,
): string {
  switch (clause.kind) {
    case 'all_families':
      return 'All families'
    case 'all_teachers':
      return 'All teachers'
    case 'assigned_families':
      return 'My families'
    case 'label':
      return `Label: ${labels.find((l) => l.id === clause.refId)?.name ?? clause.refId}`
    case 'group':
      return `Group: ${groups.find((g) => g.id === clause.refId)?.name ?? clause.refId}`
    default:
      return `${clause.kind}: ${clause.refId ?? ''}`
  }
}
