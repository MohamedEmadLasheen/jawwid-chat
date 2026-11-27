import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { adminApi, type AdminUser } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { RefreshAction, matches, useRoleLabel } from './common'
import { ACCOUNT_STATUS, PRINCIPAL_KIND, PRINCIPAL_KIND_PLURAL, TEXT, listTime, useLabel, useText } from './copy'
import type { AdminSection } from './sections'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import './admin.css'
import '@/features/teachers/rows.css'
import { RowActions } from '@/shared/components/RowActions'

type KindFilter = 'all' | AdminUser['principalKind']
type StatusFilter = 'all' | 'active' | 'inactive'
type SortKey = 'name' | 'signin' | 'newest'

const userKey = (u: AdminUser) => `${u.principalKind}:${u.id}`

/**
 * Staff, teachers and family contacts, read-only. The table carries what is
 * needed to find someone; the rest is one click away in the details sheet.
 *
 * No login identifier (an email or a phone) is shown anywhere: the API does
 * not return it, by design.
 */
export function UsersView({ section }: { section: AdminSection }) {
  const tx = useText()
  const label = useLabel()
  const roleLabel = useRoleLabel()
  const { number, locale } = useI18n()
  const [search, setSearch] = useState('')
  // The kind filter is in the URL, so the dashboard can link to "family contacts".
  const [params, setParams] = useSearchParams()
  const kindParam = params.get('kind')
  const kind: KindFilter = kindParam === 'staff' || kindParam === 'teacher' || kindParam === 'contact' ? kindParam : 'all'
  const setKind = (next: KindFilter) => {
    const p = new URLSearchParams(params)
    if (next === 'all') p.delete('kind')
    else p.set('kind', next)
    setParams(p, { replace: true })
  }
  const [status, setStatus] = useState<StatusFilter>('all')
  const [openKey, setOpenKey] = useState<string | null>(null)

  const query = useQuery({ queryKey: qk.adminUsers, queryFn: adminApi.users })
  const users = useMemo(() => query.data?.users ?? [], [query.data])

  const searched = users.filter(
    (u) =>
      matches(u.displayName, search) &&
      (status === 'all' || (status === 'active') === u.isActive),
  )
  const visible = searched.filter((u) => kind === 'all' || u.principalKind === kind)
  // The API returns staff, then teachers, then contacts, oldest first; other orders are views of it.
  const sortParam = params.get('sort')
  const sort: SortKey = sortParam === 'signin' || sortParam === 'newest' ? sortParam : 'name'
  if (sort === 'name') {
    const collator = new Intl.Collator(locale)
    visible.sort((a, b) => collator.compare(a.displayName, b.displayName))
  } else if (sort === 'signin') {
    visible.sort((a, b) => (b.lastLoginAt ?? '').localeCompare(a.lastLoginAt ?? ''))
  } else {
    visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  const setSort = (next: SortKey) => {
    const p = new URLSearchParams(params)
    if (next === 'name') p.delete('sort')
    else p.set('sort', next)
    setParams(p, { replace: true })
  }
  const summary = [
    { key: 'people', label: tx(TEXT.people), value: users.length },
    { key: 'active', label: tx(TEXT.active), value: users.filter((u) => u.isActive).length },
    { key: 'inactive', label: tx(TEXT.inactive), value: users.filter((u) => !u.isActive).length },
    { key: 'nologin', label: tx(TEXT.noLogin), value: users.filter((u) => !u.hasLogin).length },
  ]
  const kindCount = (k: AdminUser['principalKind']) => searched.filter((u) => u.principalKind === k).length
  const kinds: AdminUser['principalKind'][] = ['staff', 'teacher', 'contact']
  const open = users.find((u) => userKey(u) === openKey) ?? null

  const filtered = search !== '' || kind !== 'all' || status !== 'all'
  const clear = () => {
    setSearch('')
    setKind('all')
    setStatus('all')
  }

  return (
    <div className="page adm-users">
      <div className="page__inner">
        {/* The directory's counts are the masthead's figures; the top bar already says where this page sits. */}
        <PageHeader
          title={tx(section.label)}
          figures={query.data && users.length > 0 ? summary.map((m, i) => ({ key: m.key, label: m.label, value: number(m.value), tone: i === 0 ? ('key' as const) : m.value === 0 ? ('quiet' as const) : undefined })) : undefined}
          actions={
            <RefreshAction
              updatedAt={query.dataUpdatedAt}
              fetching={query.isFetching}
              onRefresh={() => void query.refetch()}
            />
          }
        />
        <QueryBoundary
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          isEmpty={users.length === 0}
          emptyTitle={tx(TEXT.noUsers)}
        >
          <section className="sheet" aria-label={tx(section.label)}>
            <div className="sheet-bar">
              <SearchField value={search} onChange={setSearch} label={tx(TEXT.searchByName)} clearLabel={tx(TEXT.clearSearch)} />
              <FilterChips
                label={tx(TEXT.type)}
                value={kind}
                onChange={setKind}
                formatCount={number}
                options={[
                  { value: 'all', label: tx(TEXT.all) },
                  ...kinds.map((k) => ({ value: k, label: label(PRINCIPAL_KIND_PLURAL, k), count: kindCount(k) })),
                ]}
              />
              <div className="sheet-bar__end">
                <SearchableSelect
                  className="select select--inline"
                  value={status}
                  onValueChange={(v) => setStatus(v as StatusFilter)}
                  aria-label={tx(TEXT.filterByAccountStatus)}
                >
                  <option value="all">{tx(TEXT.allStatuses)}</option>
                  <option value="active">{tx(TEXT.active)}</option>
                  <option value="inactive">{tx(TEXT.inactive)}</option>
                </SearchableSelect>
                <SearchableSelect
                  className="select select--inline"
                  value={sort}
                  onValueChange={(v) => setSort(v as SortKey)}
                  aria-label={tx(TEXT.sortBy)}
                >
                  <option value="name">{tx(TEXT.sortName)}</option>
                  <option value="signin">{tx(TEXT.sortSignIn)}</option>
                  <option value="newest">{tx(TEXT.sortNewestAdded)}</option>
                </SearchableSelect>
              </div>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                compact
                title={tx(TEXT.noMatches)}
                action={
                  filtered && (
                    <button type="button" className="btn btn--sm" onClick={clear}>
                      {tx(TEXT.clearFilters)}
                    </button>
                  )
                }
              />
            ) : (
              <table className="rowlist">
                <thead>
                  <tr>
                    <th>{tx(TEXT.name)}</th>
                    <th>{tx(TEXT.role)}</th>
                    <th>{tx(TEXT.status)}</th>
                    <th>{tx(TEXT.lastSignIn)}</th>
                    <th>{tx(TEXT.details)}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((u) => (
                    <tr key={userKey(u)} onClick={() => setOpenKey(userKey(u))} aria-selected={openKey === userKey(u)}>
                      <td className="rw-who">
                        <Avatar name={u.displayName} seed={u.id} />
                        <span className="rw-who__text">
                          {/* The keyboard path to the row's details. */}
                          <button
                            type="button"
                            className="rw-name"
                            title={u.displayName}
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenKey(userKey(u))
                            }}
                          >
                            {u.displayName}
                          </button>
                          <span className="rw-sub">
                            {label(PRINCIPAL_KIND, u.principalKind)}
                            {roleLabel(u.staffRole) ? ` · ${roleLabel(u.staffRole)}` : ''}
                          </span>
                        </span>
                      </td>
                      <td className="rw-meta">
                        <span className="rw-fact__label">{tx(TEXT.lastSignIn)}</span>
                        <div>{u.lastLoginAt ? listTime(u.lastLoginAt, locale) : u.hasLogin ? tx(TEXT.never) : tx(TEXT.dash)}</div>
                      </td>
                      <td className="rw-tags">
                        <ActiveBadge active={u.isActive} />
                        {!u.hasLogin ? <Badge tone="outline">{tx(TEXT.noLogin)}</Badge> : u.accountStatus !== 'active' ? <Badge tone="warn">{label(ACCOUNT_STATUS, u.accountStatus)}</Badge> : null}
                      </td>
                      <td className="cell-actions">
                        <RowActions
                          primary={
                            <button type="button" className="btn btn--sm" aria-label={`${tx(TEXT.details)}: ${u.displayName}`} onClick={() => setOpenKey(userKey(u))}>
                              {tx(TEXT.details)}
                            </button>
                          }
                          label={u.displayName}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          {query.data?.truncated && <p className="list-footnote">{tx(TEXT.truncated)}</p>}
        </QueryBoundary>
      </div>

      {open && <UserSheet user={open} onClose={() => setOpenKey(null)} />}
    </div>
  )
}

function ActiveBadge({ active }: { active: boolean }) {
  const tx = useText()
  return (
    <Badge tone={active ? 'ok' : 'neutral'} dot>
      {active ? tx(TEXT.active) : tx(TEXT.inactive)}
    </Badge>
  )
}

function UserSheet({ user: u, onClose }: { user: AdminUser; onClose: () => void }) {
  const tx = useText()
  const label = useLabel()
  const roleLabel = useRoleLabel()
  const { dateTime } = useI18n()
  return (
    <Dialog variant="sheet" title={u.displayName} onClose={onClose}>
      <div className="sheet-hero">
        <Avatar name={u.displayName} seed={u.id} size="lg" />
        <div>
          <div className="sheet-hero__kind">{label(PRINCIPAL_KIND, u.principalKind)}</div>
          <ActiveBadge active={u.isActive} />
        </div>
      </div>
      <dl className="details">
        {u.staffRole && (
          <div className="details__row">
            <dt>{tx(TEXT.role)}</dt>
            <dd>{roleLabel(u.staffRole)}</dd>
          </div>
        )}
        <div className="details__row">
          <dt>{tx(TEXT.signIn)}</dt>
          <dd>{u.hasLogin ? label(ACCOUNT_STATUS, u.accountStatus) : tx(TEXT.noLogin)}</dd>
        </div>
        {u.hasLogin && (
          <div className="details__row">
            <dt>{tx(TEXT.lastSignIn)}</dt>
            <dd>{u.lastLoginAt ? dateTime(u.lastLoginAt) : tx(TEXT.never)}</dd>
          </div>
        )}
        <div className="details__row">
          <dt>{tx(TEXT.added)}</dt>
          <dd>{dateTime(u.createdAt)}</dd>
        </div>
        <div className="details__row details__section">
          <dt>{tx(TEXT.reference)}</dt>
          <dd className="mono">{u.id}</dd>
        </div>
        {u.familyId && (
          <div className="details__row">
            <dt>{tx(TEXT.familyReference)}</dt>
            <dd className="mono">{u.familyId}</dd>
          </div>
        )}
      </dl>
    </Dialog>
  )
}

