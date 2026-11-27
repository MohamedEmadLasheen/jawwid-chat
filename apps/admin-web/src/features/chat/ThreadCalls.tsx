import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { callApi, callKeys } from '@/features/calls/callApi'
import { useCallCapability } from '@/features/calls/useCallCapability'
import { useCall } from '@/features/calls/CallProvider'
import { callCopyFor } from '@/features/calls/copy'
import { Icon } from '@/shared/components/Icon'

/**
 * Call and call history in the thread header, as two icon buttons.
 *
 * The rules are those of ConversationCallControls (features/calls): the call
 * button is ABSENT, not disabled, when the server's advisory answer is no, and
 * that answer is never inferred here; POST /calls decides again, and a refusal
 * is shown by the call window. The history opens under its button instead of
 * growing the header.
 */
export function ThreadCalls({ conversationId, peerLabel, isGroup }: { conversationId: string; peerLabel: string; isGroup: boolean }) {
  const { locale, dateTime } = useI18n()
  const copy = callCopyFor(locale)
  const { state, controller } = useCall()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const capability = useCallCapability(conversationId)
  const history = useQuery({
    queryKey: callKeys.history(conversationId),
    queryFn: () => callApi.history(conversationId),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const canCall = capability.canCall && !!controller
  const busy = state.phase !== 'idle'
  const callLabel = isGroup ? copy.groupCall : copy.call
  const historyLabel = open ? copy.hideHistory : copy.history
  const rows = history.data ?? []

  return (
    <div
      className="cw-calls"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      {canCall && (
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          disabled={busy}
          aria-label={callLabel}
          title={callLabel}
          onClick={() => void controller!.start({ conversationId, peerLabel, isGroup })}
        >
          <Icon name="phone" />
        </button>
      )}
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        aria-expanded={open}
        aria-label={historyLabel}
        title={historyLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="clock" />
      </button>
      {open && (
        <div className="cw-calls__history" role="group" aria-label={copy.history}>
          <p className="section-label cw-calls__title">{copy.history}</p>
          {history.isLoading ? null : rows.length === 0 ? (
            <p className="cw-calls__none">{copy.noHistory}</p>
          ) : (
            <ul className="cw-calls__list">
              {rows.map((c) => (
                <li key={c.id}>
                  <span>
                    {c.outcome ? copy.outcome[c.outcome] ?? c.outcome : c.status}
                    {c.durationSeconds ? ` · ${copy.duration(c.durationSeconds)}` : ''}
                  </span>
                  <time dateTime={c.startedAt}>{dateTime(c.startedAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
