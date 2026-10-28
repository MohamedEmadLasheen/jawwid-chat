import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { useCopy } from './copy'
import { OP } from './opsCopy'
import { useCarriedOver } from './hooks'
import { CorrectPackageDialog, EnterPackageDialog } from './OpsDialogs'
import type { CarriedOverView } from './api'

/**
 * PD-42 PR-3 on the Student Profile (plan §10.5): the package carried over
 * from Jawwid Core -- total, completed and remaining exactly as entered, the
 * plan length, who entered it -- with Correct (removed with a reason, then
 * entered again) and Enter the package, each offered on the server's word.
 * A viewer the server refuses sees nothing.
 */
export function CarriedOverPanel({ learnerId, name }: { learnerId: string; name: string }) {
  const q = useCarriedOver(learnerId)
  if (!q.data) return null
  const v = q.data
  // Nothing to show and nothing to do: a child not entered by hand.
  if (!v.package && !v.can.carryOver) return null
  return <Panel v={v} name={name} />
}

function Panel({ v, name }: { v: CarriedOverView; name: string }) {
  const tx = useCopy()
  const { number, dateTime } = useI18n()
  const [open, setOpen] = useState<'correct' | 'enter' | null>(null)
  const p = v.package
  const action = p
    ? v.can.correct && <button type="button" className="btn btn--sm" onClick={() => setOpen('correct')}>{tx(OP.correct)}</button>
    : v.can.carryOver && <button type="button" className="btn btn--sm btn--primary" onClick={() => setOpen('enter')}>{tx(OP.enterPackage)}</button>
  return (
    <section className="card panel tf-section" aria-labelledby="st-carried-over">
      <div className="tf-section__head">
        <h2 id="st-carried-over" className="tf-section__title">{tx(OP.packageTitle)}</h2>
        {action}
      </div>
      <p className="field__hint">{tx(OP.packageHint)}</p>
      {p ? (
        <>
          <dl className="tf-kv">
            <dt>{tx(OP.total)}</dt>
            <dd>{number(p.total)}</dd>
            <dt>{tx(OP.completed)}</dt>
            <dd>{number(p.completed)}</dd>
            <dt>{tx(OP.remaining)}</dt>
            <dd className="ns-inline">
              <strong>{number(Math.max(p.remaining, 0))}</strong>
              <Badge tone={p.remaining > 0 ? 'ok' : 'warn'}>{p.remaining > 0 ? tx(OP.active) : tx(OP.usedUp)}</Badge>
            </dd>
            {p.planMonths !== null && (
              <>
                <dt>{tx(OP.plan)}</dt>
                <dd>{tx(OP.months, { n: number(p.planMonths) })}</dd>
              </>
            )}
          </dl>
          <p className="tf-byline">{tx(OP.enteredByOn, { name: p.enteredBy.name ?? '—', date: dateTime(p.enteredAt) })}</p>
        </>
      ) : (
        <p className="tf-muted">{tx(OP.noPackage)}</p>
      )}
      {open === 'correct' && <CorrectPackageDialog learnerId={v.learnerId} name={name} onClose={() => setOpen(null)} />}
      {open === 'enter' && <EnterPackageDialog learnerId={v.learnerId} name={name} onClose={() => setOpen(null)} />}
    </section>
  )
}
