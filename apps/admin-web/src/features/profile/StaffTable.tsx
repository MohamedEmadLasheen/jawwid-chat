import { useId, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { SearchField } from '@/shared/components/SearchField'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { RESPONSIBILITY_CATEGORIES, type StaffSummary } from './api'
import { CATEGORY_LABEL, MISSING_LABEL, ROLE_LABEL, T, labelFor, useCopy } from './copy'

type StatusFilter = 'all' | 'active' | 'inactive' | 'incomplete'

/**
 * The searchable list behind "My team" (a manager) and the "Team directory"
 * (the super admin). Filtering is client-side over rows the server already
 * decided this viewer may see -- it narrows, it never widens.
 *
 * A directory, not a report: one line a person. On a wide screen the line
 * carries what they hold and what they carry under one row of column names; on
 * a phone it keeps the person and two facts (families, awaiting our reply),
 * and the rest is on their profile, which the whole line opens.
 */
export function StaffTable({ rows, showManager }: { rows: StaffSummary[]; showManager: boolean }) {
  const tx = useCopy()
  const { number, date, t } = useI18n()
  const navigate = useNavigate()
  const ids = { status: useId(), role: useId(), manager: useId(), cat: useId(), more: useId() }
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [role, setRole] = useState('')
  const [manager, setManager] = useState('')
  const [category, setCategory] = useState('')
  // On a phone the pickers wait behind one control; a wide screen always shows them.
  const [filtersOpen, setFiltersOpen] = useState(false)

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
  const narrowed = [status !== 'all', role !== '', manager !== '', category !== ''].filter(Boolean).length

  return (
    <div className="sp-table">
      <div className="sp-filters">
        <SearchField value={query} onChange={setQuery} label={tx(T.search)} clearLabel={t('common.cancel')} />
        <button
          type="button"
          className="btn btn--sm sp-filters__toggle"
          aria-expanded={filtersOpen}
          aria-controls={ids.more}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          {tx(T.filters)}
          {narrowed > 0 && <span className="sp-filters__count ltr">{number(narrowed)}</span>}
        </button>
        <div id={ids.more} className={filtersOpen ? 'sp-filters__more sp-filters__more--open' : 'sp-filters__more'}>
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
      </div>

      {visible.length === 0 ? (
        <p className="pp-empty">{tx(T.noMatches)}</p>
      ) : (
        <>
          {/* The column names, once. Each figure below still carries its own name for a screen reader. */}
          <div className="sp-rows__head" aria-hidden="true">
            <span>{tx(T.colPerson)}</span>
            <span>{tx(T.colResponsibilities)}</span>
            <span className="sp-rows__num">{tx(T.colFamilies)}</span>
            <span className="sp-rows__num">{tx(T.colStudents)}</span>
            <span className="sp-rows__num">{tx(T.colOpen)}</span>
            <span className="sp-rows__num">{tx(T.colAwaiting)}</span>
            <span className="sp-rows__num">{tx(T.colApprovals)}</span>
            <span>{tx(T.colProfile)}</span>
            <span>{tx(T.colActivity)}</span>
          </div>
          <ul className="sp-rows">
            {visible.map((r) => {
              const roleText = tx(ROLE_LABEL[r.role] ?? { en: r.role, ar: r.role })
              const to = `/profile/${r.staffId}`
              const missing = r.completeness.missing.map((m) => tx(MISSING_LABEL[m])).join(' · ')
              return (
                <li
                  key={r.staffId}
                  className="sp-row"
                  onClick={(e) => {
                    // The whole line opens the profile; the name is the link the keyboard uses.
                    if (!(e.target as HTMLElement).closest('a, button, input')) navigate(to)
                  }}
                >
                  <div className="sp-row__who">
                    <Avatar name={r.displayName} seed={r.staffId} src={r.avatarUrl} />
                    <div className="sp-row__names">
                      <Link to={to} className="sp-row__link">{r.displayName}</Link>
                      <div className="sp-row__sub">
                        <span>
                          <bdi>{r.jobTitle ? `${r.jobTitle} · ${roleText}` : roleText}</bdi>
                        </span>
                        {showManager && (
                          <span>
                            {tx(T.colManager)}: <bdi>{r.reportingManager?.displayName ?? tx(T.unassignedOption)}</bdi>
                          </span>
                        )}
                        {!r.isActive && <span className="badge badge--danger">{tx(T.inactive)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="sp-row__resp">
                    {r.responsibilities.map((c) => (
                      <span key={c} className="pp-tag">{tx(CATEGORY_LABEL[c] ?? { en: c, ar: c })}</span>
                    ))}
                  </div>
                  <dl className="sp-row__nums">
                    <div className="sp-row__fact"><dt>{tx(T.colFamilies)}</dt><dd>{number(r.workload.assignedFamilies)}</dd></div>
                    <div><dt>{tx(T.colStudents)}</dt><dd>{number(r.workload.studentsInAssignedFamilies)}</dd></div>
                    <div><dt>{tx(T.colOpen)}</dt><dd>{number(r.workload.openConversations)}</dd></div>
                    <div className="sp-row__fact"><dt>{tx(T.colAwaiting)}</dt><dd>{number(r.workload.awaitingReply)}</dd></div>
                    <div><dt>{tx(T.colApprovals)}</dt><dd>{number(r.workload.pendingApprovals)}</dd></div>
                  </dl>
                  <div className="sp-row__file" title={missing || undefined}>
                    <span className="ltr">{tx(T.completeOf, { done: r.completeness.complete, total: r.completeness.total })}</span>
                    <span className="sp-row__right">
                      {r.access.canEditProfessional || r.access.canManageResponsibilities ? tx(T.canEditBadge) : tx(T.viewOnlyBadge)}
                    </span>
                  </div>
                  <div className="sp-row__seen">{r.lastActivityAt ? date(r.lastActivityAt) : tx(T.never)}</div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
