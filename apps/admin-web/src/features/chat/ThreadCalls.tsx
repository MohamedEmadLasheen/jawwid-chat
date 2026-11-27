import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { callApi, callKeys } from '@/features/calls/callApi'
import { useCallCapability } from '@/features/calls/useCallCapability'
import { useCall } from '@/features/calls/CallProvider'
import { callCopyFor } from '@/features/calls/copy'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'

/**
 * The thread header's ONE primary control: Call.
 *
 * The rules are those of ConversationCallControls (features/calls): the button
 * is ABSENT, not disabled, when the server's advisory answer is no, and that
 * answer is never inferred here; POST /calls decides again, and a refusal is
 * shown by the call window.
 */
export function CallButton({ conversationId, peerLabel, isGroup }: { conversationId: string; peerLabel: string; isGroup: boolean }) {
  const { locale } = useI18n()
  const copy = callCopyFor(locale)
  const { state, controller } = useCall()
  const capability = useCallCapability(conversationId)
  if (!capability.canCall || !controller) return null
  const label = isGroup ? copy.groupCall : copy.call
  return (
    <button
      type="button"
      className="btn btn--primary cw-head__call"
      disabled={state.phase !== 'idle'}
      aria-label={label}
      title={label}
      onClick={() => void controller.start({ conversationId, peerLabel, isGroup })}
    >
      <Icon name="phone" size={18} />
      <span className="cw-head__call-word">{label}</span>
    </button>
  )
}

/** The conversation's calls as the server recorded them, opened from the header's menu. */
export function CallHistoryDialog({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const { locale, dateTime } = useI18n()
  const copy = callCopyFor(locale)
  const history = useQuery({ queryKey: callKeys.history(conversationId), queryFn: () => callApi.history(conversationId) })
  const rows = history.data ?? []
  return (
    <Dialog variant="sheet" title={copy.history} onClose={onClose}>
      {history.isLoading ? null : rows.length === 0 ? (
        <p className="cw-calls__none">{copy.noHistory}</p>
      ) : (
        <ul className="cw-calls__list">
          {rows.map((c) => (
            <li key={c.id}>
              <span>
                {c.outcome ? copy.outcome[c.outcome] ?? c.outcome : c.status}
                {c.durationSeconds ? `${locale === 'ar' ? '، ' : ', '}${copy.duration(c.durationSeconds)}` : ''}
              </span>
              <time dateTime={c.startedAt}>{dateTime(c.startedAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
