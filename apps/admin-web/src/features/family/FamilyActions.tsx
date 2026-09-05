import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { managerOnly } from '@/core/permissions/capabilities'
import { ReasonDialog } from './ReasonDialog'
import { TransferOwnershipDialog } from './TransferOwnershipDialog'
import { CreateTaskDialog } from '@/features/tasks/CreateTaskDialog'
import { useEscalateCase, useCreateFollowUp, useHandlingActions } from './hooks'
import type { Case, FamilyDetail } from '@/shared/types/domain'

type OpenDialog = 'escalate' | 'followUp' | 'task' | 'transfer' | null

/**
 * The action bar carries only actions that serve the operating workflow.
 * Handoff is deliberately expressed as the brief's two real controls —
 * "I'll keep this" (stickiness) and "For owner" (defer) — because those are the
 * decisions an operator actually makes at shift boundaries. Neither touches
 * ownership.
 */
export function FamilyActions({
  detail,
  activeCase,
}: {
  detail: FamilyDetail
  activeCase: Case | null
}) {
  const { t } = useI18n()
  const { staff } = useSession()
  const [dialog, setDialog] = useState<OpenDialog>(null)

  const familyId = detail.family.id
  const escalate = useEscalateCase(familyId)
  const followUp = useCreateFollowUp(familyId)
  const { pinHandler, deferToOwner } = useHandlingActions(familyId)

  const canTransfer =
    staff != null && managerOnly.transferOwnership(staff.role) && detail.capabilities.can_transfer_ownership

  return (
    <div className="column__header" style={{ flexWrap: 'wrap', gap: 8 }}>
      <button
        type="button"
        className="btn btn--sm"
        disabled={!activeCase || !detail.capabilities.can_escalate}
        onClick={() => setDialog('escalate')}
      >
        {t('action.escalate')}
      </button>

      <button
        type="button"
        className="btn btn--sm"
        disabled={!activeCase}
        onClick={() => setDialog('followUp')}
      >
        {t('action.followUp')}
      </button>

      <button
        type="button"
        className="btn btn--sm"
        disabled={!detail.capabilities.can_create_task}
        onClick={() => setDialog('task')}
      >
        {t('action.task')}
      </button>

      <button
        type="button"
        className="btn btn--sm"
        disabled={pinHandler.isPending}
        onClick={() => pinHandler.mutate()}
      >
        {t('action.keep')}
      </button>

      <button
        type="button"
        className="btn btn--sm"
        disabled={deferToOwner.isPending}
        onClick={() => deferToOwner.mutate()}
      >
        {t('action.forOwner')}
      </button>

      {canTransfer && (
        <button type="button" className="btn btn--sm btn--danger" onClick={() => setDialog('transfer')}>
          {t('action.transferOwnership')}
        </button>
      )}

      {dialog === 'escalate' && activeCase && (
        <ReasonDialog
          title={t('action.escalate')}
          label={t('common.reason')}
          confirmLabel={t('action.escalate')}
          isPending={escalate.isPending}
          error={escalate.error}
          onClose={() => setDialog(null)}
          onConfirm={(reason) =>
            escalate.mutate({ caseId: activeCase.id, reason }, { onSuccess: () => setDialog(null) })
          }
        />
      )}

      {dialog === 'followUp' && activeCase && (
        <FollowUpDialog
          caseId={activeCase.id}
          isPending={followUp.isPending}
          error={followUp.error}
          onClose={() => setDialog(null)}
          onConfirm={(dueAt, reason) =>
            followUp.mutate({ caseId: activeCase.id, dueAt, reason }, { onSuccess: () => setDialog(null) })
          }
        />
      )}

      {dialog === 'task' && (
        <CreateTaskDialog
          familyId={familyId}
          caseId={activeCase?.id ?? null}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'transfer' && (
        <TransferOwnershipDialog
          familyId={familyId}
          currentOwnerId={detail.owner.id}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

/** Follow-up is one action: a date and a reason, straight into the inbox. */
function FollowUpDialog({
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  caseId: string
  isPending: boolean
  error: unknown
  onClose: () => void
  onConfirm: (dueAt: string, reason: string) => void
}) {
  const { t } = useI18n()
  const [dueAt, setDueAt] = useState('')

  return (
    <ReasonDialog
      title={t('action.followUp')}
      label={t('common.reason')}
      confirmLabel={t('action.followUp')}
      isPending={isPending}
      error={error}
      onClose={onClose}
      onConfirm={(reason) => {
        if (!dueAt) return
        onConfirm(new Date(dueAt).toISOString(), reason)
      }}
      extra={
        <label className="field">
          <span className="field__label">{t('task.due', { date: '' })}</span>
          <input
            className="input"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </label>
      }
    />
  )
}
