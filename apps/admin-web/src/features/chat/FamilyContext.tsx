import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { formatDay, formatMoney } from '@/features/instalments/copy'
import { METHOD } from '@/features/payments/copy'
import { parentPath, profileKeys, profilesApi, studentPath, type FamilyBilling } from '@/features/profiles/api'
import { planLabel } from '@/features/profiles/copy'
import { useFamilyBilling, useMayOpenParentProfiles, useParent } from '@/features/profiles/hooks'
import { RecordFamilyPaymentDialog, RequestPaymentDialog } from '@/features/profiles/ProfileDialogs'
import { Avatar } from '@/shared/components/Avatar'
import { Icon } from '@/shared/components/Icon'
import type { ChatConversation } from './chatApi'
import { chatCopyFor } from './copy'
import '@/features/payments/payments.css'

const CHILDREN_SHOWN = 6

/** "18,000.00" and "EGP" apart, so the figure can be set large and its unit small. */
function moneyParts(amountMinor: number, currency: string, locale: 'ar' | 'en'): { figure: string; unit: string } {
  try {
    const fmt = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { style: 'currency', currency })
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2
    const parts = fmt.formatToParts(amountMinor / 10 ** digits)
    const figure = parts.filter((p) => p.type !== 'currency' && p.type !== 'literal').map((p) => p.value).join('')
    return { figure, unit: parts.find((p) => p.type === 'currency')?.value ?? currency }
  } catch {
    return { figure: (amountMinor / 100).toFixed(2), unit: currency }
  }
}

/**
 * The family behind a conversation, beside the thread: who the parent is, the
 * children and their teachers, the package, the last payment, what is due and
 * any open request, with the three things staff do next.
 *
 * Read through the Parent Profile's own endpoints, and only for a viewer the
 * profile is offered to. Whatever the server refuses (403, 404) is simply not
 * shown: no zero, no placeholder, no message. Money is the server's answer or
 * it is absent.
 */
export function FamilyContext({ c }: { c: ChatConversation }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const mayOpen = useMayOpenParentProfiles()
  const [dialog, setDialog] = useState<'record' | 'request' | null>(null)

  const contact = (c.members ?? []).find((m) => m.actorKind === 'contact')
  const parent = useParent(mayOpen && contact ? contact.actorId : '')
  const billing = useFamilyBilling(mayOpen && c.familyId ? c.familyId : undefined)

  // Only the family this conversation belongs to.
  const p = parent.data && parent.data.family.id === c.familyId ? parent.data : null
  const b = billing.data ?? null
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

  if (!p && !b) return null

  const phone = p?.contact.phone ?? null
  const hiddenChildren = (p?.children.length ?? 0) - children.length

  return (
    <section className="cw-fam" aria-label={copy.famTitle}>
      {p && (
        <div className="cw-fam__who">
          <span className="cw-who cw-who--parent">
            <Avatar name={p.name} seed={p.id} src={p.avatarUrl} />
          </span>
          <div className="cw-fam__id">
            <Link className="cw-fam__name" to={parentPath(p.id)} dir="auto">
              {p.name}
            </Link>
            <span className="cw-fam__sub">
              <span dir="auto">{p.family.name}</span>
              {phone && (
                <bdi dir="ltr" className="cw-fam__phone">
                  {phone}
                </bdi>
              )}
            </span>
          </div>
        </div>
      )}

      {b && <AmountDue billing={b} />}

      <dl className="cw-fam__rows" hidden={children.length === 0 && !b}>
        {children.length > 0 && (
          <div className="cw-fam__row">
            <dt>{copy.famChildren}</dt>
            <dd>
              <ul className="cw-fam__children">
                {children.map((child, i) => {
                  const teacher = students[i]?.data?.teacher ?? null
                  return (
                    <li key={child.id}>
                      <Link to={studentPath(child.id)} dir="auto">
                        {child.name}
                      </Link>
                      {teacher && (
                        <span className="cw-fam__teacher" dir="auto" title={copy.teacherOf(teacher.name)}>
                          {teacher.name}
                        </span>
                      )}
                    </li>
                  )
                })}
                {hiddenChildren > 0 && <li className="cw-fam__teacher">{copy.famMoreChildren(hiddenChildren)}</li>}
              </ul>
            </dd>
          </div>
        )}
        {b && <MoneyRows billing={b} />}
      </dl>

      <div className="cw-fam__actions">
        {b?.canRecord && (
          <>
            <button type="button" className="btn btn--sm" onClick={() => setDialog('record')}>
              {copy.famRecord}
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setDialog('request')}>
              {copy.famRequest}
            </button>
          </>
        )}
        {p && (
          <Link className="cw-fam__profile" to={parentPath(p.id)}>
            {copy.famProfile}
            <Icon name="chevronForward" size={14} />
          </Link>
        )}
      </div>

      {b && dialog === 'record' && <RecordFamilyPaymentDialog billing={b} children={p?.children ?? []} onClose={() => setDialog(null)} />}
      {b && dialog === 'request' && <RequestPaymentDialog billing={b} children={p?.children ?? []} onClose={() => setDialog(null)} />}
    </section>
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
          const { figure, unit } = moneyParts(t.outstandingMinor, t.currency, locale)
          return (
            <div key={t.currency} className={late ? 'cw-fam__sum cw-fam__sum--late' : 'cw-fam__sum'}>
              <span className="cw-fam__figure">
                <bdi dir="ltr" className="numeral">
                  {figure}
                </bdi>
                <span className="cw-fam__unit">{unit}</span>
              </span>
              <span className="cw-fam__note">
                {late ? (
                  <>
                    <span className="cw-fam__dot" aria-hidden="true" />
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
      {billing.planMonths !== null && (
        <div className="cw-fam__row">
          <dt>{copy.famPackage}</dt>
          <dd>{planLabel(billing.planMonths, locale)}</dd>
        </div>
      )}
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
            <span className="cw-fam__meta" dir="auto">
              {request.label}
            </span>
          </dd>
        </div>
      )}
    </>
  )
}
