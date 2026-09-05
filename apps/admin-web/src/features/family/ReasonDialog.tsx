import { useState } from 'react'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'

/**
 * A reason-collecting confirmation. Used wherever the brief requires a written
 * reason (escalation, follow-up, ownership transfer) — the reason is not
 * decoration, it is what makes the audit log readable six months later.
 */
export function ReasonDialog({
  title,
  label,
  confirmLabel,
  extra,
  error,
  isPending,
  onConfirm,
  onClose,
}: {
  title: string
  label: string
  confirmLabel: string
  extra?: React.ReactNode
  error?: unknown
  isPending?: boolean
  onConfirm: (reason: string) => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!trimmed || isPending}
            onClick={() => onConfirm(trimmed)}
          >
            {isPending ? t('common.loading') : confirmLabel}
          </button>
        </>
      }
    >
      {extra}
      <label className="field">
        <span className="field__label">{label}</span>
        <textarea
          className="textarea"
          rows={3}
          value={reason}
          autoFocus
          onChange={(event) => setReason(event.target.value)}
        />
        <span className="field__hint">{t('ownership.reasonRequired')}</span>
      </label>
      {error != null && (
        <div className="field__error" role="alert">
          {error instanceof ApiError ? error.localized(locale) : t('common.offline')}
        </div>
      )}
    </Dialog>
  )
}
