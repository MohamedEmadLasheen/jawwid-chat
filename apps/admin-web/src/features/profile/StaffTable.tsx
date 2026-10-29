import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { RESPONSIBILITY_CATEGORIES, type StaffSummary } from './api'
import { CATEGORY_LABEL, MISSING_LABEL, ROLE_LABEL, T, labelFor, useCopy } from './copy'
import { StaffAvatar } from './StaffAvatar'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

type StatusFilter = 'all' | 'active' | 'inactive' | 'incomplete'

/**
 * The searchable list behind "My team" (a manager) and the "Team directory"
 * (the super admin). Filtering is client-side over rows the server already
 * decided this viewer may see -- it narrows, it never widens.
 *
 * Rows, not a <table>: on a phone each person becomes a stacked card instead
 * of a table that scrolls sideways.
 */
export function StaffTable({ rows, showManager }: { rows: StaffSummary[]; showManager: boolean }) {
  const tx = useCopy()
  const { number, date } = useI18n()
  const ids = { q: useId(), status: useId(), role: useId(), manager: useId(), cat: useId() }
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [role, setRole] = useState('')
  const [manager, setManager] = useState('')
  const [category, setCategory] = useState('')

  const roles = useMemo(() => [...new Set(rows.map((r) => r.role))].sort(), [rows])
  const managers = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) if (r.reportingManager) map.set(r.reportingManager.staffId, r.reportingManager.displayName)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const visible = rows.filter((r) => {
    const q = query.trim().toLocaleLowerCase()
    if (q && !`${r.displayName} ${r.jobTitle ?? ''}`.toLocaleLowerCase().includes(q)) return false
    if (status === 'active' && !r.isActive) return false
    if (status === 'inactive' && r.isActive) return false
    if (status === 'incomplete' && r.completeness.missing.length === 0) return false
    if (role && r.role !== role) return false
    if (manager === '__none' && r.reportingManager) return false
    if (manager && manager !== '__none' && r.reportingManager?.staffId !== manager) return false
    if (category && !r.responsibilities.includes(category)) return false
    return true
  })

  return (
    <div className="sp-table">
      <div className="sp-filters" role="search">
        <label className="sp-filter sp-filter--grow" htmlFor={ids.q}>
          <span className="sr-only">{tx(T.search)}</span>
          <input
            id={ids.q}
            className="input"
            type="search"
            placeholder={tx(T.search)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            dir="auto"
          />
        </label>
        <label className="sp-filter" htmlFor={ids.status}>
          <span className="sr-only">{tx(T.status)}</span>
          <SearchableSelect id={ids.status} className="select" value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <option value="all">{tx(T.filterAll)}</option>
            <option value="active">{tx(T.filterActive)}</option>
            <option value="inactive">{tx(T.filterInactive)}</option>
            <option value="incomplete">{tx(T.filterIncomplete)}</option>
          </SearchableSelect>
        </label>
        {roles.length > 1 && (
          <label className="sp-filter" htmlFor={ids.role}>
            <span className="sr-only">{tx(T.filterRole)}</span>
            <SearchableSelect id={ids.role} className="select" value={role} onValueChange={(v) => setRole(v)}>
              <option value="">{tx(T.filterRole)}: {tx(T.anyOption)}</option>
              {roles.map((r) => (
                <option key={r} value={r}>{tx(ROLE_LABEL[r] ?? { en: r, ar: r })}</option>
              ))}
            </SearchableSelect>
          </label>
        )}
        {showManager && (
          <label className="sp-filter" htmlFor={ids.manager}>
            <span className="sr-only">{tx(T.filterManager)}</span>
            <SearchableSelect id={ids.manager} className="select" value={manager} onValueChange={(v) => setManager(v)}>
              <option value="">{tx(T.filterManager)}: {tx(T.anyOption)}</option>
              <option value="__none">{tx(T.unassignedOption)}</option>
              {managers.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </SearchableSelect>
          </label>
        )}
        <label className="sp-filter" htmlFor={ids.cat}>
          <span className="sr-only">{tx(T.filterCategory)}</span>
          <SearchableSelect id={ids.cat} className="select" value={category} onValueChange={(v) => setCategory(v)}>
            <option value="">{tx(T.filterCategory)}: {tx(T.anyOption)}</option>
            {RESPONSIBILITY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{tx(labelFor(CATEGORY_LABEL, c))}</option>
            ))}
          </SearchableSelect>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="sp-muted">{tx(T.noMatches)}</p>
      ) : (
        <ul className="sp-rows">
          {visible.map((r) => (
            <li key={r.staffId} className="sp-row">
              <div className="sp-row__who">
                <StaffAvatar name={r.displayName} url={r.avatarUrl} size={40} />
                <div className="sp-row__names">
                  <Link to={`/profile/${r.staffId}`} className="sp-row__link">{r.displayName}</Link>
                  <div className="sp-muted sp-small">
                    {r.jobTitle ?? tx(ROLE_LABEL[r.role] ?? { en: r.role, ar: r.role })}
                  </div>
                  <div className="sp-chips">
                    <span className="badge">{tx(ROLE_LABEL[r.role] ?? { en: r.role, ar: r.role })}</span>
                    {!r.isActive && <span className="badge badge--danger">{tx(T.inactive)}</span>}
                    {r.access.canEditProfessional || r.access.canManageResponsibilities ? (
                      <span className="badge badge--ok">{tx(T.canEditBadge)}</span>
                    ) : (
                      <span className="badge">{tx(T.viewOnlyBadge)}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="sp-row__resp">
                {r.responsibilities.length === 0 ? (
                  <span className="sp-muted sp-small">{tx(T.noResponsibilities)}</span>
                ) : (
                  r.responsibilities.map((c) => (
                    <span key={c} className="badge badge--coverage">{tx(CATEGORY_LABEL[c] ?? { en: c, ar: c })}</span>
                  ))
                )}
                {showManager && (
                  <div className="sp-small sp-muted">
                    {tx(T.colManager)}: {r.reportingManager?.displayName ?? tx(T.unassignedOption)}
                  </div>
                )}
              </div>
              <dl className="sp-row__nums">
                <div><dt>{tx(T.colFamilies)}</dt><dd>{number(r.workload.assignedFamilies)}</dd></div>
                <div><dt>{tx(T.colStudents)}</dt><dd>{number(r.workload.studentsInAssignedFamilies)}</dd></div>
                <div><dt>{tx(T.colOpen)}</dt><dd>{number(r.workload.openConversations)}</dd></div>
                <div><dt>{tx(T.colAwaiting)}</dt><dd>{number(r.workload.awaitingReply)}</dd></div>
                <div><dt>{tx(T.colApprovals)}</dt><dd>{number(r.workload.pendingApprovals)}</dd></div>
              </dl>
              <div className="sp-row__meta sp-small">
                <div>
                  {tx(T.colProfile)}: {tx(T.completeOf, { done: r.completeness.complete, total: r.completeness.total })}
                  {r.completeness.missing.length > 0 && (
                    <span className="sp-muted"> ({r.completeness.missing.map((m) => tx(MISSING_LABEL[m])).join(' · ')})</span>
                  )}
                </div>
                <div className="sp-muted">
                  {tx(T.colActivity)}: {r.lastActivityAt ? date(r.lastActivityAt) : tx(T.never)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
