import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { callApi, callKeys } from './callApi'
import { useCall } from './CallProvider'
import { callCopyFor } from './copy'
import './calls.css'

/**
 * The call affordance in a conversation's header.
 *
 * ABSENT, NOT DISABLED, when the server says no (screens/call.md §4): the
 * capability answer is the server's advisory "could you start a call here now",
 * and the client never infers it from the conversation type or the members. It
 * is not a grant -- POST /calls decides again from scratch -- so pressing the
 * button may still be refused, and that refusal is shown as such.
 */
export function ConversationCallControls({
  conversationId,
  peerLabel,
  isGroup,
}: {
  conversationId: string
  peerLabel: string
  isGroup: boolean
}) {
  const { locale, time } = useI18n()
  const copy = callCopyFor(locale)
  const { state, controller } = useCall()
  const [showHistory, setShowHistory] = useState(false)

  const capability = useQuery({
    queryKey: callKeys.capability(conversationId),
    queryFn: () => callApi.capability(conversationId),
    // Advisory and cheap to be wrong about (start decides again); refresh it so
    // a stale "yes" does not linger.
    staleTime: 15_000,
  })
  const history = useQuery({
    queryKey: callKeys.history(conversationId),
    queryFn: () => callApi.history(conversationId),
    enabled: showHistory,
  })

  const canCall = capability.data?.canCall === true && !!controller
  const busy = state.phase !== 'idle'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'stretch' }}>
      <div className="call-panel__actions">
        {canCall && (
          <button
            type="button"
            className="btn btn--sm btn--primary"
            disabled={busy}
            onClick={() => void controller!.start({ conversationId, peerLabel, isGroup })}
          >
            {isGroup ? copy.groupCall : copy.call}
          </button>
        )}
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((v) => !v)}
        >
          {showHistory ? copy.hideHistory : copy.history}
        </button>
      </div>
      {showHistory && (
        <div aria-label={copy.history}>
          {history.isLoading ? null : (history.data ?? []).length === 0 ? (
            <p className="call-panel__status">{copy.noHistory}</p>
          ) : (
            <ul className="call-history">
              {(history.data ?? []).map((c) => (
                <li key={c.id}>
                  <span>
                    {c.outcome ? copy.outcome[c.outcome] ?? c.outcome : c.status}
                    {c.durationSeconds ? ` · ${copy.duration(c.durationSeconds)}` : ''}
                  </span>
                  <span>{time(c.startedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
