import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { Age, FlowSteps, FlowStrip, PanelHint, RequestQueue, RowOpen, rowOpener, type FlowCell } from '@/shared/components/RequestQueue'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Certificate, CertificateCategory, StateGroup } from './api'
import { C, GROUPS, groupLabel, stateLabel, stateTone, useCopy } from './copy'
import { useCertificate, useCertificateAccess, useCertificateCounts, useCertificates } from './hooks'
import { CertificateDetail, CertificateStatus, certificateSteps } from './CertificateDetail'
import { RequestDialog } from './RequestDialog'
import { TypesPanel } from './TypesPanel'
import './certificates.css'

type Tab = CertificateCategory | 'types'

/** Suggested is where a teacher's proposal waits, and Closed is where a request ends: both stand apart from the flow. */
const APART: ReadonlySet<StateGroup> = new Set<StateGroup>(['suggested', 'closed'])

/**
 * PD-41: the Certificates page (docs/product/pd041-certificates-design.md §10).
 *
 * Students | Teachers (only the categories this account reaches), then the
 * owner's lists -- Pending, In progress, Completed, Sent -- plus Suggested and
 * Closed, as a strip of counts. A row opens its detail beside the queue: the
 * steps, the request, the design, the review, the delivery, the Story and the
 * history. Every button comes from the row's `actions`, which the server
 * computes; the page re-derives nothing.
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

  const groups = GROUPS.filter((g) => !(designerOnly && g === 'suggested'))
  const counts = useCertificateCounts(category, groups, group)
  const cells: Array<FlowCell<StateGroup>> = groups.map((g, i) => ({
    key: g,
    label: tx(groupLabel(g)),
    count: counts[i]?.data ? counts[i]!.data!.certificates.length : null,
    more: !!counts[i]?.data?.nextCursor,
    apart: APART.has(g),
  }))

  // The open certificate is read once it is opened; until it arrives the row names it.
  const one = useCertificate(openId)
  const opened = one.data?.certificate ?? rows.find((c) => c.id === openId) ?? null

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
    <div className="page rq-page">
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
          <div className="cert-types">
            <TypesPanel />
          </div>
        ) : (
          <>
            <FlowStrip label={tx(C.flowLabel)} cells={cells} value={group} onChange={setGroup} />
            <RequestQueue
              label={tx(C.panelLabel)}
              detail={
                openId
                  ? {
                      id: openId,
                      title: opened?.printedName ?? tx(C.title),
                      kind: { icon: 'certificates', label: opened?.type ? tx({ en: opened.type.labelEn, ar: opened.type.labelAr }) : tx(C.kind) },
                      status: opened ? <CertificateStatus certificate={opened} /> : undefined,
                      body: <CertificateDetail certificateId={openId} />,
                      onClose: () => setOpenId(null),
                    }
                  : null
              }
              placeholder={
                <PanelHint>
                  <p className="rq-hint__title">{tx(C.pick)}</p>
                  <p className="rq-hint__line">{tx(C.pickLine)}</p>
                  <FlowSteps steps={certificateSteps(null, tx, dateTime)} label={tx(C.steps)} />
                </PanelHint>
              }
            >
              <div className="rq-toolbar">
                <SearchField value={q} onChange={setQ} label={tx(C.search)} clearLabel="×" />
              </div>
              <QueryBoundary isLoading={access.isLoading || list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
                {rows.length === 0 ? (
                  <EmptyState title={tx(C.empty)} hint={q.trim() ? undefined : tx(C.emptyHint)} />
                ) : (
                  <div className="table-wrap">
                    <table className="table rq-table">
                      <thead>
                        <tr>
                          <th scope="col">{tx(C.printedName)}</th>
                          <th scope="col" className="rq-c--extra">
                            {tx(C.juz)} / {tx(C.period)}
                          </th>
                          <th scope="col" className="rq-c--more">{tx(C.requestedBy)}</th>
                          <th scope="col">{tx(C.requested)}</th>
                          <th scope="col">{tx(C.status)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((c) => (
                          <tr key={c.id} data-selected={c.id === openId || undefined} onClick={rowOpener(() => setOpenId(c.id))}>
                            <th scope="row" className="rq-c-who">
                              <RowOpen selected={c.id === openId} onOpen={() => setOpenId(c.id)}>{c.printedName}</RowOpen>
                              <span className="rq-sub"><bdi>{c.type ? tx({ en: c.type.labelEn, ar: c.type.labelAr }) : c.title}</bdi></span>
                            </th>
                            <td className="rq-c--extra rq-nowrap">
                              {c.juz ?? (c.periodStart ? `${c.periodStart}${c.periodEnd && c.periodEnd !== c.periodStart ? ` → ${c.periodEnd}` : ''}` : <span className="rq-muted">—</span>)}
                            </td>
                            <td className="rq-c-meta rq-c--more">
                              <bdi>{c.projection === 'full' ? (c.requestedBy?.name ?? c.suggestedBy?.name ?? '—') : (c.requesterName ?? '—')}</bdi>
                            </td>
                            <td className="rq-c-when">
                              <Age iso={c.requestedAt} />
                              <span className="rq-sub">{dateTime(c.requestedAt)}</span>
                            </td>
                            <td className="rq-c-status">
                              <Badge tone={stateTone(c.state)} dot>{tx(stateLabel(c.state))}</Badge>
                              {c.projection === 'full' && c.story && !c.story.withdrawnAt && <span className="rq-sub">{tx(C.storyPublished)}</span>}
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
            </RequestQueue>
          </>
        )}
      </div>
      {requesting && category && <RequestDialog category={category} onClose={() => setRequesting(false)} onCreated={(id) => setOpenId(id)} />}
    </div>
  )
}
