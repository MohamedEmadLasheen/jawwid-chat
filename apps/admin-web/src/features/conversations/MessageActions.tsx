import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog } from '@/shared/components/Dialog'
import { REACTION_EMOJI, type Conversation, type Message } from '@/shared/types/conversation'
import { useConversationQueue, useMessageActions } from './hooks'

/**
 * Which actions a message offers an operator.
 *
 * THE SERVER REMAINS AUTHORITATIVE. This decides what to SHOW, and it leans
 * conservative on purpose: an action offered and then refused reads as a broken
 * console, whereas an action absent is merely an action they find elsewhere.
 *
 * The rules mirror `AuthorizationService.canEditMessage` and
 * `canDeleteForEveryone`. The windows are the API's config defaults; when the
 * server disagrees it refuses, and the refusal is rendered rather than
 * swallowed.
 */
export interface MessageCapabilities {
  canReact: boolean
  canForward: boolean
  canEdit: boolean
  canDeleteForMe: boolean
  canDeleteForEveryone: boolean
}

const EDIT_WINDOW_MS = 15 * 60_000
const DELETE_WINDOW_MS = 60 * 60_000

export function capabilitiesFor(
  message: Message,
  viewerActorId: string | null,
  now: number = Date.now(),
): MessageCapabilities {
  const age = now - new Date(message.createdAt).getTime()
  const isMine = message.authorId !== null && message.authorId === viewerActorId
  const isPublished = message.moderation === 'published'
  const isActionable = !message.deletedForAll && message.authorKind !== 'system'

  return {
    canReact: isActionable && isPublished,
    // Attachments are objects in storage with their own scoped URLs, so only
    // text is forwardable; the API refuses the rest for the same reason.
    canForward: isActionable && isPublished && message.type === 'text',
    canEdit: isActionable && isPublished && isMine && message.type === 'text' && age < EDIT_WINDOW_MS,
    // Hiding one's own copy destroys nothing, needs no window, and applies to
    // a WITHDRAWN message too — a tombstone is still a row in this operator's
    // view, and the API accepts hiding one. The mobile client behaves the same
    // way; deletion semantics are shared between the two clients, not
    // re-decided by each.
    canDeleteForMe: message.authorKind !== 'system',
    canDeleteForEveryone: isActionable && isMine && age < DELETE_WINDOW_MS,
  }
}

export function MessageActions({
  message,
  conversation,
  viewerActorId,
  locale,
}: {
  message: Message
  conversation: Conversation
  viewerActorId: string | null
  locale: 'ar' | 'en'
}) {
  const { t } = useI18n()
  const actions = useMessageActions(conversation.id)
  const can = capabilitiesFor(message, viewerActorId)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [forwarding, setForwarding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (work: Promise<unknown>) => {
    setError(null)
    try {
      await work
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.localized(locale) : t('common.offline'))
    }
  }

  const myReaction = message.reactions.find((r) => r.actorId === viewerActorId)

  return (
    <div className="msg__actions">
      {can.canReact && (
        <div className="msg__reaction-picker">
          {REACTION_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={
                myReaction?.emoji === emoji ? 'reaction-btn reaction-btn--on' : 'reaction-btn'
              }
              aria-pressed={myReaction?.emoji === emoji}
              aria-label={emoji}
              onClick={() =>
                // Tapping the one already applied removes it: one reaction per
                // person is what the server's unique index enforces.
                void run(
                  actions.react.mutateAsync({
                    messageId: message.id,
                    emoji: myReaction?.emoji === emoji ? null : emoji,
                  }),
                )
              }
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {can.canEdit && (
        <button type="button" className="btn btn--sm" onClick={() => setEditing(true)}>
          {t('message.edit')}
        </button>
      )}
      {can.canForward && (
        <button type="button" className="btn btn--sm" onClick={() => setForwarding(true)}>
          {t('message.forward')}
        </button>
      )}
      {can.canDeleteForMe && (
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => void run(actions.deleteForMe.mutateAsync(message.id))}
        >
          {t('message.deleteForMe')}
        </button>
      )}
      {can.canDeleteForEveryone && (
        <button
          type="button"
          className="btn btn--sm btn--danger"
          onClick={() => setConfirmingDelete(true)}
        >
          {t('message.deleteForEveryone')}
        </button>
      )}

      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}

      {editing && (
        <Dialog title={t('message.edit')} onClose={() => setEditing(false)}>
          <textarea
            className="composer__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={t('message.edit')}
          />
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!draft.trim() || draft.trim() === message.body}
              onClick={async () => {
                await run(
                  actions.edit.mutateAsync({ messageId: message.id, body: draft.trim() }),
                )
                setEditing(false)
              }}
            >
              {t('common.save')}
            </button>
          </div>
        </Dialog>
      )}

      {confirmingDelete && (
        // Confirmed, unlike delete-for-me: this changes what other people see,
        // cannot be undone, and the API requires a reason it will audit.
        <Dialog title={t('message.deleteForEveryone')} onClose={() => setConfirmingDelete(false)}>
          <p>{t('message.deleteForEveryoneWarning')}</p>
          <label className="field">
            <span className="field__label">{t('common.reason')}</span>
            <input
              className="field__input"
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
            />
          </label>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => setConfirmingDelete(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={!deleteReason.trim()}
              onClick={async () => {
                await run(
                  actions.deleteForEveryone.mutateAsync({
                    messageId: message.id,
                    reason: deleteReason.trim(),
                  }),
                )
                setConfirmingDelete(false)
              }}
            >
              {t('message.deleteForEveryone')}
            </button>
          </div>
        </Dialog>
      )}

      {forwarding && (
        <ForwardDialog
          message={message}
          sourceConversationId={conversation.id}
          onClose={() => setForwarding(false)}
          onForward={async (ids) => {
            await run(
              actions.forward.mutateAsync({ messageId: message.id, toConversationIds: ids }),
            )
            setForwarding(false)
          }}
        />
      )}
    </div>
  )
}

/**
 * Pick destinations for a forward.
 *
 * The list is this operator's OWN queue, already scoped by the server, so it
 * offers no destination they could not otherwise write to. The server
 * authorizes each one again on submit; this is a convenience, never a control.
 */
function ForwardDialog({
  message,
  sourceConversationId,
  onClose,
  onForward,
}: {
  message: Message
  sourceConversationId: string
  onClose: () => void
  onForward: (conversationIds: string[]) => void
}) {
  const { t } = useI18n()
  const { conversations } = useConversationQueue()
  const [selected, setSelected] = useState<string[]>([])

  // Forwarding into the conversation it already lives in is a no-op the
  // operator did not mean, and the API refuses it — so it is not offered.
  const targets = conversations.filter((c) => c.id !== sourceConversationId)

  return (
    <Dialog title={t('message.forward')} onClose={onClose}>
      <p className="dialog__excerpt">{message.body}</p>
      <ul className="picker">
        {targets.length === 0 && <li className="empty">{t('message.forwardEmpty')}</li>}
        {targets.map((conversation) => (
          <li key={conversation.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(conversation.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, conversation.id]
                      : current.filter((id) => id !== conversation.id),
                  )
                }
              />
              {conversation.title ?? conversation.id}
            </label>
          </li>
        ))}
      </ul>
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={selected.length === 0}
          onClick={() => onForward(selected)}
        >
          {t('message.forward')}
        </button>
      </div>
    </Dialog>
  )
}
