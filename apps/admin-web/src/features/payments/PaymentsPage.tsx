import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { LoadingState } from '@/shared/components/States'
import { LED, PAY, useCopy } from './copy'
import { RenewalRequestsPanel } from '@/features/subscriptions/RenewalRequestsPanel'
import { S } from '@/features/subscriptions/copy'
import { useBillingSettings, useLedgerAccess } from './hooks'
import { useFinanceFigures } from './figures'
import { AttemptsTab, StripeEventsTab, TransactionsTab } from './LedgerTabs'
import { ReceiptsDesk } from './ReceiptsDesk'
import { SettingsTab } from './SettingsTab'
import './payments.css'

type Tab = 'receipts' | 'transactions' | 'attempts' | 'events' | 'renewals' | 'settings'

/**
 * PD-27: the Payments area, under one masthead: what waits to be confirmed,
 * what came in this month, what is late and due today; its tabs on the band's
 * lower edge. Receipts is the review desk (the bank transfers parents
 * reported, waiting for a payment recorder); Transactions, Card attempts and
 * the reconcilers' Stripe events are the ledger; Settings holds the bank
 * account parents pay into, the invoice issuer, which reminders fire, and
 * whether Stripe is configured. Each tab offers only what the server says this
 * viewer may do (`canDecide`, `canEdit`, `canReconcile`); the server decides
 * each request again.
 */
export function PaymentsPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const [params, setParams] = useSearchParams()
  // The Stripe events tab is the reconcilers' only (the transactions list's `canReconcile`).
  const ledger = useLedgerAccess()
  const canReconcile = ledger.data === true
  const asked = params.get('tab')
  const tab: Tab =
    asked === 'settings' || asked === 'renewals' || asked === 'transactions' || asked === 'attempts'
      ? asked
      : asked === 'events' && canReconcile
        ? 'events'
        : 'receipts'
  // A link straight to the events tab waits for the server's word before falling back.
  const waiting = asked === 'events' && ledger.isLoading
  // W63: a paused card is said on every tab, not only in Settings.
  const cardPaused = useBillingSettings().data?.cardPaused === true
  const choose = (next: Tab) => {
    const p = new URLSearchParams(params)
    if (next === 'receipts') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
  }

  const figures = useFinanceFigures()
  const mast = [
    figures.toConfirm && { ...figures.toConfirm, onClick: () => choose('receipts') },
    figures.collected && { ...figures.collected, onClick: () => choose('transactions') },
    figures.late && (figures.instalmentsPath ? { ...figures.late, to: figures.instalmentsPath } : figures.late),
    figures.dueToday && (figures.instalmentsPath ? { ...figures.dueToday, to: figures.instalmentsPath } : figures.dueToday),
  ].filter((f): f is MastFigure => Boolean(f))

  // On a narrow screen the tabs scroll: the open one is brought to the middle of the strip,
  // again when the reconcilers' tab joins it and when the fonts settle the widths.
  const tabsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    const centre = () => {
      const strip = tabsRef.current?.querySelector<HTMLElement>('.seg')
      const open = strip?.querySelector<HTMLElement>('[aria-pressed="true"]')
      if (!live || !strip || !open) return
      const s = strip.getBoundingClientRect()
      const o = open.getBoundingClientRect()
      strip.scrollLeft += o.left + o.width / 2 - (s.left + s.width / 2)
    }
    centre()
    void document.fonts?.ready.then(centre)
    return () => {
      live = false
    }
  }, [tab, canReconcile, locale])

  return (
    // Receipts is a workspace: from 1100px the masthead stays put and the queue and the receipt each scroll on their own.
    <div className={tab === 'receipts' && !waiting ? 'page pay-page rq-page' : 'page pay-page'}>
      <div className="page__inner">
        <PageHeader
          eyebrow={eyebrow}
          title={tx(PAY.title)}
          subtitle={tx(PAY.subtitle)}
          status={
            cardPaused ? (
              // A compact state beside the title; the whole sentence is said once, just below, and on Settings.
              <span aria-hidden="true" title={tx(PAY.cardPausedBanner)}>
                <Badge tone="warn" dot>
                  {tx(PAY.cardPausedBadge)}
                </Badge>
              </span>
            ) : undefined
          }
          figures={mast}
          tabs={
            <div className="pay-tabs" ref={tabsRef}>
              <FilterChips<Tab>
                variant="tabs"
                label={tx(PAY.tabs)}
                value={tab}
                onChange={choose}
                options={[
                  { value: 'receipts', label: tx(PAY.receiptsTab) },
                  { value: 'transactions', label: tx(LED.transactionsTab) },
                  { value: 'attempts', label: tx(LED.attemptsTab) },
                  ...(canReconcile ? [{ value: 'events' as const, label: tx(LED.eventsTab) }] : []),
                  { value: 'renewals', label: tx(S.renewalsTitle) },
                  { value: 'settings', label: tx(PAY.settingsTab) },
                ]}
              />
            </div>
          }
        />
        {cardPaused && (
          <p className="sr-only" role="status" data-testid="card-paused-banner">
            {tx(PAY.cardPausedBanner)}
          </p>
        )}
        {waiting ? (
          <LoadingState />
        ) : tab === 'receipts' ? (
          <ReceiptsDesk onSeeTransactions={() => choose('transactions')} />
        ) : tab === 'transactions' ? (
          <TransactionsTab onSeeReceipts={() => choose('receipts')} />
        ) : tab === 'attempts' ? (
          <AttemptsTab />
        ) : tab === 'events' ? (
          <StripeEventsTab />
        ) : tab === 'renewals' ? (
          <RenewalRequestsPanel />
        ) : (
          <SettingsTab />
        )}
        {!waiting && (tab === 'receipts' || tab === 'transactions') && <LedgerRules />}
      </div>
    </div>
  )
}

/** What protects the ledger, one line each. */
function LedgerRules() {
  const tx = useCopy()
  return (
    <aside className="pay-rules" aria-label={tx(PAY.rules)}>
      <span className="section-label pay-rules__label">{tx(PAY.rules)}</span>
      <ul className="pay-rules__list">
        <li>{tx(PAY.ruleEdit)}</li>
        <li>{tx(PAY.ruleRefund)}</li>
        <li>{tx(PAY.ruleInvoice)}</li>
      </ul>
    </aside>
  )
}
