import { useEffect, useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Badge } from '@/shared/components/Badge'
import { I, describeIntakeError, useCopy } from './copy'
import { OP } from './opsCopy'
import {
  useAssignSupervisor,
  useCarryOver,
  useChangeSalesOwner,
  useFamilyOwnership,
  useSetSignInEmail,
  useSuggestSupervisor,
  useVoidCarryOver,
} from './hooks'
import type { GroupJoin } from './api'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

/**
 * PD-42 PR-3 dialogs. Each sends one request and shows the server's answer;
 * who may do what is decided by the server (FamilyIntakeService) and the
 * database, never here.
 */

/**
 * The Operations supervisor of a family waiting for one: chosen by the
 * Operations manager ('assign'), or suggested by its Sales owner ('suggest').
 * The choices are the server's (GET /family-intake/families/:id); a suggestion
 * already made is preselected.
 */
export function SupervisorDialog({
  mode,
  familyId,
  name,
  suggestedId,
  onClose,
  onDone,
}: {
  mode: 'assign' | 'suggest'
  familyId: string
  name: string | null
  suggestedId?: string | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const uid = useId()
  const ownership = useFamilyOwnership(familyId)
  const assign = useAssignSupervisor(familyId)
  const suggest = useSuggestSupervisor(familyId)
  const [supervisorId, setSupervisorId] = useState(suggestedId ?? '')
  const [touched, setTouched] = useState(false)
  const choices = ownership.data?.supervisorChoices ?? []
  useEffect(() => {
    const preset = suggestedId ?? ownership.data?.suggestion?.id
    if (!supervisorId && preset) setSupervisorId(preset)
  }, [ownership.data, suggestedId, supervisorId])
  const op = mode === 'assign' ? assign : suggest
  const save = async () => {
    setTouched(true)
    if (!supervisorId || op.isPending) return
    try {
      if (mode === 'assign') {
        const r = await assign.mutateAsync(supervisorId)
        onDone(tx(r.group === 'joined' ? OP.placedJoined : OP.placed))
      } else {
        await suggest.mutateAsync(supervisorId)
        onDone(tx(OP.suggestedDone))
      }
    } catch {
      // shown below from the mutation's error
    }
  }
  const title = `${tx(mode === 'assign' ? OP.chooseTitle : OP.suggestTitle)}${name ? ` — ${name}` : ''}`
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={op.isPending} onClick={() => void save()}>
            {op.isPending ? tx(OP.saving) : tx(mode === 'assign' ? OP.save : OP.suggestSave)}
          </button>
        </>
      }
    >
      <p className="field__hint">{tx(mode === 'assign' ? OP.chooseHint : OP.suggestHint)}</p>
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-sup`}>{tx(OP.supervisor)}</label>
        <SearchableSelect
          id={`${uid}-sup`}
          className="select"
          value={supervisorId}
          aria-invalid={touched && !supervisorId}
          onValueChange={(v) => setSupervisorId(v)}
        >
          <option value="">{tx(OP.pick)}</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </SearchableSelect>
        {touched && !supervisorId && <span className="field__error">{tx(OP.required)}</span>}
      </div>
      {op.error ? <p className="banner banner--danger" role="alert">{describeIntakeError(op.error, locale)}</p> : null}
    </Dialog>
  )
}

/** The parent's sign-in e-mail, for a family entered without one: their account is made now. */
export function SignInEmailDialog({ familyId, name, onClose, onDone }: { familyId: string; name: string; onClose: () => void; onDone: (m: string) => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const uid = useId()
  const op = useSetSignInEmail(familyId)
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const save = async () => {
    setTouched(true)
    if (!valid || op.isPending) return
    try {
      await op.mutateAsync(email.trim())
      onDone(tx(OP.emailSaved))
    } catch {
      // shown below
    }
  }
  return (
    <Dialog
      title={`${tx(OP.setEmail)} — ${name}`}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={op.isPending} onClick={() => void save()}>
            {op.isPending ? tx(OP.saving) : tx(OP.save)}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-email`}>{tx(OP.email)}</label>
        <input
          id={`${uid}-email`}
          className="input"
          type="email"
          dir="ltr"
          value={email}
          aria-invalid={touched && !valid}
          onChange={(e) => setEmail(e.target.value)}
        />
        <span className="field__hint">{tx(OP.setEmailHint)}</span>
        {touched && !valid && <span className="field__error">{tx(OP.required)}</span>}
      </div>
      {op.error ? <p className="banner banner--danger" role="alert">{describeIntakeError(op.error, locale)}</p> : null}
    </Dialog>
  )
}

/** The Sales manager sets or changes the family's Sales owner, saying why. */
export function SalesOwnerDialog({
  familyId,
  name,
  currentId,
  choices,
  onClose,
  onDone,
}: {
  familyId: string
  name: string
  currentId: string | null
  choices: Array<{ id: string; name: string }>
  onClose: () => void
  onDone: (m: string) => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const uid = useId()
  const op = useChangeSalesOwner(familyId)
  const [staffId, setStaffId] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const save = async () => {
    setTouched(true)
    if (!staffId || !reason.trim() || op.isPending) return
    try {
      await op.mutateAsync({ staffId, reason: reason.trim() })
      onDone(tx(OP.ownerChanged))
    } catch {
      // shown below
    }
  }
  return (
    <Dialog
      title={`${tx(OP.changeOwner)} — ${name}`}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={op.isPending} onClick={() => void save()}>
            {op.isPending ? tx(OP.saving) : tx(OP.save)}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-owner`}>{tx(OP.salesOwner)}</label>
        <SearchableSelect id={`${uid}-owner`} className="select" value={staffId} aria-invalid={touched && !staffId} onValueChange={(v) => setStaffId(v)}>
          <option value="">{tx(OP.pick)}</option>
          {choices.filter((c) => c.id !== currentId).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </SearchableSelect>
        {touched && !staffId && <span className="field__error">{tx(OP.required)}</span>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-reason`}>{tx(OP.reason)}</label>
        <textarea
          id={`${uid}-reason`}
          className="input"
          dir="auto"
          rows={2}
          maxLength={500}
          value={reason}
          aria-invalid={touched && !reason.trim()}
          onChange={(e) => setReason(e.target.value)}
        />
        {touched && !reason.trim() && <span className="field__error">{tx(OP.required)}</span>}
      </div>
      {op.error ? <p className="banner banner--danger" role="alert">{describeIntakeError(op.error, locale)}</p> : null}
    </Dialog>
  )
}

/** Correct a carried-over package: it is removed with a reason, then entered again. */
export function CorrectPackageDialog({ learnerId, name, onClose }: { learnerId: string; name: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const uid = useId()
  const op = useVoidCarryOver(learnerId)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const save = async () => {
    setTouched(true)
    if (!reason.trim() || op.isPending) return
    try {
      await op.mutateAsync(reason.trim())
      onClose()
    } catch {
      // shown below
    }
  }
  return (
    <Dialog
      title={`${tx(OP.correctTitle)} — ${name}`}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--danger" disabled={op.isPending} onClick={() => void save()}>
            {op.isPending ? tx(OP.saving) : tx(OP.remove)}
          </button>
        </>
      }
    >
      <p className="field__hint">{tx(OP.correctHint)}</p>
      <div className="field">
        <label className="field__label" htmlFor={`${uid}-reason`}>{tx(OP.reason)}</label>
        <textarea
          id={`${uid}-reason`}
          className="input"
          dir="auto"
          rows={2}
          maxLength={500}
          value={reason}
          aria-invalid={touched && !reason.trim()}
          onChange={(e) => setReason(e.target.value)}
        />
        {touched && !reason.trim() && <span className="field__error">{tx(OP.required)}</span>}
      </div>
      {op.error ? <p className="banner banner--danger" role="alert">{describeIntakeError(op.error, locale)}</p> : null}
    </Dialog>
  )
}

/** A child's Core package, entered after the intake; the remaining is computed as it is typed. */
export function EnterPackageDialog({ learnerId, name, onClose }: { learnerId: string; name: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale, number } = useI18n()
  const uid = useId()
  const op = useCarryOver(learnerId)
  const [total, setTotal] = useState('')
  const [completed, setCompleted] = useState('')
  const [plan, setPlan] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [touched, setTouched] = useState(false)
  const t = /^\d+$/.test(total) ? Number(total) : null
  const c = /^\d+$/.test(completed) ? Number(completed) : null
  const months = plan.trim() === '' ? null : /^\d+$/.test(plan) ? Number(plan) : NaN
  const ok = t !== null && t >= 1 && c !== null && (months === null || (months >= 1 && months <= 24))
  const remaining = t !== null && c !== null ? t - c : null
  const over = remaining !== null && remaining < 0
  const save = async () => {
    setTouched(true)
    if (!ok || op.isPending || (over && !confirm)) return
    try {
      await op.mutateAsync({ total: t, completed: c, planMonths: months, ...(over ? { confirmOver: true } : {}) })
      onClose()
    } catch {
      // shown below
    }
  }
  const field = (key: string, label: string, value: string, set: (v: string) => void) => (
    <div className="field">
      <label className="field__label" htmlFor={`${uid}-${key}`}>{label}</label>
      <input
        id={`${uid}-${key}`}
        className="input"
        type="number"
        inputMode="numeric"
        dir="ltr"
        min={0}
        value={value}
        aria-invalid={touched && !ok}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  )
  return (
    <Dialog
      title={`${tx(OP.enterPackage)} — ${name}`}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={op.isPending} onClick={() => void save()}>
            {op.isPending ? tx(OP.saving) : tx(OP.save)}
          </button>
        </>
      }
    >
      <p className="field__hint">{tx(I.packageHint)}</p>
      <div className="tj-row">
        {field('total', tx(OP.total), total, setTotal)}
        {field('completed', tx(OP.completed), completed, setCompleted)}
        {field('plan', tx(OP.planMonths), plan, setPlan)}
      </div>
      {remaining !== null && (
        <p data-testid="carry-remaining">
          {tx(OP.remaining)}: <strong>{number(Math.max(remaining, 0))}</strong>{' '}
          <Badge tone={remaining > 0 ? 'ok' : 'warn'}>{remaining > 0 ? tx(OP.active) : tx(OP.usedUp)}</Badge>
          {over && <> · {tx(I.overBy)} {number(-remaining)}</>}
        </p>
      )}
      {over && (
        <>
          <p className="field__hint">{tx(OP.overManagers)}</p>
          <label className="checkbox">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> {tx(I.confirmOver)}
          </label>
        </>
      )}
      {touched && !ok && <p className="field__error">{tx(OP.required)}</p>}
      {op.error ? <p className="banner banner--danger" role="alert">{describeIntakeError(op.error, locale)}</p> : null}
    </Dialog>
  )
}

/** The answer after placing children or adding them to a family, in words. */
export function groupNotice(tx: ReturnType<typeof useCopy>, group: GroupJoin | undefined, name: string): string {
  return tx(group === 'joined' ? OP.attachedJoined : OP.attached, { name })
}
