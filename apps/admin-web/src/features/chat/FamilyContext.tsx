import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { METHOD, formatDay, formatMoney } from '@/features/payments/copy'
import { parentPath, profileKeys, profilesApi, studentPath, type FamilyBilling, type ParentProfile } from '@/features/profiles/api'
import { planLabel } from '@/features/profiles/copy'
import { useFamilyBilling, useMayOpenParentProfiles, useParent } from '@/features/profiles/hooks'
import { RecordFamilyPaymentDialog, RequestPaymentDialog } from '@/features/profiles/ProfileDialogs'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import type { ChatConversation } from './chatApi'
import { lessonWhen } from './chatView'
import { chatCopyFor } from './copy'
import '@/features/payments/payments.css'

const CHILDREN_SHOWN = 6

/**
 * The payments formatter's own string, taken apart only so its figure can be
 * set large: the currency stays on the side the formatter puts it, the same
 * side as every other amount in the panel.
 */
export function moneySplit(amountMinor: number, currency: string, locale: 'ar' | 'en'): { before: string; figure: string; after: string } {
  const text = formatMoney(amountMinor, currency, locale).replace(/[‎‏؜]/g, '')
  const m = /^(\D*)(\d(?:.*\d)?)(\D*)$/.exec(text)
  return m ? { before: m[1]!.trim(), figure: m[2]!, after: m[3]!.trim() } : { before: '', figure: text, after: '' }
}

/**
 * The family behind a conversation, read through the Parent Profile's own
 * endpoints and only for a viewer the profile is offered to. Whatever the
 * server refuses (403, 404) is simply absent: no zero, no placeholder, no
 * message. Money is the server's answer or it is not shown.
 */
export function useFamily(c: Pick<ChatConversation, 'familyId' | 'members'>): {
  offered: boolean
  pending: boolean
  parent: ParentProfile | null
  billing: FamilyBilling | null
} {
  const mayOpen = useMayOpenParentProfiles()
  const contact = (c.members ?? []).find((m) => m.actorKind === 'contact')
  const parent = useParent(mayOpen && contact && c.familyId ? contact.actorId : '')
  const billing = useFamilyBilling(mayOpen && c.familyId ? c.familyId : undefined)
  // Only the family this conversation belongs to.
  const p = parent.data && parent.data.family.id === c.familyId ? parent.data : null
  return {
    offered: mayOpen && !!c.familyId,
    pending: mayOpen && !!c.familyId && (parent.isLoading || billing.isLoading),
    parent: p,
    billing: billing.data ?? null,
  }
}

/**
 * The family's one urgent fact, for the thread header: money that is late as a
 * solid terracotta tag, else what is due in ink, else nothing. It opens the
 * panel when the panel is not already showing.
 */
export function FamilyFact({ familyId, onOpen }: { familyId: string; onOpen?: () => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const mayOpen = useMayOpenParentProfiles()
  const billing = useFamilyBilling(mayOpen ? familyId : undefined)
  const totals = billing.data?.totals ?? []
  const late = totals.find((t) => t.overdueMinor > 0)
  const due = totals.find((t) => t.outstandingMinor > 0)
  if (!late && !due) return null
  const fact = late ? (
    <Badge tone="danger">{copy.lateTag(formatMoney(late.overdueMinor, late.currency, locale))}</Badge>
  ) : (
    <span className="cw-head__due">{copy.dueTag(formatMoney(due!.outstandingMinor, due!.currency, locale))}</span>
  )
  return onOpen ? (
    <button type="button" className="cw-head__fact" onClick={onOpen} title={copy.panelFamily}>
      {fact}
    </button>
  ) : (
    <span className="cw-head__fact">{fact}</span>
  )
}

/**
 * The panel's Family tab. Money first, on its own sheet, with the one thing
 * staff do next as its single solid button; then the children with their
 * teacher and next lesson; then the parent and how to reach them.
 */
export function FamilyTab({ parent: p, billing: b }: { parent: ParentProfile | null; billing: FamilyBilling | null }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const [dialog, setDialog] = useState<'record' | 'request' | null>(null)

  const children = (p?.children ?? []).slice(0, CHILDREN_SHOWN)
  const students = useQueries({
    queries: children.map((child) => ({
      queryKey: profileKeys.student(child.id),
      queryFn: () => profilesApi.student(child.id),
      staleTime: 5 * 60_000,
      // A child outside this viewer's scope answers 404: asked once, then left without a teacher's name.
      retry: false,
    })),
  })
  const hiddenChildren = (p?.children.length ?? 0) - children.length
  const phone = p?.contact.phone ?? null

  if (!p && !b) return <p className="cw-fam__none">{copy.famNone}</p>

  return (
    <div className="cw-fam">
      {b && (
        <section className="sheet cw-money" aria-label={copy.famMoney}>
          <AmountDue billing={b} />
          <dl className="cw-fam__rows">
            <MoneyRows billing={b} />
          </dl>
          <div className="cw-money__actions">
            {b.canRecord && (
              <button type="button" className="btn btn--primary" onClick={() => setDialog('record')}>
                {copy.famRecord}
              </button>
            )}
            {b.canRecord && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDialog('request')}>
                {copy.famRequest}
              </button>
            )}
            {p && (
              <Link className="btn btn--ghost btn--sm" to={parentPath(p.id)}>
                {copy.famProfile}
              </Link>
            )}
          </div>
        </section>
      )}

      {children.length > 0 && (
        <section className="aside-group" aria-label={copy.famChildren}>
          <h3 className="aside-group__title">{copy.famChildren}</h3>
          <ul className="cw-fam__children">
            {children.map((child, i) => {
              const student = students[i]?.data
              const next = (student?.schedule ?? [])
                .map((slot) => slot.nextStartsAt)
                .filter((x): x is string => !!x)
                .sort()[0]
              return (
                <li key={child.id}>
                  <Link className="cw-fam__child" to={studentPath(child.id)}>
                    <bdi>{child.name}</bdi>
                  </Link>
                  {student?.teacher && (
                    <span className="cw-fam__teacher" title={copy.teacherOf(student.teacher.name)}>
                      <bdi>{student.teacher.name}</bdi>
                    </span>
                  )}
                  {next && <span className="cw-fam__next">{copy.famNextLesson(lessonWhen(next, locale))}</span>}
                </li>
              )
            })}
            {hiddenChildren > 0 && <li className="cw-fam__teacher">{copy.famMoreChildren(hiddenChildren)}</li>}
          </ul>
        </section>
      )}

      {p && (
        <section className="aside-group" aria-label={copy.famParent}>
          <h3 className="aside-group__title">{copy.famParent}</h3>
          <div className="cw-fam__who">
            <span className="cw-who cw-who--parent">
              <Avatar name={p.name} seed={p.id} src={p.avatarUrl} />
            </span>
            <div className="cw-fam__id">
              <Link className="cw-fam__name" to={parentPath(p.id)}>
                <bdi>{p.name}</bdi>
              </Link>
              <span className="cw-fam__sub">
                <bdi>{p.family.name}</bdi>
              </span>
            </div>
          </div>
          {phone && (
            <p className="cw-fam__phone-row">
              <span className="cw-fam__label">{copy.famPhone}</span>
              <bdi dir="ltr" className="cw-fam__phone">
                {phone}
              </bdi>
            </p>
          )}
          {!b && (
            <Link className="btn btn--ghost btn--sm cw-fam__file" to={parentPath(p.id)}>
              {copy.famProfile}
            </Link>
          )}
        </section>
      )}

      {b && dialog === 'record' && <RecordFamilyPaymentDialog billing={b} children={p?.children ?? []} onClose={() => setDialog(null)} />}
      {b && dialog === 'request' && <RequestPaymentDialog billing={b} children={p?.children ?? []} onClose={() => setDialog(null)} />}
    </div>
  )
}

/** What the family owes, per currency: the figure in the display face, terracotta only when part of it is late. */
function AmountDue({ billing }: { billing: FamilyBilling }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  // No totals means the server has nothing to say about money here: say nothing.
  if (billing.totals.length === 0) return null
  const owing = billing.totals.filter((t) => t.outstandingMinor > 0)
  const open = billing.instalments.filter((i) => i.status === 'overdue' || i.status === 'due' || i.status === 'upcoming')
  const oldest = open.filter((i) => i.status === 'overdue').sort((x, y) => y.days - x.days)[0]
  const next = open.filter((i) => i.status !== 'overdue').sort((x, y) => x.dueDate.localeCompare(y.dueDate))[0]

  return (
    <div className="cw-fam__due">
      <span className="cw-fam__label">{copy.famDue}</span>
      {owing.length === 0 ? (
        <span className="cw-fam__settled">{copy.famNothingDue}</span>
      ) : (
        owing.map((t) => {
          const late = t.overdueMinor > 0
          const { before, figure, after } = moneySplit(t.outstandingMinor, t.currency, locale)
          return (
            <div key={t.currency} className={late ? 'cw-fam__sum cw-fam__sum--late' : 'cw-fam__sum'}>
              <span className="cw-fam__figure">
                {before && <span className="cw-fam__unit">{before}</span>}
                <bdi dir="ltr" className="numeral">
                  {figure}
                </bdi>
                {after && <span className="cw-fam__unit">{after}</span>}
              </span>
              <span className="cw-fam__note">
                {late ? (
                  <>
                    {copy.famOverdue(formatMoney(t.overdueMinor, t.currency, locale))}
                    {oldest && oldest.currency === t.currency && ` · ${copy.famLate(oldest.days)}`}
                  </>
                ) : (
                  next && next.currency === t.currency && copy.famNextDue(formatDay(next.dueDate, locale))
                )}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

function MoneyRows({ billing }: { billing: FamilyBilling }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const last = billing.payments
    .filter((x) => !x.voided)
    .sort((x, y) => y.paidOn.localeCompare(x.paidOn) || y.recordedAt.localeCompare(x.recordedAt))[0]
  const request = billing.requests.find((r) => r.status === 'open')
  const method = last ? METHOD[last.method] : undefined

  return (
    <>
      {last && (
        <div className="cw-fam__row">
          <dt>{copy.famLastPayment}</dt>
          <dd>
            <bdi className="cw-fam__money">{formatMoney(last.amountMinor, last.currency, locale)}</bdi>
            <span className="cw-fam__meta">
              {formatDay(last.paidOn, locale)}
              {method && ` · ${locale === 'ar' ? method.ar : method.en}`}
            </span>
          </dd>
        </div>
      )}
      {request && (
        <div className="cw-fam__row">
          <dt>{copy.famOpenRequest}</dt>
          <dd>
            <bdi className="cw-fam__money">{formatMoney(request.remainingMinor, request.currency, locale)}</bdi>
            <span className="cw-fam__meta">
              <bdi>{request.label}</bdi>
            </span>
          </dd>
        </div>
      )}
      {billing.planMonths !== null && (
        <div className="cw-fam__row">
          <dt>{copy.famPackage}</dt>
          <dd>{planLabel(billing.planMonths, locale)}</dd>
        </div>
      )}
    </>
  )
}
