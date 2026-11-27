import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useDestinations } from '@/app/useDestinations'
import { entriesOf } from '@/app/navigation'
import { useText } from '@/features/admin/copy'
import { certificateKeys, certificatesApi, type CertificateCategory, type StateGroup } from '@/features/certificates/api'
import { stateLabel } from '@/features/certificates/copy'
import { useCertificateAccess } from '@/features/certificates/hooks'
import { formatMoney } from '@/features/payments/copy'
import { paymentKeys, paymentsApi } from '@/features/payments/api'
import { subscriptionKeys, subscriptionsApi } from '@/features/subscriptions/api'
import { trialKeys, trialsApi } from '@/features/trials/api'
import { STATUS, newStudentStatus } from '@/features/trials/newStudentsCopy'
import { Icon, type IconName } from '@/shared/components/Icon'
import { PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { Age, QueueGroup, QueueRow, RequestQueue, waitedOvernight } from '@/shared/components/RequestQueue'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, LoadingState } from '@/shared/components/States'
import { RQ } from './copy'

/**
 * Requests, the hub: what is waiting on Trial lessons, New students,
 * Certificates, Renewal requests and Receipts, in one place. The masthead
 * counts each type and is the type filter; the body is two sheets by wait --
 * what has waited since before today first, then today's. It only reads: each
 * row says what is being asked and opens on its own page with that request
 * selected, where the work is done. A list is asked for only when the account
 * has that list's page, and one the server refuses is left out.
 */

type Kind = 'trial' | 'family' | 'certificate' | 'renewal' | 'receipt'
type Filter = Kind | 'all'
const KINDS: readonly Kind[] = ['trial', 'family', 'certificate', 'renewal', 'receipt']

const ICON: Record<Kind, IconName> = { trial: 'trials', family: 'newStudents', certificate: 'certificates', renewal: 'instalments', receipt: 'payments' }
const ONE = { trial: RQ.oneTrial, family: RQ.oneFamily, certificate: RQ.oneCertificate, renewal: RQ.oneRenewal, receipt: RQ.oneReceipt } as const

/** The certificate lists that still wait on someone: not yet sent, not closed. */
const OPEN_GROUPS: readonly StateGroup[] = ['suggested', 'pending', 'in_progress', 'completed']

interface Row {
  key: string
  kind: Kind
  who: string
  sub?: string
  owner: string | null
  /** When the wait began. */
  since: string
  /** It has waited since before today on the academy's calendar. */
  late: boolean
  /** What is being asked, in one line. */
  ask: string
  to: string
}

export function RequestsPage() {
  const { locale, number } = useI18n()
  const tx = useText()
  const [params, setParams] = useSearchParams()
  const asked = params.get('type')
  const filter: Filter = KINDS.find((k) => k === asked) ?? 'all'
  const setFilter = (next: Filter) =>
    setParams((current) => {
      const p = new URLSearchParams(current)
      if (next === 'all') p.delete('type')
      else p.set('type', next)
      return p
    }, { replace: true })

  // Only the pages this account has: the same list the rail is built from.
  const destinations = useDestinations()
  const paths = useMemo(() => destinations.flatMap(entriesOf).map((e) => e.path), [destinations])
  const pathTo = (suffix: string) => paths.find((p) => p === suffix || p.endsWith(suffix)) ?? null
  const trialsPath = pathTo('/trials')
  const familiesPath = pathTo('/trials/new-students')
  const certificatesPath = pathTo('/certificates')
  const paymentsPath = pathTo('/payments')

  const read = { staleTime: 30_000, retry: false } as const
  const trials = useQuery({ queryKey: trialKeys.list, queryFn: () => trialsApi.list(), enabled: trialsPath !== null, ...read })
  const families = useQuery({ queryKey: trialKeys.newStudents, queryFn: trialsApi.newStudents, enabled: familiesPath !== null, ...read })
  const renewals = useQuery({ queryKey: subscriptionKeys.renewals(), queryFn: () => subscriptionsApi.renewalRequests(), enabled: paymentsPath !== null, ...read })
  const receipts = useQuery({ queryKey: paymentKeys.receipts('pending'), queryFn: () => paymentsApi.receipts('pending'), enabled: paymentsPath !== null, ...read })
  // Certificates come per category and per list; the access answer says which this account reaches.
  const access = useCertificateAccess(certificatesPath !== null)
  const a = access.data
  const lists = useMemo(() => {
    if (!a?.canOpen) return []
    const reach = (c: CertificateCategory) => a.design || a.categories[c].request || a.categories[c].oversee
    const designerOnly = a.design && !a.categories.student.request && !a.categories.teacher.request
    return (['student', 'teacher'] as const)
      .filter(reach)
      .flatMap((category) => OPEN_GROUPS.filter((g) => !(designerOnly && g === 'suggested')).map((status) => ({ category, status })))
  }, [a])
  const certificates = useQueries({
    queries: lists.map((q) => ({ queryKey: certificateKeys.list(q), queryFn: () => certificatesApi.list(q), ...read })),
  })

  const rows = (() => {
    const out: Row[] = []
    if (trialsPath) {
      for (const t of trials.data?.trials ?? []) {
        if (t.outcome !== 'awaiting') continue
        out.push({
          key: `trial:${t.id}`, kind: 'trial', who: t.prospect.displayName, sub: t.prospect.level ?? undefined, owner: t.teacher.name,
          since: t.endsAt, late: waitedOvernight(t.endsAt), ask: tx(RQ.askOutcome), to: `${trialsPath}?filter=decision&open=${encodeURIComponent(t.id)}`,
        })
      }
    }
    if (familiesPath) {
      for (const s of families.data?.students ?? []) {
        const status = newStudentStatus(s)
        if (status === 'signed_up') continue
        const since = s.enrolment?.assignedAt ?? s.recordedAt
        out.push({
          key: `family:${s.trialId}`, kind: 'family', who: s.parent.name, sub: s.children.map((c) => c.name).join(' · '), owner: s.enrolment?.supervisor?.name ?? null,
          since, late: waitedOvernight(since),
          ask: status === 'unassigned' ? tx(RQ.askSupervisor) : status === 'locked' ? tx(STATUS.locked.label) : tx(RQ.askSignUp),
          to: `${familiesPath}?filter=${status === 'unassigned' ? 'unassigned' : 'waiting'}&open=${encodeURIComponent(s.trialId)}`,
        })
      }
    }
    if (certificatesPath) {
      const seen = new Set<string>()
      for (const list of certificates) {
        for (const c of list.data?.certificates ?? []) {
          if (seen.has(c.id)) continue
          seen.add(c.id)
          out.push({
            key: `certificate:${c.id}`, kind: 'certificate', who: c.printedName, sub: c.type ? tx({ en: c.type.labelEn, ar: c.type.labelAr }) : c.title,
            owner: c.projection === 'full' ? (c.requestedBy?.name ?? c.suggestedBy?.name ?? null) : c.requesterName,
            since: c.requestedAt, late: waitedOvernight(c.requestedAt), ask: tx(stateLabel(c.state)),
            to: `${certificatesPath}?category=${c.category}&id=${encodeURIComponent(c.id)}`,
          })
        }
      }
    }
    if (paymentsPath) {
      for (const r of renewals.data?.requests ?? []) {
        if (r.renewed) continue
        out.push({
          key: `renewal:${r.id}`, kind: 'renewal', who: r.child.name, sub: r.parentName, owner: null,
          since: r.requestedAt, late: waitedOvernight(r.requestedAt), ask: tx(RQ.renewalAsked), to: `${paymentsPath}?tab=renewals`,
        })
      }
      for (const r of receipts.data?.items ?? []) {
        out.push({
          key: `receipt:${r.id}`, kind: 'receipt', who: r.family?.name ?? r.label, sub: `${formatMoney(r.amountMinor, r.currency, locale)} · ${r.label}`, owner: r.uploadedBy?.name ?? null,
          since: r.uploadedAt, late: waitedOvernight(r.uploadedAt), ask: tx(RQ.toConfirm), to: paymentsPath,
        })
      }
    }
    // The longest wait is first.
    return out.sort((x, y) => x.since.localeCompare(y.since))
  })()

  // A type is in the masthead when the account has its page and the server did not refuse its list;
  // null leaves it out, false means its list has not arrived yet (the figure shows no number).
  const state = (path: string | null, q: { data: unknown; isError: boolean }) => (!path || q.isError ? null : q.data !== undefined)
  const arrived: Record<Kind, boolean | null> = {
    trial: state(trialsPath, trials),
    family: state(familiesPath, families),
    certificate: lists.length === 0 || certificates.every((c) => c.isError) ? null : certificates.every((c) => c.data !== undefined || c.isError),
    renewal: state(paymentsPath, renewals),
    receipt: state(paymentsPath, receipts),
  }
  const offered = KINDS.filter((k) => arrived[k] !== null)
  const lateOf = (k: Kind) => rows.filter((r) => r.late && r.kind === k).length
  const settled = ![trials, families, renewals, receipts, access, ...certificates].some((q) => q.isLoading)
  const longer = certificates.some((c) => !!c.data?.nextCursor)
  // The masthead: one figure per type this account reaches. A figure is the type filter; pressing it again shows every type.
  const figures: MastFigure[] = offered.map((k) => {
    const count = arrived[k] ? rows.filter((r) => r.kind === k).length : null
    const late = lateOf(k)
    return {
      key: k,
      label: tx(RQ[k]),
      value: count === null ? '–' : `${number(count)}${k === 'certificate' && longer ? '+' : ''}`,
      note: late > 0 ? tx(RQ.lateCount).replace('{n}', number(late)) : undefined,
      tone: count === 0 ? 'quiet' : undefined,
      onClick: () => setFilter(filter === k ? 'all' : k),
      pressed: filter === k,
    }
  })
  const shown = filter === 'all' ? rows : rows.filter((r) => r.kind === filter)
  const before = shown.filter((r) => r.late)
  const today = shown.filter((r) => !r.late)

  const row = (r: Row) => (
    <QueueRow
      key={r.key}
      lead={
        <span className="rq-type">
          <span className="rq-type__tile"><Icon name={ICON[r.kind]} size={18} /></span>
          <span className="rq-type__word">{tx(ONE[r.kind])}</span>
        </span>
      }
      title={r.who}
      sub={
        <>
          <span className="rq-ask">{r.ask}</span>
          {r.sub && <> · <bdi>{r.sub}</bdi></>}
        </>
      }
      fact={r.owner ? <bdi>{r.owner}</bdi> : undefined}
      tag={<Age iso={r.since} late={r.late} />}
      actions={
        <RowActions
          label={r.who}
          primary={<Link className="btn btn--sm" to={r.to} aria-label={`${tx(RQ.open)} ${r.who}`}>{tx(RQ.open)}</Link>}
        />
      }
    />
  )

  return (
    <div className="page rq-page">
      <div className="page__inner">
        <PageHeader title={tx(RQ.title)} subtitle={tx(RQ.subtitle)} figures={figures.length > 0 ? figures : undefined} />
        <RequestQueue label={tx(RQ.title)} detail={null}>
          {offered.length === 0 && settled ? (
            <div className="sheet rq-blank"><EmptyState icon="lock" title={tx(RQ.none)} /></div>
          ) : !settled && rows.length === 0 ? (
            <LoadingState />
          ) : shown.length === 0 ? (
            <div className="sheet rq-blank">
              <EmptyState title={tx(filter === 'all' ? RQ.empty : RQ.emptyType)} hint={filter === 'all' ? tx(RQ.emptyHint) : undefined} />
            </div>
          ) : (
            <>
              {before.length > 0 && (
                <QueueGroup title={tx(RQ.before)} count={before.length} tone="urgent">
                  {before.map(row)}
                </QueueGroup>
              )}
              {today.length > 0 && (
                <QueueGroup title={tx(RQ.today)} count={today.length}>
                  {today.map(row)}
                </QueueGroup>
              )}
            </>
          )}
          {longer && (filter === 'all' || filter === 'certificate') && <p className="rq-note rq-more">{tx(RQ.more)}</p>}
        </RequestQueue>
      </div>
    </div>
  )
}
