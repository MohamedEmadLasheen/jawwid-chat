import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { BackupLink, DepartmentMember, LearnerAssignment } from './api'
import { T, describeError, useCopy } from './copy'
import { useAssignSupervisor, useBackupAction, useCreateBackup, type BackupAction } from './hooks'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

/** A required reason: every structure change is audited with one. */
function ReasonField({ value, onChange, touched }: { value: string; onChange: (v: string) => void; touched: boolean }) {
  const tx = useCopy()
  const id = useId()
  const missing = !value.trim()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{tx(T.reason)}</label>
      <input
        id={id}
        className="input"
        value={value}
        dir="auto"
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={touched && missing}
        aria-describedby={`${id}-err`}
      />
      {touched && missing && <span id={`${id}-err`} className="field__error">{tx(T.required)}</span>}
    </div>
  )
}

function SaveFooter({ onCancel, onSave, pending }: { onCancel: () => void; onSave: () => void; pending: boolean }) {
  const tx = useCopy()
  return (
    <>
      <DialogCancelButton onClick={onCancel} />
      <button type="button" className="btn btn--primary" disabled={pending} onClick={onSave}>
        {pending ? tx(T.saving) : tx(T.save)}
      </button>
    </>
  )
}

function ServerError({ error }: { error: unknown }) {
  const { locale } = useI18n()
  if (!error) return null
  return (
    <div className="banner banner--danger" role="alert">
      {describeError(error, locale)}
    </div>
  )
}

/**
 * Assign (or change) a child's supervisor. Offers the Operations primary
 * supervisors the viewer can see; the server re-checks that the viewer manages
 * both the current and the new supervisor's department, and the database that
 * the new one is an Operations primary supervisor.
 */
export function AssignSupervisorDialog({
  learner,
  supervisors,
  onClose,
}: {
  learner: LearnerAssignment
  supervisors: DepartmentMember[]
  onClose: () => void
}) {
  const tx = useCopy()
  const selectId = useId()
  const assign = useAssignSupervisor()
  const [supervisorId, setSupervisorId] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const options = supervisors.filter((s) => s.isActive && s.id !== learner.supervisor?.id)

  return (
    <Dialog
      title={tx(T.assignTitle, { name: learner.name })}
      onClose={onClose}
      footer={
        <SaveFooter
          onCancel={onClose}
          pending={assign.isPending}
          onSave={() => {
            setTouched(true)
            if (!supervisorId || !reason.trim()) return
            assign.mutate({ learnerId: learner.learnerId, supervisorId, reason: reason.trim() }, { onSuccess: onClose })
          }}
        />
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={selectId}>{tx(T.assignTo)}</label>
        <SearchableSelect
          id={selectId}
          className="select"
          value={supervisorId}
          onValueChange={(v) => setSupervisorId(v)}
          aria-invalid={touched && !supervisorId}
        >
          <option value="">{tx(T.choose)}</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.learnerCount})
            </option>
          ))}
        </SearchableSelect>
        {touched && !supervisorId && <span className="field__error">{tx(T.required)}</span>}
        <span className="field__hint">{tx(T.assignHint)}</span>
      </div>
      <ReasonField value={reason} onChange={setReason} touched={touched} />
      <ServerError error={assign.error} />
    </Dialog>
  )
}

/** Activate (optionally until a date), deactivate, or end a backup link. */
export function BackupActionDialog({
  link,
  action,
  onClose,
}: {
  link: BackupLink
  action: BackupAction
  onClose: () => void
}) {
  const tx = useCopy()
  const untilId = useId()
  const run = useBackupAction()
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState('')
  const [touched, setTouched] = useState(false)
  const names = { backup: link.backup?.name ?? '', primary: link.primary?.name ?? '' }
  const title =
    action === 'activate' ? tx(T.activateTitle, names) : action === 'deactivate' ? tx(T.deactivateTitle) : tx(T.endTitle)

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <SaveFooter
          onCancel={onClose}
          pending={run.isPending}
          onSave={() => {
            setTouched(true)
            if (!reason.trim()) return
            run.mutate(
              {
                id: link.id,
                action,
                reason: reason.trim(),
                // End of the chosen day, in the viewer's time zone.
                until: action === 'activate' && until ? new Date(`${until}T23:59:59`).toISOString() : undefined,
              },
              { onSuccess: onClose },
            )
          }}
        />
      }
    >
      {action !== 'activate' && <p className="field__hint">{tx(T.covers, names)}</p>}
      {action === 'end' && <p className="field__hint">{tx(T.endHint)}</p>}
      {action === 'activate' && (
        <div className="field">
          <label className="field__label" htmlFor={untilId}>{tx(T.untilLabel)}</label>
          <input id={untilId} type="date" className="input" value={until} onChange={(e) => setUntil(e.target.value)} />
          <span className="field__hint">{tx(T.untilHint)}</span>
        </div>
      )}
      <ReasonField value={reason} onChange={setReason} touched={touched} />
      <ServerError error={run.error} />
    </Dialog>
  )
}

/** A new, DORMANT link between a primary supervisor and a backup of the same department. */
export function CreateBackupDialog({ members, onClose }: { members: DepartmentMember[]; onClose: () => void }) {
  const tx = useCopy()
  const ids = { primary: useId(), backup: useId() }
  const create = useCreateBackup()
  const [primaryId, setPrimaryId] = useState('')
  const [backupId, setBackupId] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const primaries = members.filter((m) => m.position === 'supervisor' && m.isActive)
  const backups = members.filter((m) => m.isActive && m.id !== primaryId)

  return (
    <Dialog
      title={tx(T.addBackup)}
      onClose={onClose}
      footer={
        <SaveFooter
          onCancel={onClose}
          pending={create.isPending}
          onSave={() => {
            setTouched(true)
            if (!primaryId || !backupId || !reason.trim()) return
            create.mutate({ primaryId, backupId, reason: reason.trim() }, { onSuccess: onClose })
          }}
        />
      }
    >
      <p className="field__hint">{tx(T.backupsHint)}</p>
      <div className="field">
        <label className="field__label" htmlFor={ids.primary}>{tx(T.primaryLabel)}</label>
        <SearchableSelect id={ids.primary} className="select" value={primaryId} onValueChange={(v) => setPrimaryId(v)}>
          <option value="">{tx(T.choose)}</option>
          {primaries.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </SearchableSelect>
        {touched && !primaryId && <span className="field__error">{tx(T.required)}</span>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.backup}>{tx(T.backupLabel)}</label>
        <SearchableSelect id={ids.backup} className="select" value={backupId} onValueChange={(v) => setBackupId(v)}>
          <option value="">{tx(T.choose)}</option>
          {backups.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </SearchableSelect>
        {touched && !backupId && <span className="field__error">{tx(T.required)}</span>}
      </div>
      <ReasonField value={reason} onChange={setReason} touched={touched} />
      <ServerError error={create.error} />
    </Dialog>
  )
}
