import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import { PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { Age, Board, BoardCard, RequestQueue, useWidePane, waitedOvernight, type BoardStage } from '@/shared/components/RequestQueue'
import { RowActions } from '@/shared/components/RowActions'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import type { Certificate, CertificateAct, CertificateCategory, StateGroup } from './api'
import { C, GROUPS, actLabel, groupLabel, useCopy } from './copy'
import { useCertificate, useCertificateAccess, useCertificateBoard } from './hooks'
import { CertificateDetail, actEnds, actIcon, certificateWhy, orderedActs } from './CertificateDetail'
import { RequestDialog } from './RequestDialog'
import { TypesPanel } from './TypesPanel'
import './certificates.css'

type Tab = CertificateCategory | 'types'

/** A search that waits for a pause in typing: it is asked of every column. */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * PD-41: the Certificates page (docs/product/pd041-certificates-design.md §10).
 *
 * Students | Teachers (only the categories this account reaches), then a board
 * of the owner's lists in the order a certificate moves through them --
 * Suggested, Pending, In progress, Completed, Sent -- with Closed kept behind
 * a switch. A card states the first act the server allows on it and keeps the
 * others behind "⋯"; the page re-derives nothing. Opening a card shows its
 * steps, the request, the design, the review, the delivery, the Story and the
 * history in the inspector, and no certificate is read before that.
 *
 * The same page serves the Designer: the server sends the design projection
 * (no family data, no delivery, no consent), and there is nothing to request.
 */
export function CertificatesPage() {
  const tx = useCopy()
  const { number, locale } = useI18n()
  const wide = useWidePane()
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
  // The state in view: every column with room for them; one at a time without (Pending first, where new work lands).
  const [focus, setFocus] = useState<StateGroup | 'all' | null>(null)
  const stage: StateGroup | 'all' = focus ?? (wide ? 'all' : 'pending')
  const [showClosed, setShowClosed] = useState(false)
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim()) || undefined
  const [cursors, setCursors] = useState<Partial<Record<StateGroup, string>>>({})
  const [openId, setOpenId] = useState<string | null>(params.get('id'))
  const [intent, setIntent] = useState<{ id: string; act: CertificateAct } | null>(null)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => setCursors({}), [category, q])

  const groups = GROUPS.filter((g) => !(designerOnly && g === 'suggested') && (g !== 'closed' || showClosed || stage === 'closed'))
  const lists = useCertificateBoard(category, groups, q, cursors)
  const listOf = (g: StateGroup) => lists[groups.indexOf(g)]
  const countOf = (g: StateGroup) => listOf(g)?.data?.certificates.length ?? null
  const canRequest = !!category && !!a?.categories[category].request

  // The open certificate is read once it is opened; until it arrives its card names it.
  const one = useCertificate(openId)
  const opened = one.data?.certificate ?? lists.flatMap((l) => l.data?.certificates ?? []).find((c) => c.id === openId) ?? null

  const selectTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    next.set('category', t)
    next.delete('id')
    setParams(next, { replace: true })
  }
  const openWith = (c: Certificate, act: CertificateAct) => {
    setOpenId(c.id)
    setIntent({ id: c.id, act })
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

  /**
   * A certificate on the board: whose it is, its state word where the column
   * holds more than one state, why it waits there (the one emphasised line),
   * what kind and who asked, since when, and the first act the server allows.
   * Sent and closed certificates are quiet cards.
   */
  const card = (c: Certificate, group: StateGroup) => {
    const acts = orderedActs(c.actions)
    const first = acts[0]
    const requester = c.projection === 'full' ? (c.requestedBy?.name ?? c.suggestedBy?.name ?? null) : c.requesterName
    const story = c.projection === 'full' && !!c.story && !c.story.withdrawnAt
    return (
      <BoardCard
        key={c.id}
        title={c.printedName}
        selected={c.id === openId}
        onOpen={() => setOpenId(c.id)}
        // Work that has ended is a quiet card, unless the server still offers an act on it (a Story, consent).
        quiet={(group === 'sent' || group === 'closed') && acts.length === 0}
        // The waiting fact already says the state; the status word is what it does not: a Story that is live.
        status={story ? <Badge tone="info" dot>{tx(C.storyPublished)}</Badge> : undefined}
        fact={certificateWhy(c, tx, locale)}
        // An open request left since before today is late, as on the Requests hub.
        age={<Age iso={c.requestedAt} late={group !== 'sent' && group !== 'closed' && waitedOvernight(c.requestedAt)} />}
        actions={
          <RowActions
            label={`${tx(C.moreActions)}: ${c.printedName}`}
            primary={
              // A card never states an act that ends the request: when that is all there is, it opens instead.
              first && !actEnds(first) ? (
                <button type="button" className="btn btn--sm" onClick={() => openWith(c, first)}>{tx(actLabel(first))}</button>
              ) : (
                <button type="button" className="btn btn--sm" onClick={() => setOpenId(c.id)}>{tx(C.open)}</button>
              )
            }
            more={(first && !actEnds(first) ? acts.slice(1) : acts).map((x) => ({ key: x, label: tx(actLabel(x)), icon: actIcon(x), danger: actEnds(x), onSelect: () => openWith(c, x) }))}
          />
        }
      >
        <p className="rq-card__line">
          <Icon name="certificates" size={16} />
          <span>
            <bdi>{c.type ? tx({ en: c.type.labelEn, ar: c.type.labelAr }) : c.title}</bdi>
            {c.juz !== null && <> <bdi className="ltr">{number(c.juz)}</bdi></>}
          </span>
        </p>
        {requester && group !== 'sent' && group !== 'closed' && (
          <p className="rq-card__line">
            <Icon name="user" size={16} />
            <bdi>{requester}</bdi>
          </p>
        )}
      </BoardCard>
    )
  }

  const stages: Array<BoardStage<StateGroup>> = groups.map((g) => {
    const list = listOf(g)?.data
    return {
      key: g,
      label: tx(groupLabel(g)),
      count: countOf(g),
      quiet: g === 'sent' || g === 'closed',
      more: !!list?.nextCursor,
      cards: (list?.certificates ?? []).map((c) => card(c, g)),
      empty: tx(C.stageEmpty),
      foot: list?.nextCursor ? (
        <button type="button" className="btn btn--sm btn--ghost rq-col__foot" onClick={() => setCursors((cur) => ({ ...cur, [g]: list.nextCursor! }))}>
          {tx(C.more)}
        </button>
      ) : undefined,
    }
  })

  // The masthead sums the board up rather than repeating its columns: what is open, whose turn it
  // is, and what has gone out. The figure this account acts on is the key one. Each is the length
  // of lists the board already holds ("+" when one of them is longer than its first page).
  const sum = (label: string, key: string, of: readonly StateGroup[], tone?: MastFigure['tone'], opens?: StateGroup): MastFigure => {
    const on = of.filter((g) => groups.includes(g))
    const known = on.every((g) => countOf(g) !== null)
    const total = on.reduce((n, g) => n + (countOf(g) ?? 0), 0)
    return {
      key,
      label,
      value: known ? `${number(total)}${on.some((g) => listOf(g)?.data?.nextCursor) ? '+' : ''}` : '–',
      tone: known && total === 0 ? 'quiet' : tone,
      ...(opens ? { onClick: () => setFocus(stage === opens ? 'all' : opens), pressed: stage === opens } : {}),
    }
  }
  const figures: MastFigure[] = category
    ? [
        sum(tx(C.figOpen), 'open', ['suggested', 'pending', 'in_progress', 'completed']),
        sum(tx(C.figDesigner), 'designer', ['pending', 'in_progress'], designerOnly ? 'key' : undefined),
        sum(tx(C.figReview), 'review', ['completed'], designerOnly ? undefined : 'key', 'completed'),
        sum(tx(groupLabel('sent')), 'sent', ['sent'], 'quiet', 'sent'),
      ]
    : []

  const loading = access.isLoading || lists.some((l) => l.isLoading)
  const failed = lists.find((l) => l.error)
  const none = !loading && lists.every((l) => (l.data?.certificates.length ?? 0) === 0)

  return (
    <div className="page rq-page">
      <div className="page__inner">
        <PageHeader
          title={tx(C.title)}
          subtitle={tx(C.subtitle)}
          figures={figures.length > 0 ? figures : undefined}
          tabs={
            tabs.length > 1 ? (
              <FilterChips<Tab>
                variant="tabs"
                label={tx(C.title)}
                value={tab ?? 'student'}
                onChange={selectTab}
                options={tabs.map((t) => ({ value: t, label: tx(t === 'student' ? C.students : t === 'teacher' ? C.teachers : C.types) }))}
              />
            ) : undefined
          }
          actions={
            canRequest ? (
              <button type="button" className="btn" onClick={() => setRequesting(true)}>
                <Icon name="plus" size={16} />
                {tx(C.newRequest)}
              </button>
            ) : undefined
          }
        />
        {tab === 'types' ? (
          <div className="cert-types">
            <TypesPanel />
          </div>
        ) : (
          <RequestQueue
            label={tx(C.panelLabel)}
            detail={
              openId
                ? {
                    id: openId,
                    title: opened?.printedName ?? tx(C.title),
                    kind: { icon: 'certificates', label: opened?.type ? tx({ en: opened.type.labelEn, ar: opened.type.labelAr }) : tx(C.kind) },
                    body: <CertificateDetail certificateId={openId} intent={intent?.id === openId ? intent.act : null} onIntentDone={() => setIntent(null)} />,
                    onClose: () => setOpenId(null),
                  }
                : null
            }
          >
            <div className="rq-bar cert-bar">
              <SearchField value={search} onChange={setSearch} label={tx(C.search)} clearLabel="×" />
              <button type="button" className="chip cert-bar__closed" aria-pressed={showClosed} onClick={() => setShowClosed((v) => !v)}>
                {tx(C.showClosed)}
              </button>
            </div>
            {failed ? (
              <ErrorState error={failed.error} onRetry={() => lists.forEach((l) => void l.refetch())} />
            ) : loading && lists.every((l) => !l.data) ? (
              <LoadingState />
            ) : none ? (
              <div className="sheet rq-blank">
                <EmptyState title={tx(C.empty)} hint={q ? undefined : tx(C.emptyHint)} />
              </div>
            ) : (
              <Board label={tx(C.flowLabel)} stages={stages} value={stage} onChange={setFocus} />
            )}
          </RequestQueue>
        )}
      </div>
      {requesting && category && <RequestDialog category={category} onClose={() => setRequesting(false)} onCreated={(id) => setOpenId(id)} />}
    </div>
  )
}
