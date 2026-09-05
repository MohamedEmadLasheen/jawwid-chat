import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { staffApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { ApiError } from '@/core/api/errors'
import { useCreateTask } from './hooks'
import type { TaskType } from '@/shared/types/domain'

const TASK_TYPES: TaskType[] = ['finance', 'technical', 'academic', 'other']

/**
 * Internal task raised from a conversation. It routes to a department, which
 * sees only its own tasks and can never message the family (brief §2).
 */
export function CreateTaskDialog({
  familyId,
  caseId,
  onClose,
}: {
  familyId: string
  caseId: string | null
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const [type, setType] = useState<TaskType>('other')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [dueAt, setDueAt] = useState('')

  const staffQuery = useQuery({ queryKey: qk.staff, queryFn: () => staffApi.list() })
  const create = useCreateTask()

  const canSubmit = title.trim() && ownerId && !create.isPending

  const submit = () => {
    if (!canSubmit) return
    create.mutate(
      {
        family_id: familyId,
        case_id: caseId,
        type,
        title: title.trim(),
        details: details.trim() || undefined,
        owner_id: ownerId,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog
      title={t('action.task')}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={submit}>
            {create.isPending ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">{t('action.task')}</span>
        <input className="input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">{t('nav.tasks')}</span>
        <select className="select" value={type} onChange={(e) => setType(e.target.value as TaskType)}>
          {TASK_TYPES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">{t('family.owner')}</span>
        <select className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">—</option>
          {(staffQuery.data ?? []).filter((s) => s.is_active).map((member) => (
            <option key={member.id} value={member.id}>{member.name}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">{t('task.due', { date: '' })}</span>
        <input className="input" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">{t('common.reason')}</span>
        <textarea className="textarea" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
      </label>

      {create.error && (
        <div className="field__error" role="alert">
          {create.error instanceof ApiError ? create.error.localized(locale) : t('common.offline')}
        </div>
      )}
    </Dialog>
  )
}
