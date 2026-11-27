import { useDeferredValue, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { countWords } from '@/features/instalments/copy'
import { parentPath, type ParentAccessFilter, type ParentLocationFilter } from './api'
import { LocationText } from '@/shared/location/LocationPicker'
import { CHILDREN_COUNT, P, PARENTS_COUNT, describeError, isProfileRefusal, useCopy } from './copy'
import { useParents } from './hooks'
import { fill, useRememberWalk } from './RecordHead'
import { IntakeDialog } from '@/features/intake/IntakeDialog'
import { I } from '@/features/intake/copy'
import { useIntakeOptions } from '@/features/intake/hooks'
import './profiles.css'

/** The list answers at most this many rows; past it the count is a floor, not a total. */
const LIST_LIMIT = 200

const ACCESS: ReadonlyArray<{ value: ParentAccessFilter; label: keyof typeof P }> = [
  { value: 'all', label: 'allParents' },
  { value: 'locked', label: 'accessLocked' },
  { value: 'grace', label: 'accessGrace' },
]

/**
 * PD-17: the parents this staff member may open -- every parent for the super
 * admin and the Operations Manager, the parents of the families they reach for
 * an Operations supervisor. The server decides the list.
 *
 * A directory: the masthead says how many are listed and holds "Add family";
 * one sheet holds the list with the search and filters that narrow it. A row is
 * who the parent is, their family and children in one line, and where they are;
 * the whole row opens the file.
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
  // A parent's file walks this list in the order it is shown.
  useRememberWalk('parents', list.data?.items)
  // PD-42: offered when the server says this viewer enters families.
  const intake = useIntakeOptions()
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  const searching = deferred !== '' || access !== 'all' || location !== 'all'

  // The list carries no totals per filter: the count is of the list that is open, said once in the sheet's bar,
  // in words like every other roster's count ("30 parents"); past the limit it is a floor ("200+ shown").
  const floor = list.data?.truncated === true && items.length >= LIST_LIMIT

  return (
    <div className="page dir">
      <div className="page__inner">
        <PageHeader
          eyebrow={eyebrow}
          title={tx(P.parentsTitle)}
          actions={
            intake.data?.ready && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={intake.data.noTeam}
                aria-describedby={intake.data.noTeam ? 'add-family-no-team' : undefined}
                onClick={() => setAdding(true)}
              >
                <Icon name="plus" size={16} />
                {tx(I.addFamily)}
              </button>
            )
          }
        />
        {intake.data?.ready && intake.data.noTeam && (
          <p id="add-family-no-team" className="notice dir-notice">
            {tx(intake.data.standing === 'sales_manager' ? I.noTeamSales : intake.data.standing === 'operations_manager' ? I.noTeamOperations : I.noTeamAny)}
          </p>
        )}
        {adding && intake.data && <IntakeDialog options={intake.data} initial={{ kind: 'new' }} onClose={() => setAdding(false)} />}
        <section className="sheet dir-sheet">
          <div className="sheet-bar">
            <SearchField value={q} onChange={setQ} label={tx(P.search)} clearLabel={t('common.cancel')} />
            <div className="chips" role="group" aria-label={tx(P.subscriptionFilter)}>
              {ACCESS.map((a) => (
                <button key={a.value} type="button" className="chip" aria-pressed={access === a.value} onClick={() => setAccess(a.value)}>
                  {tx(P[a.label])}
                </button>
              ))}
            </div>
            {/* One filter, so one chip: pressed it narrows the list, pressed again it is removed. */}
            <div className="chips" role="group" aria-label={tx(P.location)}>
              <button type="button" className="chip" aria-pressed={location === 'missing'} onClick={() => setLocation(location === 'missing' ? 'all' : 'missing')}>
                {tx(P.missingLocation)}
                {location === 'missing' && (
                  <span className="pp-chip-x" aria-hidden="true">
                    <Icon name="close" size={13} />
                  </span>
                )}
              </button>
            </div>
            {list.data && (
              <span className="dir-count" role="status">
                {floor ? fill(tx(P.listCount), { n: `${number(items.length)}+` }) : countWords(items.length, PARENTS_COUNT, locale)}
              </span>
            )}
          </div>
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
              <table className="dir-table">
                <thead>
                  <tr>
                    <th scope="col">{tx(P.parent)}</th>
                    {access !== 'all' && <th scope="col">{tx(P.subscriptionFilter)}</th>}
                    <th scope="col">{tx(P.location)}</th>
                    <th scope="col" className="cell-actions" aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr
                      key={p.id}
                      className="dir-row"
                      onClick={(e) => {
                        // The whole row opens the file; the name is the link the keyboard uses.
                        if (!(e.target as HTMLElement).closest('a, button, input')) navigate(parentPath(p.id))
                      }}
                    >
                      <td className="dir-cell-who">
                        <span className="dir-who">
                          <Avatar name={p.name} seed={p.id} src={p.avatarUrl} />
                          <span className="dir-who__text">
                            <Link to={parentPath(p.id)} className="dir-name">
                              <bdi>{p.name}</bdi>
                            </Link>
                            <span className="dir-sub">
                              <span>
                                <bdi>{p.family.name}</bdi>
                              </span>
                              <span>{countWords(p.childrenCount, CHILDREN_COUNT, locale)}</span>
                            </span>
                          </span>
                        </span>
                      </td>
                      {/* The list says nothing of a family's state by itself: only the filter that was asked for. */}
                      {access !== 'all' && (
                        <td className="dir-cell-state">
                          <Badge tone={access === 'locked' ? 'danger' : 'warn'}>{tx(access === 'locked' ? P.accessLocked : P.accessGrace)}</Badge>
                        </td>
                      )}
                      <td className={p.location?.countryCode ? 'dir-cell-quiet' : 'dir-cell-quiet dir-cell-quiet--none'} data-label={tx(P.location)}>
                        {p.location?.countryCode ? <LocationText value={p.location} /> : <span className="dir-missing">{tx(P.notRecorded)}</span>}
                      </td>
                      <td className="cell-actions">
                        <RowActions
                          label={tx(P.more, { name: p.name })}
                          primary={
                            // The name is the link; this is only a larger target for the pointer.
                            <Link to={parentPath(p.id)} className="btn btn--sm" tabIndex={-1} aria-hidden="true">
                              {tx(P.open)}
                            </Link>
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.data?.truncated && <p className="dir-foot dir-foot--note">{tx(P.truncated)}</p>}
            </QueryBoundary>
          )}
        </section>
      </div>
    </div>
  )
}
