import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Certificate, CertificateCategory, StateGroup } from './api'
import { C, GROUPS, groupLabel, stateLabel, stateTone, useCopy } from './copy'
import { useCertificateAccess, useCertificates } from './hooks'
import { CertificateDrawer } from './CertificateDrawer'
import { RequestDialog } from './RequestDialog'
import { TypesPanel } from './TypesPanel'
import './certificates.css'

type Tab = CertificateCategory | 'types'

/**
 * PD-41: the Certificates page (docs/product/pd041-certificates-design.md §10).
 *
 * Students | Teachers (only the categories this account reaches), then the
 * owner's lists -- Pending, In progress, Completed, Sent -- plus Suggested and
 * Closed. A row opens its drawer: the request, the design, the review, the
 * delivery, the Story and the history. Every button comes from the row's
 * `actions`, which the server computes; the page re-derives nothing.
 *
 * The same page serves the Designer: the server sends the design projection
 * (no family data, no delivery, no consent), and there is nothing to request.
 */
export function CertificatesPage() {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const [params, setParams] = useSearchParams()
  const access = useCertificateAccess()
  const a = access.data

  const tabs = useMemo<Tab[]>(() => {
    if (!a) return []
    const reach = (c: CertificateCategory) => a.design || a.categories[c].request || a.categories[c].oversee
    const out: Tab[] = (['student', 'teacher'] as const).filter(reach)
    if (a.types) out.push('types')
    return out
  }, [a])

  const asked = params.get('category')
  const tab: Tab | undefined = tabs.find((t) => t === asked) ?? tabs[0]
  const category = tab === 'types' ? undefined : tab
  const designerOnly = !!a && a.design && !a.categories.student.request && !a.categories.teacher.request
  const [group, setGroup] = useState<StateGroup>('pending')
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [openId, setOpenId] = useState<string | null>(params.get('id'))
  const [requesting, setRequesting] = useState(false)

  useEffect(() => setCursor(undefined), [category, group, q])

  const list = useCertificates({ category, status: group, q: q.trim() || undefined, cursor }, !!category)
  const rows: Certificate[] = list.data?.certificates ?? []
  const canRequest = !!category && !!a?.categories[category].request

  const selectTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    next.set('category', t)
    next.delete('id')
    setParams(next, { replace: true })
  }

  if (access.isError || (a && !a.canOpen)) {
    return (
      <div className="page">
        <div className="page__inner">
          <PageHeader title={tx(C.title)} />
          <EmptyState icon="lock" title={tx(C.denied)} />
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader
          title={tx(C.title)}
          subtitle={tx(C.subtitle)}
          actions={
            canRequest ? (
              <button type="button" className="btn btn--primary" onClick={() => setRequesting(true)}>
                {tx(C.newRequest)}
              </button>
            ) : undefined
          }
        />
        {tabs.length > 1 && (
          <FilterChips<Tab>
            variant="tabs"
            label={tx(C.title)}
            value={tab ?? 'student'}
            onChange={selectTab}
            options={tabs.map((t) => ({ value: t, label: tx(t === 'student' ? C.students : t === 'teacher' ? C.teachers : C.types) }))}
          />
        )}
        {tab === 'types' ? (
          <TypesPanel />
        ) : (
          <>
            <div className="toolbar cert-toolbar">
              <FilterChips<StateGroup>
                label={tx(C.status)}
                value={group}
                onChange={setGroup}
                options={GROUPS.filter((g) => !(designerOnly && g === 'suggested')).map((g) => ({ value: g, label: tx(groupLabel(g)) }))}
              />
              <SearchField value={q} onChange={setQ} label={tx(C.search)} clearLabel="×" />
            </div>
            <QueryBoundary isLoading={access.isLoading || list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
              {rows.length === 0 ? (
                <EmptyState title={tx(C.empty)} />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">{tx(C.printedName)}</th>
                        <th scope="col">{tx(C.type)}</th>
                        <th scope="col">
                          {tx(C.juz)} / {tx(C.period)}
                        </th>
                        <th scope="col">{tx(C.requestedBy)}</th>
                        <th scope="col">{tx(C.requested)}</th>
                        <th scope="col">{tx(C.status)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <button type="button" className="link-button" onClick={() => setOpenId(c.id)}>
                              <strong dir="auto">{c.printedName}</strong>
                            </button>
                          </td>
                          <td dir="auto">{c.type ? tx({ en: c.type.labelEn, ar: c.type.labelAr }) : c.title}</td>
                          <td>{c.juz ?? (c.periodStart ? `${c.periodStart}${c.periodEnd && c.periodEnd !== c.periodStart ? ` → ${c.periodEnd}` : ''}` : '—')}</td>
                          <td dir="auto">{c.projection === 'full' ? (c.requestedBy?.name ?? c.suggestedBy?.name ?? '—') : (c.requesterName ?? '—')}</td>
                          <td>{dateTime(c.requestedAt)}</td>
                          <td>
                            <Badge tone={stateTone(c.state)}>{tx(stateLabel(c.state))}</Badge>
                            {c.projection === 'full' && c.story && !c.story.withdrawnAt && <Badge tone="info">{tx(C.storyPublished)}</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {list.data?.nextCursor && (
                <button type="button" className="btn cert-more" onClick={() => setCursor(list.data!.nextCursor!)}>
                  {tx(C.more)}
                </button>
              )}
            </QueryBoundary>
          </>
        )}
      </div>
      {openId && <CertificateDrawer certificateId={openId} onClose={() => setOpenId(null)} />}
      {requesting && category && <RequestDialog category={category} onClose={() => setRequesting(false)} onCreated={(id) => setOpenId(id)} />}
    </div>
  )
}
