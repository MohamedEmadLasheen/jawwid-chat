import { useDeferredValue, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { CountTabs } from './CountTabs'
import { parentPath, type ParentAccessFilter, type ParentLocationFilter } from './api'
import { LocationText } from '@/shared/location/LocationPicker'
import { P, describeError, isProfileRefusal, useCopy } from './copy'
import { useParents } from './hooks'
import { IntakeDialog } from '@/features/intake/IntakeDialog'
import { I } from '@/features/intake/copy'
import { useIntakeOptions } from '@/features/intake/hooks'
import './profiles.css'

/** The list answers at most this many rows; past it the count is a floor, not a total. */
const LIST_LIMIT = 200

/**
 * PD-17: the parents this staff member may open -- every parent for the super
 * admin and the Operations Manager, the parents of the families they reach for
 * an Operations supervisor. The server decides the list.
 */
export function ParentsPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const { locale, t, number } = useI18n()
  // `?q=` opens the list already searched (PD-27: New Students links here once a family is assigned).
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const deferred = useDeferredValue(q.trim())
  // PD-44: `?access=locked|grace` -- the Dashboard's subscription tiles open the list they counted.
  const asked = params.get('access')
  const access: ParentAccessFilter = asked === 'locked' || asked === 'grace' ? asked : 'all'
  const setAccess = (next: ParentAccessFilter) =>
    setParams((current) => {
      const p = new URLSearchParams(current)
      if (next === 'all') p.delete('access')
      else p.set('access', next)
      return p
    }, { replace: true })
  // PD-45: `?location=missing` -- the families staff complete (plan §6.1 a).
  const location: ParentLocationFilter = params.get('location') === 'missing' ? 'missing' : 'all'
  const setLocation = (next: ParentLocationFilter) =>
    setParams((current) => {
      const p = new URLSearchParams(current)
      if (next === 'all') p.delete('location')
      else p.set('location', next)
      return p
    }, { replace: true })
  const list = useParents(deferred, access, location)
  const items = list.data?.items ?? []
  // PD-42: offered when the server says this viewer enters families.
  const intake = useIntakeOptions()
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  // The list carries no totals per filter: only the open tab can say how many it holds.
  const shown = list.data ? (list.data.truncated && items.length >= LIST_LIMIT ? `${number(items.length)}+` : number(items.length)) : undefined
  const count = (tab: ParentAccessFilter) => (tab === access ? shown : undefined)
  const searching = deferred !== '' || access !== 'all' || location !== 'all'

  return (
    <div className="page pp pp-list">
      <div className="page__inner">
        <PageHeader
          eyebrow={eyebrow}
          title={tx(P.parentsTitle)}
          subtitle={tx(P.parentsSubtitle)}
          actions={
            intake.data?.ready && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={intake.data.noTeam}
                aria-describedby={intake.data.noTeam ? 'add-family-no-team' : undefined}
                onClick={() => setAdding(true)}
              >
                {tx(I.addFamily)}
              </button>
            )
          }
        />
        {intake.data?.ready && intake.data.noTeam && (
          <p id="add-family-no-team" className="notice">
            {tx(intake.data.standing === 'sales_manager' ? I.noTeamSales : intake.data.standing === 'operations_manager' ? I.noTeamOperations : I.noTeamAny)}
          </p>
        )}
        <CountTabs<ParentAccessFilter>
          label={tx(P.subscriptionFilter)}
          value={access}
          onChange={setAccess}
          tabs={[
            { value: 'all', label: tx(P.allParents), count: count('all') },
            { value: 'locked', label: tx(P.accessLocked), count: count('locked') },
            { value: 'grace', label: tx(P.accessGrace), count: count('grace') },
          ]}
        />
        <div className="pp-tools">
          <SearchField value={q} onChange={setQ} label={tx(P.search)} clearLabel={t('common.cancel')} />
          {/* One filter, so one chip: pressed it narrows the list, pressed again it is removed. */}
          <div className="chips" role="group" aria-label={tx(P.location)}>
            <button
              type="button"
              className="chip"
              aria-pressed={location === 'missing'}
              onClick={() => setLocation(location === 'missing' ? 'all' : 'missing')}
            >
              {tx(P.missingLocation)}
              {location === 'missing' && (
                <span className="pp-chip-x" aria-hidden="true">
                  <Icon name="close" size={13} />
                </span>
              )}
            </button>
          </div>
        </div>
        {adding && intake.data && <IntakeDialog options={intake.data} initial={{ kind: 'new' }} onClose={() => setAdding(false)} />}
        {isProfileRefusal(list.error) ? (
          <EmptyState icon="lock" title={describeError(list.error, locale)} />
        ) : (
          <QueryBoundary
            isLoading={list.isLoading}
            error={list.error}
            isEmpty={items.length === 0}
            emptyTitle={tx(P.noParents)}
            emptyHint={tx(searching ? P.noParentsFiltered : P.noParentsHint)}
            onRetry={() => void list.refetch()}
          >
            <div className="table-wrap">
              <table className="table pp-stack">
                <thead>
                  <tr>
                    <th scope="col">{tx(P.parent)}</th>
                    <th scope="col">{tx(P.family)}</th>
                    <th scope="col" className="num">{tx(P.children)}</th>
                    <th scope="col">{tx(P.location)}</th>
                    <th scope="col" aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr
                      key={p.id}
                      className="pp-rowlink"
                      onClick={(e) => {
                        // The whole row opens the file; the name is the link the keyboard uses.
                        if (!(e.target as HTMLElement).closest('a, button, input')) navigate(parentPath(p.id))
                      }}
                    >
                      <td>
                        <Link to={parentPath(p.id)} className="pp-cell-who">
                          <Avatar name={p.name} seed={p.id} src={p.avatarUrl} size="sm" />
                          <bdi>{p.name}</bdi>
                        </Link>
                      </td>
                      <td data-label={tx(P.family)}><bdi>{p.family.name}</bdi></td>
                      <td className="num" data-label={tx(P.children)}>{p.childrenCount}</td>
                      <td data-label={tx(P.location)}>{p.location ? <LocationText value={p.location} /> : '—'}</td>
                      <td className="pp-cell-end">
                        {/* The name is the link; this is only a larger target for the pointer. */}
                        <span className="row-actions" aria-hidden="true">
                          <Link to={parentPath(p.id)} className="pp-go" tabIndex={-1}>
                            <Icon name="chevronForward" size={16} />
                          </Link>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.data?.truncated && <p className="pp-rule">{tx(P.truncated)}</p>}
          </QueryBoundary>
        )}
      </div>
    </div>
  )
}
