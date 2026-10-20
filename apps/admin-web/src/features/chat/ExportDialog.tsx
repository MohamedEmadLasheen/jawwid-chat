import { useMutation } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { chatApi } from './chatApi'
import { chatCopyFor } from './copy'

/** Hand a downloaded file to the browser as a save. */
function save(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Export a chat (owner decisions 2026-10-20): the super admin only, as a .zip
 * of the transcript and the media. The server refuses everyone else and logs
 * every export before a byte leaves; this dialog says both before it starts.
 */
export function ExportDialog({ conversationId, onClose, onDone }: { conversationId: string; onClose: () => void; onDone: () => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const run = useMutation({
    mutationFn: () => chatApi.exportChat(conversationId),
    onSuccess: ({ blob, fileName }) => {
      save(blob, fileName ?? `jawwid-chat-${conversationId.slice(0, 8)}.zip`)
      onDone()
    },
  })
  return (
    <Dialog
      title={copy.exportTitle}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? copy.exportWorking : copy.exportConfirm}
          </button>
        </>
      }
    >
      <p>{copy.exportBody}</p>
      <p className="field__hint">{copy.exportLogged}</p>
      {run.error !== null && (
        <p className="field__error" role="alert">
          {run.error instanceof ApiError ? run.error.localized(locale) : copy.actionFailed}
        </p>
      )}
    </Dialog>
  )
}
