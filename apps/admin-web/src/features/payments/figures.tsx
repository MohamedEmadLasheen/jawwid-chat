import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { useDestinations } from '@/app/useDestinations'
import { entriesOf } from '@/app/navigation'
import { INSTALMENTS, countWords, moneyParts } from '@/features/instalments/copy'
import { useInstalments } from '@/features/instalments/hooks'
import type { InstalmentStatus } from '@/features/instalments/api'
import { academyToday } from '@/features/schedule/viewState'
import type { MastFigure } from '@/shared/components/PageHeader'
import { paymentKeys, paymentsApi } from './api'
import { FIN, PAYMENTS, RECEIPTS, useCopy } from './copy'
import { sumByCurrency, type CurrencySum } from './Money'

/**
 * The money figures the two finance mastheads open with: what is late, due
 * today and still to come, what waits to be confirmed and what came in this month.
 *
 * Each is read from a list the pages already offer (the instalments list, the
 * pending receipts, the transactions' own totals for the month). One whose
 * list did not answer is null and is left out, never shown as zero. Sums are
 * kept per currency: the one with the most rows is the figure, the others are
 * named in its note.
 */

const ALL_OPEN = { responsible: 'all', paid: false, beforeGoLive: false } as const

export interface FinanceFigures {
  late: MastFigure | null
  dueToday: MastFigure | null
  upcoming: MastFigure | null
  toConfirm: MastFigure | null
  collected: MastFigure | null
  /** Where the two pages live for this account (null: it may not open that page). */
  instalmentsPath: string | null
  paymentsPath: string | null
}

export function useFinanceFigures(): FinanceFigures {
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

  const others = (sums: CurrencySum[]) => {
    // Another currency that came to nothing (a voided payment) is not news.
    const rest = sums.slice(1).filter((s) => s.amountMinor !== 0)
    if (rest.length === 0) return null
    const list = rest.map((s) => {
      const p = moneyParts(s.amountMinor, s.currency, locale)
      // Isolated, so a Latin label such as US$ keeps its order inside Arabic text.
      return `⁨${p.number} ${p.unit}⁩`
    })
    return tx(FIN.also, { amounts: list.join(locale === 'ar' ? ' و' : ', ') })
  }
  // A note is a short sentence: its parts joined the way the language joins them, never with a middle dot.
  const join = (...parts: Array<string | null>) => parts.filter(Boolean).join(locale === 'ar' ? '، ' : ', ')
  /** A sum as a figure: the numeral, its currency as the unit. A count stands alone. */
  const figure = (key: string, label: string, sums: CurrencySum[], count: number, noteWords: string): MastFigure => {
    const first = sums[0]
    if (!first) return { key, label, value: number(count) }
    const p = moneyParts(first.amountMinor, first.currency, locale)
    return { key, label, value: p.number, unit: <bdi>{p.unit}</bdi>, note: join(noteWords, others(sums)) }
  }

  const instalment = (status: InstalmentStatus, label: string): MastFigure | null => {
    const data = instalments.data
    if (!data) return null
    const count = data.counts[status]
    return figure(status, label, sumByCurrency(data.items.filter((r) => r.status === status)), count, countWords(count, INSTALMENTS, locale))
  }

  const late = instalment('overdue', tx(FIN.late))
  if (late && (instalments.data?.counts.overdue ?? 0) > 0) late.tone = 'urgent'

  let toConfirm: MastFigure | null = null
  if (receipts.data) {
    const n = receipts.data.counts.pending ?? receipts.data.items.length
    toConfirm = { key: 'confirm', label: tx(FIN.toConfirm), value: number(n), note: countWords(n, RECEIPTS, locale), tone: n > 0 ? 'key' : undefined }
  }

  let collectedFigure: MastFigure | null = null
  if (collected.data) {
    const sums = collected.data.totals
      .map((t) => ({ currency: t.currency, count: t.count, amountMinor: t.netMinor }))
      .sort((a, b) => b.count - a.count || b.amountMinor - a.amountMinor)
    // The count is of the payments the figure sums (its currency); the other currencies are named in the note.
    const count = sums[0]?.count ?? 0
    const monthName = new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'long', timeZone: 'UTC' }).format(new Date(`${month.from}T12:00:00Z`))
    collectedFigure = figure('collected', tx(FIN.collected, { month: monthName }), sums, 0, countWords(count, PAYMENTS, locale))
  }

  return {
    late,
    dueToday: instalment('due', tx(FIN.dueToday)),
    upcoming: instalment('upcoming', tx(FIN.upcoming)),
    toConfirm,
    collected: collectedFigure,
    instalmentsPath,
    paymentsPath,
  }
}
