import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { parentPath } from './api'
import { P, describeError, isProfileRefusal, useCopy } from './copy'
import { useParents } from './hooks'
import './profiles.css'

/**
 * PD-17: the parents this staff member may open -- every parent for the super
 * admin and the Operations Manager, the parents of the families they reach for
 * an Operations supervisor. The server decides the list.
 */
export function ParentsPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const { locale, t } = useI18n()
  const [q, setQ] = useState('')
  const deferred = useDeferredValue(q.trim())
  const list = useParents(deferred)
  const items = list.data?.items ?? []

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(P.parentsTitle)} subtitle={tx(P.parentsSubtitle)} />
        <div className="toolbar">
          <SearchField value={q} onChange={setQ} label={tx(P.search)} clearLabel={t('common.cancel')} />
        </div>
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
