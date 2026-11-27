import { useId, useMemo, useState } from 'react'
import { useRememberWalk } from '@/features/profiles/RecordHead'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { PLURAL, usePlural } from '@/features/admin/copy'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { RowActions } from '@/shared/components/RowActions'
import { SearchField } from '@/shared/components/SearchField'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { RESPONSIBILITY_CATEGORIES, type StaffSummary } from './api'
import { CATEGORY_LABEL, MISSING_LABEL, ROLE_LABEL, T, labelFor, useCopy } from './copy'

type StatusFilter = 'all' | 'active' | 'inactive' | 'incomplete'

/** A run of rows under one heading: a manager's team, whoever leads, whoever has no manager. */
interface Group {
  key: string
  kind: 'plain' | 'lead' | 'team' | 'unplaced'
  manager: { staffId: string; displayName: string } | null
  rows: StaffSummary[]
}

const TEAM = '__team'

/**
 * Who needs a manager first: the most conversations waiting for our reply, then
 * the most families carried, then by name. Inactive accounts follow the active.
 */
function byNeed(rows: StaffSummary[], locale: string): StaffSummary[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      b.workload.awaitingReply - a.workload.awaitingReply ||
      b.workload.assignedFamilies - a.workload.assignedFamilies ||
      a.displayName.localeCompare(b.displayName, locale),
  )
}

/** What a directory says about itself, counted from the rows the server sent. */
export function summarize(rows: StaffSummary[]) {
  return {
    people: rows.length,
    inactive: rows.filter((r) => !r.isActive).length,
    teams: new Set(rows.flatMap((r) => (r.reportingManager ? [r.reportingManager.staffId] : []))).size,
    unplaced: rows.filter((r) => !r.reportingManager && r.role !== 'super_admin').length,
    incomplete: rows.filter((r) => r.completeness.missing.length > 0).length,
  }
}

/**
 * The roster behind the Team page, "My team" on a manager's profile and the
 * organization overview's directory: the bar that narrows it, then one row a
 * person. It is the inside of a sheet; whoever renders it supplies the sheet.
 *
 * Filtering is client-side over rows the server already decided this viewer
 * may see -- it narrows, it never widens. On a phone the pickers wait behind
 * one "Filters" control.
 *
 * A row is who they are and the role they hold, the families they carry, the
 * conversations waiting for our reply (a count only when there are any), how
 * much of their profile is filled, and the way in. The rows lead with whoever
 * has families waiting, then whoever carries the most: no capacity is
 * recorded, so the families column is compared down the list rather than
 * drawn against an invented limit. Everything else about a person is on their
 * profile, which the whole row opens.
 *
 * `showManager` is the whole directory: it is set out under each reporting
 * manager, with whoever has no manager last under an amber tag.
 */
export function StaffTable({ rows, showManager, note }: { rows: StaffSummary[]; showManager: boolean; /** One quiet line at the foot. */ note?: string }) {
  const tx = useCopy()
  const plural = usePlural()
  const { number, t, locale } = useI18n()
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
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], locale))
  }, [rows, locale])

  const visible = byNeed(rows, locale).filter((r) => {
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
  const groups = showManager ? byManager(visible, locale) : [{ key: TEAM, kind: 'plain' as const, manager: null, rows: visible }]
  // A profile opened from here walks the list in the order it is shown.
  useRememberWalk(
    'staff',
    groups.flatMap((g) => g.rows.map((r) => ({ id: r.staffId, name: r.displayName }))),
  )
  const columns = 5

  return (
    <div className="sp-roster">
      <div className="sheet-bar sp-filters">
        <SearchField value={query} onChange={setQuery} label={tx(T.search)} clearLabel={t('common.cancel')} />
        <button
          type="button"
          className="btn btn--sm sp-filters__toggle"
          aria-expanded={filtersOpen}
          aria-controls={ids.more}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <Icon name="filter" size={16} />
          {tx(T.filters)}
          {narrowed > 0 && <span className="count">{number(narrowed)}</span>}
        </button>
        <div id={ids.more} className={filtersOpen ? 'sp-filters__more sp-filters__more--open' : 'sp-filters__more'}>
          <label className="sp-filter" htmlFor={ids.status}>
            <span className="sr-only">{tx(T.status)}</span>
            <SearchableSelect id={ids.status} className="select" value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <option value="all">{tx(T.status)}: {tx(T.anyOption)}</option>
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
        <span className="sheet-bar__end dir-total sp-roster__count">{plural(PLURAL.people, visible.length)}</span>
      </div>

      {visible.length === 0 ? (
        <p className="rec-empty">{tx(T.noMatches)}</p>
      ) : (
        <table className={showManager ? 'dir-table dir-table--grouped sp-roster__table' : 'dir-table sp-roster__table'}>
          <thead>
            <tr>
              <th scope="col">{tx(T.colPerson)}</th>
              <th scope="col" className="sp-cell-num">{tx(T.colFamilies)}</th>
              <th scope="col" className="sp-cell-await">{tx(T.colAwaiting)}</th>
              <th scope="col">{tx(T.colProfile)}</th>
              <th scope="col" className="cell-actions" aria-hidden="true" />
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key} className={g.kind === 'unplaced' ? 'dir-group dir-group--unplaced' : 'dir-group'}>
              {g.kind !== 'plain' && (
                <tr className="dir-group__head">
                  <th colSpan={columns} scope="rowgroup">
                    <span className="dir-group__title">
                      {g.kind === 'team' && g.manager ? (
                        <>
                          <span className="dir-group__label">{tx(T.colManager)}</span>
                          <bdi>{g.manager.displayName}</bdi>
                        </>
                      ) : g.kind === 'lead' ? (
                        <span>{tx(labelFor(ROLE_LABEL, 'super_admin'))}</span>
                      ) : (
                        <Badge tone="waiting">{tx(T.unassignedOption)}</Badge>
                      )}
                      <span className="count count--quiet">{number(g.rows.length)}</span>
                    </span>
                  </th>
                </tr>
              )}
              {g.rows.map((r) => {
                const roleText = tx(ROLE_LABEL[r.role] ?? { en: r.role, ar: r.role })
                const to = `/profile/${r.staffId}`
                const missing = r.completeness.missing.map((m) => tx(MISSING_LABEL[m])).join(locale === 'ar' ? '، ' : ', ')
                const awaiting = r.workload.awaitingReply
                return (
                  <tr
                    key={r.staffId}
                    className={r.isActive ? 'dir-row' : 'dir-row sp-row--inactive'}
                    onClick={(e) => {
                      // The whole row opens the profile; the name is the link the keyboard uses.
                      if (!(e.target as HTMLElement).closest('a, button, input')) navigate(to)
                    }}
                  >
                    <td className="dir-cell-who">
                      <span className="dir-who">
                        <Avatar name={r.displayName} seed={r.staffId} src={r.avatarUrl} />
                        <span className="dir-who__text">
                          <span className="sp-row__name">
                            <Link to={to} className="dir-name sp-row__link">
                              <bdi>{r.displayName}</bdi>
                            </Link>
                            {!r.isActive && (
                              // Someone inactive who still holds families is a problem; otherwise it is only a fact.
                              <Badge tone={r.workload.assignedFamilies > 0 ? 'danger' : 'outline'}>{tx(T.inactive)}</Badge>
                            )}
                          </span>
                          <span className="dir-sub">
                            <span>{roleText}</span>
                            {r.jobTitle && (
                              <span>
                                <bdi>{r.jobTitle}</bdi>
                              </span>
                            )}
                            {/* What the server lets this viewer do with the profile: said on every row, at every width. */}
                            <span>{r.access.canEditProfessional || r.access.canManageResponsibilities ? tx(T.canEditBadge) : tx(T.viewOnlyBadge)}</span>
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="sp-cell-num" data-label={tx(T.colFamilies)}>
                      <span className={r.workload.assignedFamilies > 0 ? 'sp-cell-num__n' : 'sp-cell-num__n sp-cell-num__n--none'}>{number(r.workload.assignedFamilies)}</span>
                    </td>
                    <td className={awaiting > 0 ? 'sp-cell-await' : 'sp-cell-await sp-cell-await--none'} data-label={tx(T.colAwaiting)}>
                      {/* Nothing waiting is an empty cell; a count is drawn only where there is one. */}
                      {awaiting > 0 ? <span className="sp-await-n">{number(awaiting)}</span> : <span className="sr-only">{number(0)}</span>}
                    </td>
                    <td className="dir-cell-quiet sp-cell-file" data-label={tx(T.colProfile)} title={missing || undefined}>
                      <bdi dir="ltr" className="sp-cell-file__n">{tx(T.completeOf, { done: r.completeness.complete, total: r.completeness.total })}</bdi>
                    </td>
                    <td className="cell-actions">
                      <RowActions
                        label={tx(T.more, { name: r.displayName })}
                        primary={
                          // The name is the link; this is only a larger target for the pointer.
                          <Link to={to} className="btn btn--sm" tabIndex={-1} aria-hidden="true">
                            {tx(T.openProfile)}
                          </Link>
                        }
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>
      )}
      {note && (
        <p className="dir-foot dir-foot--note sp-roster__foot">
          <span>{note}</span>
        </p>
      )}
    </div>
  )
}

/**
 * The directory under each reporting manager. Whoever leads the organization
 * comes first, then the people who report to them, then each team by its
 * manager's name; people with no manager come last, to be placed.
 */
function byManager(rows: StaffSummary[], locale: string): Group[] {
  const lead: StaffSummary[] = []
  const unplaced: StaffSummary[] = []
  const teams = new Map<string, Group & { top: boolean }>()
  for (const r of rows) {
    const m = r.reportingManager
    if (!m) {
      ;(r.role === 'super_admin' ? lead : unplaced).push(r)
      continue
    }
    const team = teams.get(m.staffId) ?? { key: m.staffId, kind: 'team' as const, manager: m, rows: [], top: m.role === 'super_admin' }
    team.rows.push(r)
    teams.set(m.staffId, team)
  }
  const ordered = [...teams.values()].sort(
    (a, b) => Number(b.top) - Number(a.top) || (a.manager?.displayName ?? '').localeCompare(b.manager?.displayName ?? '', locale),
  )
  return [
    ...(lead.length > 0 ? [{ key: '__lead', kind: 'lead' as const, manager: null, rows: lead }] : []),
    ...ordered,
    ...(unplaced.length > 0 ? [{ key: '__none', kind: 'unplaced' as const, manager: null, rows: unplaced }] : []),
  ]
}
