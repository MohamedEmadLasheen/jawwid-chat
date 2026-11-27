import { useI18n } from '@/core/i18n/I18nProvider'
import { moneyParts } from '@/features/instalments/copy'
import './finance.css'

/**
 * An amount in a list: the numeral in the display face, tabular, and its
 * currency small beside it. Every amount carries its own currency label, so a
 * column may hold more than one currency without ambiguity.
 */
export function Money({
  amountMinor,
  currency,
  size = 'md',
}: {
  amountMinor: number
  currency: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const { locale } = useI18n()
  const { number, unit } = moneyParts(amountMinor, currency, locale)
  return (
    <span className={size === 'md' ? 'money' : `money money--${size}`}>
      <span className="money__n" dir="ltr">
        {number}
      </span>
      <span className="money__c" dir="auto">
        {unit}
      </span>
    </span>
  )
}

export interface CurrencySum {
  currency: string
  count: number
  amountMinor: number
}

/** Sums per currency, the one with the most rows first: amounts in different currencies are never added. */
export function sumByCurrency(rows: ReadonlyArray<{ amountMinor: number; currency: string }>): CurrencySum[] {
  const by = new Map<string, CurrencySum>()
  for (const r of rows) {
    const s = by.get(r.currency) ?? { currency: r.currency, count: 0, amountMinor: 0 }
    s.count += 1
    s.amountMinor += r.amountMinor
    by.set(r.currency, s)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.amountMinor - a.amountMinor || a.currency.localeCompare(b.currency))
}
