import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Field } from '@/shared/components/Field'
import type { NewEntry, TeacherFile } from './api'
import { T, describeError, useCopy } from './copy'
import { useCalendarDate } from './calendar'
import { useAddEntryFor, useSupervisionDirectory, useUpdatePersonal } from './hooks'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

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
  | { kind: 'complaint'; source?: 'management' | 'parent' }
  | { kind: 'monthly_comment' }
  | { kind: 'day_off' }
  | { kind: 'complaint_resolution'; refersTo: string }
  | { kind: 'complaint_followup'; refersTo: string }
  | { kind: 'day_off_cancellation'; refersTo: string; date: string }

/**
 * One new timeline entry. Entries are never edited: a correction is another
 * entry. `teacherId` null (the Supervision page) asks which teacher first.
 */
export function AddEntryDialog({
  teacherId,
  intent,
  onClose,
}: {
  teacherId: string | null
  intent: EntryIntent
  onClose: () => void
}) {
  const tx = useCopy()
  const cal = useCalendarDate()
  const add = useAddEntryFor()
  const teacherFieldId = useId()
  const sourceId = useId()
  const handlerId = useId()
  const chatId = useId()
  // The supervisors a complaint may be handed to, and the teachers to choose from.
  // PD-26 amendment: the page's directory -- the caller's teachers and who may handle a complaint.
  const directory = useSupervisionDirectory(intent.kind === 'complaint' || teacherId === null)
  const [chosen, setChosen] = useState(teacherId ?? '')
  const [source, setSource] = useState<'' | 'management' | 'parent'>(intent.kind === 'complaint' ? (intent.source ?? '') : '')
  const [handler, setHandler] = useState('')
  const [chat, setChat] = useState('')
  const [body, setBody] = useState('')
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [day, setDay] = useState('')
  const [touched, setTouched] = useState(false)

  const title =
    intent.kind === 'complaint'
      ? tx(T.addComplaint)
      : intent.kind === 'complaint_resolution'
        ? tx(T.resolveTitle)
        : intent.kind === 'complaint_followup'
          ? tx(T.followUpTitle)
          : intent.kind === 'monthly_comment'
          ? tx(T.addMonthly)
          : intent.kind === 'day_off'
            ? tx(T.addDayOff)
            : tx(T.cancelTitle, { date: cal.day(intent.date) })

  // PD-26 amendment: about a teacher the caller reaches only through Operations, a
  // parent's complaint names the family chat it came from (the server requires it).
  const needsChat =
    intent.kind === 'complaint' && source === 'parent' && directory.data?.teachers.find((t) => t.id === chosen)?.operationsOnly === true
  const missing = {
    teacher: !chosen,
    source: intent.kind === 'complaint' && !source,
    chat: needsChat && !chat,
    body: !body.trim(),
    month: intent.kind === 'monthly_comment' && !/^\d{4}-\d{2}$/.test(month),
    day: intent.kind === 'day_off' && !/^\d{4}-\d{2}-\d{2}$/.test(day),
  }

  const entry = (): NewEntry => {
    const text = body.trim()
    switch (intent.kind) {
      case 'complaint':
        return {
          kind: 'complaint',
          body: text,
          source: source || 'management',
          ...(handler ? { handledBy: handler } : {}),
          ...(needsChat && chat ? { sourceConversationId: chat } : {}),
        }
      case 'complaint_followup':
        return { kind: 'complaint_followup', body: text, refersTo: intent.refersTo }
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
            if (Object.values(missing).some(Boolean)) return
            add.mutate({ teacherId: chosen, body: entry() }, { onSuccess: onClose })
          }}
        />
      }
    >
      {teacherId === null && (
        <div className="field">
          <label className="field__label" htmlFor={teacherFieldId}>
            {tx(T.name)}
          </label>
          <SearchableSelect id={teacherFieldId} className="input" value={chosen} onValueChange={(v) => setChosen(v)}>
            <option value="">{tx(T.chooseTeacher)}</option>
            {(directory.data?.teachers ?? [])
              .filter((t) => t.isActive)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </SearchableSelect>
          {touched && missing.teacher && <span className="field__error">{tx(T.required)}</span>}
        </div>
      )}
      {intent.kind === 'complaint' && (
        <>
          <div className="field">
            <label className="field__label" htmlFor={sourceId}>
              {tx(T.source)}
            </label>
            <SearchableSelect id={sourceId} className="input" value={source} onValueChange={(v) => setSource(v as typeof source)}>
              <option value="" disabled>
                {tx(T.source)}
              </option>
              <option value="management">{tx(T.sourceManagement)}</option>
              <option value="parent">{tx(T.sourceParent)}</option>
            </SearchableSelect>
            {touched && missing.source && <span className="field__error">{tx(T.required)}</span>}
          </div>
          {needsChat && (
            <div className="field">
              <label className="field__label" htmlFor={chatId}>
                {tx(T.familyChat)}
              </label>
              <SearchableSelect id={chatId} className="input" value={chat} onValueChange={(v) => setChat(v)}>
                <option value="">{tx(T.chooseFamilyChat)}</option>
                {(directory.data?.familyChats ?? []).map((c) => (
                  <option key={c.conversationId} value={c.conversationId}>
                    {c.learnerName}
                  </option>
                ))}
              </SearchableSelect>
              {touched && missing.chat && <span className="field__error">{tx(T.required)}</span>}
            </div>
          )}
          <div className="field">
            <label className="field__label" htmlFor={handlerId}>
              {tx(T.handler)}
            </label>
            <SearchableSelect id={handlerId} className="input" value={handler} onValueChange={(v) => setHandler(v)}>
              <option value="">{tx(T.handlerMe)}</option>
              {(directory.data?.supervisors ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SearchableSelect>
          </div>
        </>
      )}
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
