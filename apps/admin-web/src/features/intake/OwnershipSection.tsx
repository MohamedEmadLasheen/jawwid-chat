import { useState } from 'react'
import { Badge } from '@/shared/components/Badge'
import { useCopy } from './copy'
import { OP } from './opsCopy'
import { useFamilyOwnership } from './hooks'
import { SalesOwnerDialog, SignInEmailDialog, SupervisorDialog } from './OpsDialogs'
import type { FamilyOwnership } from './api'

/**
 * PD-42 PR-3 on the Parent Profile (plan §10.4): the parent's sign-in e-mail
 * ("Set sign-in e-mail" when there is none), the family's Operations
 * supervisor (chosen by the Operations manager, suggested by its Sales owner
 * while it waits) and its Sales owner (changed by the Sales manager). Shown
 * only when the server answers for this viewer; a refusal shows nothing.
 */
export function OwnershipSection({ familyId, parentName }: { familyId: string; parentName: string }) {
  const q = useFamilyOwnership(familyId)
  if (!q.data) return null
  return <Ownership o={q.data} parentName={parentName} />
}

type Open = 'email' | 'owner' | 'assign' | 'suggest' | null

function Ownership({ o, parentName }: { o: FamilyOwnership; parentName: string }) {
  const tx = useCopy()
  const [open, setOpen] = useState<Open>(null)
  const [done, setDone] = useState<string | null>(null)
  const close = () => setOpen(null)
  const finish = (m: string) => {
    setOpen(null)
    setDone(m)
  }
  return (
    <section className="card panel tf-section" aria-labelledby="pf-ownership">
      <div className="tf-section__head">
        <h2 id="pf-ownership" className="tf-section__title">{tx(OP.ownershipTitle)}</h2>
      </div>
      <dl className="tf-kv">
        <dt>{tx(OP.signIn)}</dt>
        <dd className="ns-inline">
          {o.signIn ? <span>{tx(OP.hasEmail)}</span> : <span className="tf-muted">{tx(OP.noEmail)}</span>}
          {o.can.setSignInEmail && (
            <button type="button" className="btn btn--sm" onClick={() => setOpen('email')}>{tx(OP.setEmail)}</button>
          )}
        </dd>
        <dt>{tx(OP.supervisor)}</dt>
        <dd className="ns-inline">
          {o.supervisor && <span dir="auto">{o.supervisor.name}</span>}
          {o.needsOperationsSupervisor ? (
            <Badge tone="waiting" dot>{tx(OP.needs)}</Badge>
          ) : (
            !o.supervisor && <span className="tf-muted">{tx(OP.none)}</span>
          )}
          {o.needsOperationsSupervisor && o.suggestion && (
            <span className="tf-muted"> {tx(OP.suggested)} <bdi>{o.suggestion.name}</bdi></span>
          )}
          {o.can.assignOperationsSupervisor && (
            <button type="button" className="btn btn--sm btn--primary" onClick={() => setOpen('assign')}>{tx(OP.choose)}</button>
          )}
          {o.can.suggestSupervisor && !o.can.assignOperationsSupervisor && (
            <button type="button" className="btn btn--sm" onClick={() => setOpen('suggest')}>{tx(OP.suggest)}</button>
          )}
        </dd>
        <dt>{tx(OP.salesOwner)}</dt>
        <dd className="ns-inline">
          {o.salesOwner ? <span dir="auto">{o.salesOwner.name}</span> : <span className="tf-muted">{tx(OP.none)}</span>}
          {o.can.changeSalesOwner && (
            <button type="button" className="btn btn--sm" onClick={() => setOpen('owner')}>{tx(OP.changeOwner)}</button>
          )}
        </dd>
      </dl>
      {done && <p className="banner banner--info" role="status">{done}</p>}
      {open === 'email' && <SignInEmailDialog familyId={o.familyId} name={parentName} onClose={close} onDone={finish} />}
      {open === 'owner' && (
        <SalesOwnerDialog familyId={o.familyId} name={parentName} currentId={o.salesOwner?.id ?? null} choices={o.salesOwnerChoices} onClose={close} onDone={finish} />
      )}
      {(open === 'assign' || open === 'suggest') && (
        <SupervisorDialog mode={open} familyId={o.familyId} name={parentName} suggestedId={o.suggestion?.id ?? null} onClose={close} onDone={finish} />
      )}
    </section>
  )
}
