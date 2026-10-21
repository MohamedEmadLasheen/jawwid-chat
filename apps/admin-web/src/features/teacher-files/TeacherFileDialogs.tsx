import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { NewEntry, TeacherFile } from './api'
import { T, describeError, useCopy } from './copy'
import { useCalendarDate } from './calendar'
import { useAddEntry, useUpdatePersonal } from './hooks'

export function Footer({ onCancel, onSave, pending }: { onCancel: () => void; onSave: () => void; pending: boolean }) {
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

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  multiline = false,
  error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'tel' | 'email' | 'date' | 'month' | 'number'
  multiline?: boolean
  error?: string | null
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="input tf-textarea"
          value={value}
          dir="auto"
          rows={4}
          maxLength={4000}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
        />
      ) : (
        <input
          id={id}
          className="input"
          type={type}
          value={value}
          dir={type === 'text' ? 'auto' : 'ltr'}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
        />
      )}
      {error && (
        <span id={`${id}-err`} className="field__error">
          {error}
        </span>
      )}
    </div>
  )
}

/**
 * Phone, email and joining date. Only fields that changed are sent; an
 * emptied field is sent as null, which clears it. A reason is required.
 */
export function EditPersonalDialog({ file, onClose }: { file: TeacherFile; onClose: () => void }) {
  const tx = useCopy()
  const update = useUpdatePersonal(file.teacher.id)
  const initial = {
    phone: file.personal.phone ?? '',
    email: file.personal.email ?? '',
    joinedOn: file.personal.joinedOn ?? '',
    teachingMarket: file.employment?.teachingMarket ?? '',
  }
  const [form, setForm] = useState(initial)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const set = (k: keyof typeof initial) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <Dialog
      title={tx(T.editPersonal)}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          pending={update.isPending}
          onSave={() => {
            setTouched(true)
            if (!reason.trim()) return
            const patch: Record<string, string | null> = {}
            for (const k of Object.keys(initial) as Array<keyof typeof initial>) {
              if (form[k].trim() !== initial[k]) patch[k] = form[k].trim() === '' ? null : form[k].trim()
            }
            if (Object.keys(patch).length === 0) return onClose()
            update.mutate({ ...patch, reason: reason.trim() }, { onSuccess: onClose })
          }}
        />
      }
    >
      <p className="field__hint">{tx(T.personalHint)}</p>
      <Field label={tx(T.phone)} type="tel" value={form.phone} onChange={set('phone')} />
      <Field label={tx(T.email)} type="email" value={form.email} onChange={set('email')} />
      <Field label={tx(T.joinedOn)} type="date" value={form.joinedOn} onChange={set('joinedOn')} />
      <Field label={tx(T.teachingMarket)} value={form.teachingMarket} onChange={set('teachingMarket')} />
      <Field
        label={tx(T.reason)}
        value={reason}
        onChange={setReason}
        error={touched && !reason.trim() ? tx(T.required) : null}
      />
      <ServerError error={update.error} />
    </Dialog>
  )
}

export type EntryIntent =
  | { kind: 'complaint' }
  | { kind: 'monthly_comment' }
  | { kind: 'day_off' }
  | { kind: 'complaint_resolution'; refersTo: string }
  | { kind: 'day_off_cancellation'; refersTo: string; date: string }

/** One new timeline entry. Entries are never edited: a correction is another entry. */
export function AddEntryDialog({
  teacherId,
  intent,
  onClose,
}: {
  teacherId: string
  intent: EntryIntent
  onClose: () => void
}) {
  const tx = useCopy()
  const cal = useCalendarDate()
  const add = useAddEntry(teacherId)
  const [body, setBody] = useState('')
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [day, setDay] = useState('')
  const [touched, setTouched] = useState(false)

  const title =
    intent.kind === 'complaint'
      ? tx(T.addComplaint)
      : intent.kind === 'complaint_resolution'
        ? tx(T.resolveTitle)
        : intent.kind === 'monthly_comment'
          ? tx(T.addMonthly)
          : intent.kind === 'day_off'
            ? tx(T.addDayOff)
            : tx(T.cancelTitle, { date: cal.day(intent.date) })

  const missing = {
    body: !body.trim(),
    month: intent.kind === 'monthly_comment' && !/^\d{4}-\d{2}$/.test(month),
    day: intent.kind === 'day_off' && !/^\d{4}-\d{2}-\d{2}$/.test(day),
  }

  const entry = (): NewEntry => {
    const text = body.trim()
    switch (intent.kind) {
      case 'complaint':
        return { kind: 'complaint', body: text }
      case 'monthly_comment':
        return { kind: 'monthly_comment', body: text, month }
      case 'day_off':
        return { kind: 'day_off', body: text, dayOffOn: day }
      case 'complaint_resolution':
        return {
          kind: 'complaint_resolution',
          body: text,
          refersTo: intent.refersTo,
        }
      case 'day_off_cancellation':
        return {
          kind: 'day_off_cancellation',
          body: text,
          refersTo: intent.refersTo,
        }
    }
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          pending={add.isPending}
          onSave={() => {
            setTouched(true)
            if (missing.body || missing.month || missing.day) return
            add.mutate(entry(), { onSuccess: onClose })
          }}
        />
      }
    >
      {intent.kind === 'monthly_comment' && (
        <>
          <Field
            label={tx(T.month)}
            type="month"
            value={month}
            onChange={setMonth}
            error={touched && missing.month ? tx(T.required) : null}
          />
          <p className="field__hint">{tx(T.monthlyHint)}</p>
        </>
      )}
      {intent.kind === 'day_off' && (
        <Field
          label={tx(T.day)}
          type="date"
          value={day}
          onChange={setDay}
          error={touched && missing.day ? tx(T.required) : null}
        />
      )}
      <Field
        label={intent.kind === 'complaint_resolution' ? tx(T.resolution) : tx(T.details)}
        value={body}
        onChange={setBody}
        multiline
        error={touched && missing.body ? tx(T.required) : null}
      />
      <ServerError error={add.error} />
    </Dialog>
  )
}
