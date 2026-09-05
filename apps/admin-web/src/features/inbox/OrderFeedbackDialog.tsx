import { useState } from 'react'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useOrderFeedback } from './hooks'
import type { InboxSection } from '@/core/api/endpoints'

/**
 * "This order is wrong" (brief §6). The operator names what they would have
 * handled first; the answer becomes the calibration data that replaces the
 * initial attention weights after 60-90 days of real use.
 */
export function OrderFeedbackDialog({
  section,
  familyId,
  position,
  onClose,
}: {
  section: InboxSection
  familyId: string
  position: number
  onClose: () => void
}) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const feedback = useOrderFeedback()

  const submit = () => {
    if (!text.trim() || feedback.isPending) return
    feedback.mutate(
      { family_id: familyId, section, position, what_i_would_have_done: text.trim() },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog
      title={t('inbox.orderWrong')}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!text.trim() || feedback.isPending}
            onClick={submit}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">{t('inbox.orderWrong.prompt')}</span>
        <textarea
          className="textarea"
          rows={4}
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
      </label>
    </Dialog>
  )
}
