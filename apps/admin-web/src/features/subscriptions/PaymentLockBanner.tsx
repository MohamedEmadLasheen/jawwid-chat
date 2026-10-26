import { useI18n } from '@/core/i18n/I18nProvider'
import { formatDay } from '@/features/instalments/copy'
import type { PaymentLock } from './api'
import { REASON_LABEL, S, useCopy } from './copy'
import './subscriptions.css'

/**
 * PD-30: a group locked for payment, as staff see it in the chat -- which
 * child, why, and that the parent and the teacher cannot write while staff
 * still can. Advisory: the server refuses their messages and calls itself.
 */
export function PaymentLockBanner({ lock }: { lock: PaymentLock | null | undefined }) {
  const tx = useCopy()
  const { locale } = useI18n()
  if (!lock || lock.children.length === 0) return null
  return (
    <div className="banner banner--warn sub-lock" role="status">
      <strong>{tx(S.lockedBanner)}</strong>
      <ul>
        {lock.children.map((c) => (
          <li key={c.id}>
            <bdi>{c.name}</bdi>
            {c.reasons && c.reasons.length > 0 && (
              <>
                {': '}
                {c.reasons.map((r) => tx(REASON_LABEL[r])).join(locale === 'ar' ? '، ' : ', ')}
                {c.overdue ? ` — ${c.overdue.label ?? ''} (${formatDay(c.overdue.dueDate, locale)})` : ''}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
