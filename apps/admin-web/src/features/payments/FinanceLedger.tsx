import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { useDestinations } from '@/app/useDestinations'
import { entriesOf } from '@/app/navigation'
import { INSTALMENTS, countWords, moneyParts } from '@/features/instalments/copy'
import { useInstalments } from '@/features/instalments/hooks'
import type { Instalment, InstalmentStatus } from '@/features/instalments/api'
import { academyToday } from '@/features/schedule/viewState'
import { paymentKeys, paymentsApi } from './api'
import { FIN, PAYMENTS, RECEIPTS, useCopy } from './copy'
import { sumByCurrency, type CurrencySum } from './Money'
import './finance.css'

/**
 * The ruled ledger at the head of Instalments and Payments: what is late, what
 * is due today, what waits to be confirmed and what came in this month.
 *
 * Every figure is read from a list the page already offers (the instalments
 * list, the pending receipts, the transactions' own totals for the month). A
 * figure whose list did not answer is left out, never shown as zero. Sums are
 * kept per currency: the one with the most rows is the numeral, the others are
 * named beneath it.
 */

const ALL_OPEN = { responsible: 'all', paid: false, beforeGoLive: false } as const

interface Cell {
  key: string
  label: string
  value: ReactNode
  note?: string
  to?: string
  late?: boolean
}

export function FinanceLedger({ here }: { here: 'instalments' | 'payments' }) {
  const tx = useCopy()
  const { locale, number } = useI18n()
  const destinations = useDestinations()
  const paths = useMemo(() => destinations.flatMap(entriesOf).map((e) => e.path), [destinations])
  const pathTo = (suffix: string) => paths.find((p) => p.endsWith(suffix)) ?? null
  const instalmentsPath = pathTo('/instalments')
  const paymentsPath = pathTo('/payments')

  const instalments = useInstalments(ALL_OPEN)
  const receipts = useQuery({ queryKey: paymentKeys.receipts('pending'), queryFn: () => paymentsApi.receipts('pending'), staleTime: 60_000 })
  // This month so far, in the academy's calendar: the transactions list answers its totals with any page.
  const today = academyToday()
  const month = { from: `${today.slice(0, 7)}-01`, to: today }
  const collected = useQuery({
    queryKey: [...paymentKeys.all, 'month-total', month.from, month.to] as const,
    queryFn: () => paymentsApi.transactions(month, null, 1),
    staleTime: 60_000,
  })

  const money = (s: CurrencySum) => {
    const p = moneyParts(s.amountMinor, s.currency, locale)
    return (
      <>
        <span dir="ltr">{p.number}</span>
        <span className="ledger__unit" dir="auto">
          {p.unit}
        </span>
      </>
    )
  }
  const others = (sums: CurrencySum[]) => {
    if (sums.length < 2) return null
    const list = sums.slice(1).map((s) => {
      const p = moneyParts(s.amountMinor, s.currency, locale)
      // Isolated, so a Latin label such as US$ keeps its order inside Arabic text.
      return `\u2068${p.number} ${p.unit}\u2069`
    })
    return tx(FIN.also, { amounts: list.join(locale === 'ar' ? ' و' : ', ') })
  }
  const join = (...parts: Array<string | null>) => parts.filter(Boolean).join(' · ')

  const cells: Cell[] = []
  const instalmentCell = (status: InstalmentStatus, label: string, late = false): void => {
    const data = instalments.data
    if (!data) return
    const rows: Instalment[] = data.items.filter((r) => r.status === status)
    const count = data.counts[status]
    const sums = sumByCurrency(rows)
    cells.push({
      key: status,
      label,
      value: sums[0] ? money(sums[0]) : number(count),
      note: sums[0] ? join(countWords(count, INSTALMENTS, locale), others(sums)) : undefined,
      to: here === 'instalments' ? undefined : (instalmentsPath ?? undefined),
      late: late && count > 0,
    })
  }
  const receiptCell = (): void => {
    if (!receipts.data) return
    const n = receipts.data.counts.pending ?? receipts.data.items.length
    cells.push({ key: 'confirm', label: tx(FIN.toConfirm), value: number(n), note: countWords(n, RECEIPTS, locale), to: paymentsPath ?? undefined })
  }
  const collectedCell = (): void => {
    if (!collected.data) return
    const sums = collected.data.totals
      .map((t) => ({ currency: t.currency, count: t.count, amountMinor: t.netMinor }))
      .sort((a, b) => b.count - a.count || b.amountMinor - a.amountMinor)
    const count = sums.reduce((n, s) => n + s.count, 0)
    const monthName = new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'long', timeZone: 'UTC' }).format(new Date(`${month.from}T12:00:00Z`))
    cells.push({
      key: 'collected',
      label: tx(FIN.collected, { month: monthName }),
      value: sums[0] ? money(sums[0]) : number(0),
      note: sums[0] ? join(countWords(count, PAYMENTS, locale), others(sums)) : undefined,
      to: paymentsPath ? `${paymentsPath}?tab=transactions` : undefined,
    })
  }

  if (here === 'instalments') {
    instalmentCell('overdue', tx(FIN.late), true)
    instalmentCell('due', tx(FIN.dueToday))
    instalmentCell('upcoming', tx(FIN.upcoming))
    receiptCell()
    collectedCell()
  } else {
    receiptCell()
    collectedCell()
    instalmentCell('overdue', tx(FIN.late), true)
    instalmentCell('due', tx(FIN.dueToday))
  }
  if (cells.length === 0) return null

  return (
    <section className="fin" aria-label={tx(FIN.ledger)}>
      <div className="ledger fin__ledger">
        {cells.map((c) => {
          const className = c.late ? 'ledger__cell ledger__cell--late' : 'ledger__cell'
          const body = (
            <>
              <span className="ledger__label">{c.label}</span>
              <span className="ledger__value fin__value">{c.value}</span>
              {c.note && <span className="ledger__note">{c.note}</span>}
            </>
          )
          return c.to ? (
            <Link key={c.key} to={c.to} className={className}>
              {body}
            </Link>
          ) : (
            <div key={c.key} className={className}>
              {body}
            </div>
          )
        })}
      </div>
    </section>
  )
}
