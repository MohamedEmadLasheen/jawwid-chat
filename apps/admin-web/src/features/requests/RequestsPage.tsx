import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useDestinations } from '@/app/useDestinations'
import { entriesOf } from '@/app/navigation'
import { useText, type Bilingual } from '@/features/admin/copy'
import { certificateKeys, certificatesApi, type Certificate, type CertificateCategory, type StateGroup } from '@/features/certificates/api'
import { stateLabel } from '@/features/certificates/copy'
import { useCertificateAccess } from '@/features/certificates/hooks'
import { formatMoney } from '@/features/payments/copy'
import { paymentKeys, paymentsApi } from '@/features/payments/api'
import { pipelineApi, pipelineKeys, type LeadQuery } from '@/features/sales-pipeline/api'
import { subscriptionKeys, subscriptionsApi } from '@/features/subscriptions/api'
import { trialKeys, trialsApi, type NewStudentDto } from '@/features/trials/api'
import { newStudentStatus } from '@/features/trials/newStudentsCopy'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon, type IconName } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { Age, QueueGroup, QueueRow, RequestQueue, academyDayOf, dayName, waitedOvernight, sentence } from '@/shared/components/RequestQueue'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, LoadingState } from '@/shared/components/States'
import { RQ } from './copy'

/**
 * Requests, the hub: what is waiting on someone across Trial lessons, New
 * students, Certificates, Renewals, Receipts and the Sales pipeline's due
 * follow-ups, in one inbox. Its one question: what has waited longest?
 *
 * The types are tabs with their counts. The body is two sheets by wait (what
 * has waited since before today first, then today's), in an order named by
 * need. Each row says why it is here in one sentence, sets its age apart, and
 * opens on its own page with that request selected, where the work is done.
 * It only reads; a list is asked for only when the account has that list's
 * page, and one the server refuses is left out.
 */

type Kind = 'trial' | 'family' | 'certificate' | 'renewal' | 'receipt' | 'lead'
type Filter = Kind | 'all'
type Order = 'longest' | 'newest'
const KINDS: readonly Kind[] = ['trial', 'family', 'certificate', 'renewal', 'receipt', 'lead']

const ICON: Record<Kind, IconName> = { trial: 'trials', family: 'newStudents', certificate: 'certificates', renewal: 'instalments', receipt: 'payments', lead: 'pipeline' }
const ONE = { trial: RQ.oneTrial, family: RQ.oneFamily, certificate: RQ.oneCertificate, renewal: RQ.oneRenewal, receipt: RQ.oneReceipt, lead: RQ.oneLead } as const

/** The certificate lists that still wait on someone: not yet sent, not closed. */
const OPEN_GROUPS: readonly StateGroup[] = ['suggested', 'pending', 'in_progress', 'completed']
/** The due follow-ups: one read of the pipeline's own list, as many as one page holds. */
const DUE_LEADS: LeadQuery = { stage: '', q: '', followUp: 'due', limit: 100, offset: 0 }

interface Row {
  key: string
  kind: Kind
  who: string
  /** Why it is here, in one sentence. */
  why: ReactNode
  /** When the wait began. */
  since: string
  /** It has waited since before today on the academy's calendar. */
  late: boolean
  /** The age as words, when the plain age would mislead (a date with no time). */
  age?: ReactNode
  to: string
}

export function RequestsPage() {
  const { locale, number } = useI18n()
  const tx = useText()
  const line = (b: Bilingual, vars?: Record<string, string | null | undefined>) => sentence(tx(b), vars)
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
  const [order, setOrder] = useState<Order>('longest')

  // Only the pages this account has: the same list the rail is built from.
  const destinations = useDestinations()
  const paths = useMemo(() => destinations.flatMap(entriesOf).map((e) => e.path), [destinations])
  const pathTo = (suffix: string) => paths.find((p) => p === suffix || p.endsWith(suffix)) ?? null
  const trialsPath = pathTo('/trials')
  const familiesPath = pathTo('/trials/new-students')
  const certificatesPath = pathTo('/certificates')
  const paymentsPath = pathTo('/payments')
  const pipelinePath = pathTo('/sales/pipeline')

  const read = { staleTime: 30_000, retry: false } as const
  const trials = useQuery({ queryKey: trialKeys.list, queryFn: () => trialsApi.list(), enabled: trialsPath !== null, ...read })
  const families = useQuery({ queryKey: trialKeys.newStudents, queryFn: trialsApi.newStudents, enabled: familiesPath !== null, ...read })
  const renewals = useQuery({ queryKey: subscriptionKeys.renewals(), queryFn: () => subscriptionsApi.renewalRequests(), enabled: paymentsPath !== null, ...read })
  const receipts = useQuery({ queryKey: paymentKeys.receipts('pending'), queryFn: () => paymentsApi.receipts('pending'), enabled: paymentsPath !== null, ...read })
  // The pipeline's list carries no contact (only the lead's own page reads that): the due follow-ups are safe to list.
  const leads = useQuery({ queryKey: pipelineKeys.list(DUE_LEADS), queryFn: () => pipelineApi.list(DUE_LEADS), enabled: pipelinePath !== null, ...read })
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

  const familyWhy = (s: NewStudentDto, status: ReturnType<typeof newStudentStatus>) => {
    if (status === 'unassigned') return line(RQ.whyUnassigned)
    if (status === 'locked') return line(RQ.whyLocked)
    if (s.enrolment?.parentSignup.state === 'code_waiting') return line(RQ.whyCode)
    const supervisor = s.enrolment?.supervisor?.name
    return supervisor ? line(RQ.whySignUp, { supervisor }) : line(RQ.whySignUpNobody)
  }
  const certificateWhy = (c: Certificate) => {
    const asker = c.projection === 'full' ? (c.requestedBy?.name ?? c.suggestedBy?.name ?? null) : c.requesterName
    const designer = c.assignedDesigner?.name ?? null
    switch (c.state) {
      case 'proposed':
        return line(RQ.whyProposed, { who: c.projection === 'full' ? (c.suggestedBy?.name ?? asker) : asker })
      case 'requested':
        return asker ? line(RQ.whyRequested, { who: asker }) : line(RQ.whyRequestedNobody)
      case 'in_design':
        return designer ? line(RQ.whyDesigning, { who: designer }) : line(RQ.whyDesigningNobody)
      case 'changes_requested':
        return line(RQ.whyChanges)
      case 'uploaded':
        return line(RQ.whyUploaded)
      case 'approved':
        return line(RQ.whyApproved)
      default:
        return tx(stateLabel(c.state))
    }
  }

  const rows = (() => {
    const out: Row[] = []
    if (trialsPath) {
      for (const t of trials.data?.trials ?? []) {
        if (t.outcome !== 'awaiting') continue
        out.push({
          key: `trial:${t.id}`, kind: 'trial', who: t.prospect.displayName, why: line(RQ.whyTrial, { teacher: t.teacher.name }),
          since: t.endsAt, late: waitedOvernight(t.endsAt), to: `${trialsPath}?filter=decision&open=${encodeURIComponent(t.id)}`,
        })
      }
    }
    if (familiesPath) {
      for (const s of families.data?.students ?? []) {
        const status = newStudentStatus(s)
        if (status === 'signed_up') continue
        const since = s.enrolment?.assignedAt ?? s.recordedAt
        out.push({
          key: `family:${s.trialId}`, kind: 'family', who: s.parent.name, why: familyWhy(s, status), since, late: waitedOvernight(since),
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
            key: `certificate:${c.id}`, kind: 'certificate', who: c.printedName, why: certificateWhy(c),
            since: c.requestedAt, late: waitedOvernight(c.requestedAt), to: `${certificatesPath}?category=${c.category}&id=${encodeURIComponent(c.id)}`,
          })
        }
      }
    }
    if (paymentsPath) {
      for (const r of renewals.data?.requests ?? []) {
        if (r.renewed) continue
        out.push({
          key: `renewal:${r.id}`, kind: 'renewal', who: r.child.name, why: line(RQ.whyRenewal, { parent: r.parentName }),
          since: r.requestedAt, late: waitedOvernight(r.requestedAt), to: `${paymentsPath}?tab=renewals`,
        })
      }
      for (const r of receipts.data?.items ?? []) {
        out.push({
          key: `receipt:${r.id}`, kind: 'receipt', who: r.family?.name ?? r.label,
          why: line(RQ.whyReceipt, { amount: formatMoney(r.amountMinor, r.currency, locale), label: r.label }),
          since: r.uploadedAt, late: waitedOvernight(r.uploadedAt), to: paymentsPath,
        })
      }
    }
    if (pipelinePath) {
      for (const l of leads.data?.leads ?? []) {
        if (!l.followUpDue || !l.nextFollowUpOn) continue
        // A follow-up is a day, not a moment: it waits from the start of that day.
        const since = `${l.nextFollowUpOn}T00:00:00Z`
        const today = l.nextFollowUpOn >= academyDayOf(new Date())
        const when = dayName(l.nextFollowUpOn, locale)
        out.push({
          key: `lead:${l.id}`, kind: 'lead', who: l.displayName,
          why: l.owner ? line(RQ.whyLead, { owner: l.owner.name, date: when }) : line(RQ.whyLeadNobody, { date: when }),
          since, late: !today, age: today ? <span className="rq-age">{tx(RQ.dueToday)}</span> : undefined,
          to: `${pipelinePath}?open=${encodeURIComponent(l.id)}`,
        })
      }
    }
    // The longest wait first, or the newest: the order is named on the page.
    return out.sort((x, y) => (order === 'longest' ? x.since.localeCompare(y.since) : y.since.localeCompare(x.since)))
  })()

  // A type is offered when the account has its page and the server did not refuse its list;
  // null leaves it out, false means its list has not arrived yet (its tab shows no number).
  const state = (path: string | null, q: { data: unknown; isError: boolean }) => (!path || q.isError ? null : q.data !== undefined)
  const arrived: Record<Kind, boolean | null> = {
    trial: state(trialsPath, trials),
    family: state(familiesPath, families),
    certificate: lists.length === 0 || certificates.every((c) => c.isError) ? null : certificates.every((c) => c.data !== undefined || c.isError),
    renewal: state(paymentsPath, renewals),
    receipt: state(paymentsPath, receipts),
    lead: state(pipelinePath, leads),
  }
  const offered = KINDS.filter((k) => arrived[k] !== null)
  const settled = ![trials, families, renewals, receipts, leads, access, ...certificates].some((q) => q.isLoading)
  const longer = certificates.some((c) => !!c.data?.nextCursor)
  const moreLeads = (leads.data?.dueCount ?? 0) > (leads.data?.leads.length ?? 0)
  const countOf = (k: Kind) => (arrived[k] ? rows.filter((r) => r.kind === k).length : undefined)
  const all = offered.every((k) => arrived[k]) ? rows.length : undefined
  const shown = filter === 'all' ? rows : rows.filter((r) => r.kind === filter)
  const before = shown.filter((r) => r.late)
  const today = shown.filter((r) => !r.late)

  const row = (r: Row) => (
    <QueueRow
      key={r.key}
      lead={
        <span className="rq-type">
          <Icon name={ICON[r.kind]} size={18} />
          <span className="rq-type__word">{tx(ONE[r.kind])}</span>
        </span>
      }
      title={r.who}
      sub={r.why}
      tag={r.age ?? <Age iso={r.since} late={r.late} />}
      actions={
        <RowActions
          label={r.who}
          primary={<Link className="btn btn--sm" to={r.to} aria-label={`${tx(RQ.open)} ${r.who}`}>{tx(RQ.open)}</Link>}
        />
      }
    />
  )

  return (
    <div className="page rq-page rq-hub">
      <div className="page__inner">
        <PageHeader
          title={tx(RQ.title)}
          actions={
            offered.length > 0 ? (
              <div className="switch" role="group" aria-label={tx(RQ.orderLabel)}>
                {(['longest', 'newest'] as const).map((o) => (
                  <button key={o} type="button" className="switch__item" aria-pressed={order === o} onClick={() => setOrder(o)}>
                    {tx(o === 'longest' ? RQ.longest : RQ.newest)}
                  </button>
                ))}
              </div>
            ) : undefined
          }
          tabs={
            offered.length > 1 ? (
              <FilterChips<Filter>
                variant="tabs"
                label={tx(RQ.types)}
                value={filter}
                onChange={(next) => setFilter(next === filter ? 'all' : next)}
                formatCount={(n) => number(n)}
                options={[
                  { value: 'all', label: tx(RQ.all), count: all },
                  ...offered.map((k) => ({ value: k, label: tx(RQ[k]), count: countOf(k) })),
                ]}
              />
            ) : undefined
          }
        />
        <RequestQueue label={tx(RQ.title)} detail={null}>
          {offered.length === 0 && settled ? (
            <div className="sheet rq-blank"><EmptyState icon="lock" title={tx(RQ.none)} hint={tx(RQ.noneHint)} /></div>
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
          {moreLeads && (filter === 'all' || filter === 'lead') && <p className="rq-note rq-more">{tx(RQ.moreLeads)}</p>}
        </RequestQueue>
      </div>
    </div>
  )
}
