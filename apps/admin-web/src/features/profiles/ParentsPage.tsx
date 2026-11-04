import { useDeferredValue, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { PageHeader } from '@/shared/components/PageHeader'
import { FilterChips } from '@/shared/components/FilterChips'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { parentPath, type ParentAccessFilter, type ParentLocationFilter } from './api'
import { LocationText } from '@/shared/location/LocationPicker'
import { P, describeError, isProfileRefusal, useCopy } from './copy'
import { useParents } from './hooks'
import { IntakeDialog } from '@/features/intake/IntakeDialog'
import { I } from '@/features/intake/copy'
import { useIntakeOptions } from '@/features/intake/hooks'
import './profiles.css'

/**
 * PD-17: the parents this staff member may open -- every parent for the super
 * admin and the Operations Manager, the parents of the families they reach for
 * an Operations supervisor. The server decides the list.
 */
export function ParentsPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const { locale, t } = useI18n()
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

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(P.parentsTitle)} subtitle={tx(P.parentsSubtitle)} />
        <div className="toolbar">
          <SearchField value={q} onChange={setQ} label={tx(P.search)} clearLabel={t('common.cancel')} />
          <FilterChips<ParentAccessFilter>
            label={tx(P.subscriptionFilter)}
            value={access}
            onChange={setAccess}
            options={[
              { value: 'all', label: tx(P.allParents) },
              { value: 'locked', label: tx(P.accessLocked) },
              { value: 'grace', label: tx(P.accessGrace) },
            ]}
          />
          <FilterChips<ParentLocationFilter>
            label={tx(P.location)}
            value={location}
            onChange={setLocation}
            options={[
              { value: 'all', label: tx(P.allParents) },
              { value: 'missing', label: tx(P.missingLocation) },
            ]}
          />
          {intake.data?.ready && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={intake.data.noTeam}
              aria-describedby={intake.data.noTeam ? 'add-family-no-team' : undefined}
              onClick={() => setAdding(true)}
            >
              {tx(I.addFamily)}
            </button>
          )}
          {intake.data?.ready && intake.data.noTeam && (
            <p id="add-family-no-team" className="field__hint">
              {tx(intake.data.standing === 'sales_manager' ? I.noTeamSales : intake.data.standing === 'operations_manager' ? I.noTeamOperations : I.noTeamAny)}
            </p>
          )}
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
            onRetry={() => void list.refetch()}
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tx(P.parent)}</th>
                    <th scope="col">{tx(P.family)}</th>
                    <th scope="col">{tx(P.children)}</th>
                    <th scope="col">{tx(P.location)}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={parentPath(p.id)} className="pf-person">
                          <Avatar name={p.name} seed={p.id} src={p.avatarUrl} size="sm" />
                          <span dir="auto">{p.name}</span>
                        </Link>
                      </td>
                      <td dir="auto">{p.family.name}</td>
                      <td>{p.childrenCount}</td>
                      <td>{p.location ? <LocationText value={p.location} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.data?.truncated && <p className="field__hint">{tx(P.truncated)}</p>}
          </QueryBoundary>
        )}
      </div>
    </div>
  )
}
