import type { ReactNode } from 'react'
import { Icon, type IconName } from '@/shared/components/Icon'
import { moneyParts } from './copy'

/**
 * The pieces a record's tabs are built from (a parent's file, a student's
 * file): a headed sheet, the list of what waits now, a calm line when nothing
 * does, labelled facts for the canvas, and an amount set in display numerals.
 */

/**
 * A headed white sheet. The heading alone names the region; its count sits
 * beside it, outside the heading, so the region keeps its plain name.
 */
export function Sheet({
  id,
  section,
  title,
  count,
  action,
  rule,
  children,
}: {
  id: string
  /** The name a link's hash uses to bring this sheet into view. */
  section?: string
  title: string
  count?: ReactNode
  action?: ReactNode
  /** One quiet line under the heading: a rule that protects people. */
  rule?: string
  children: ReactNode
}) {
  return (
    <section className="sheet rec-sheet" aria-labelledby={id} data-section={section}>
      <div className="sheet__head">
        <div className="rec-sheet__title">
          <h2 id={id} className="sheet__title">
            {title}
          </h2>
          {count !== undefined && count !== null && <span className="sheet__count">{count}</span>}
        </div>
        {action}
      </div>
      {rule && <p className="rec-sheet__rule">{rule}</p>}
      {children}
    </section>
  )
}

/** An amount: the figure in display numerals, left to right, its currency small beside it. */
export function Amount({ minor, currency, locale, late }: { minor: number; currency: string; locale: 'ar' | 'en'; late?: boolean }) {
  const m = moneyParts(minor, currency, locale)
  return (
    <span className={late ? 'rec-amount rec-amount--late' : 'rec-amount'}>
      <bdi dir="ltr">{m.amount}</bdi>
      <span className="rec-amount__unit">{m.unit}</span>
    </span>
  )
}

/**
 * One row of a record's lists: what it is, its state as a tag, one supporting
 * line (and any further lines under it), the amount set apart, one action.
 * `late` draws the terracotta edge a problem row carries everywhere; `muted`
 * is for what is settled, `struck` for what was voided.
 */
export function AttentionRow({
  tone,
  tag,
  title,
  sub,
  amount,
  action,
  children,
}: {
  tone: 'late' | 'waiting' | 'plain' | 'muted' | 'struck'
  tag?: ReactNode
  title: ReactNode
  sub?: ReactNode
  amount?: ReactNode
  action?: ReactNode
  /** Further quiet lines under the first: who paid, why it was voided. */
  children?: ReactNode
}) {
  return (
    <li className={`rec-attn rec-attn--${tone}`}>
      <div className="rec-attn__what">
        <span className="rec-attn__line">
          <strong className="rec-attn__title">{title}</strong>
          {tag}
        </span>
        {sub && <span className="rec-attn__sub">{sub}</span>}
        {children}
      </div>
      {amount}
      {action && <div className="rec-attn__act">{action}</div>}
    </li>
  )
}

/** Nothing waits: one calm line, not an empty box. */
export function Calm({ children, icon = 'checkCircle' }: { children: ReactNode; icon?: IconName }) {
  return (
    <p className="rec-calm">
      <Icon name={icon} size={18} />
      <span>{children}</span>
    </p>
  )
}

/** A labelled fact on the canvas: a quiet label with its icon, the value under it. */
export function Fact({ icon, label, children }: { icon?: IconName; label: string; children: ReactNode }) {
  return (
    <div className="rec-fact">
      <dt>
        {icon && <Icon name={icon} size={14} />}
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}
