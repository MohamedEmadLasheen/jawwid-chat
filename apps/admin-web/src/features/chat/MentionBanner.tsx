import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Icon } from '@/shared/components/Icon'
import { chatApi, chatKeys, type ChatConversation, type ChatViewerMention } from './chatApi'
import { chatCopyFor } from './copy'

/**
 * PD-36: the viewer was asked into a conversation they are not a member of.
 *
 * They can already read it -- that is why they could be asked (PD-8) -- so the
 * banner does not unlock anything. It asks them to take part VISIBLY:
 *
 *   group  "Join" takes a seat through PD-35's primitive; the family and the
 *          teacher see "Laila joined", and the pushes start.
 *   1:1    "Step in" -- a 1:1 never gains a third member -- with a visible line;
 *          the pushes follow until they step out.
 *
 * While the summons is open the composer is not offered (the parent should see
 * someone join before they read their reply). That is a client choice only:
 * the server's PD-8 send rule is unchanged.
 */
export function MentionBanner({
  conversation,
  mention,
  onError,
}: {
  conversation: ChatConversation
  mention: ChatViewerMention
  onError: (e: unknown) => void
}) {
  const { locale, dateTime } = useI18n()
  const copy = chatCopyFor(locale)
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const direct = conversation.type === 'direct'
  const who =
    conversation.members?.find((m) => m.actorId === mention.mentionedById)?.displayName ?? copy.mentionSomeoneHere

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversation.id) })
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversation.id) })
      void queryClient.invalidateQueries({ queryKey: chatKeys.list })
    }
  }

  if (mention.state === 'stepped_in') {
    return (
      <div className="cw-mention-banner cw-mention-banner--in" role="status">
        <Icon name="at" size={16} />
        <span className="cw-mention-banner__text">{copy.mentionSteppedIn}</span>
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void run(() => chatApi.dismissMention(mention.mentionId))}>
          {copy.mentionStepOut}
        </button>
      </div>
    )
  }

  return (
    <div className="cw-mention-banner" role="region" aria-label={copy.mentionedBadge}>
      <Icon name="at" size={16} />
      <span className="cw-mention-banner__text">
        {copy.mentionedByLead} <bdi>{who}</bdi>
        <time className="cw-mention-banner__time" dateTime={mention.at}>
          {dateTime(mention.at)}
        </time>
        <span className="cw-mention-banner__hint">{direct ? copy.mentionStepInHint : copy.mentionJoinHint}</span>
      </span>
      <span className="cw-mention-banner__actions">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy}
          onClick={() =>
            void run(() => (direct ? chatApi.stepIn(mention.mentionId) : chatApi.joinOnMention(conversation.id)))
          }
        >
          {direct ? copy.mentionStepIn : copy.mentionJoin}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void run(() => chatApi.dismissMention(mention.mentionId))}>
          {copy.mentionDismiss}
        </button>
      </span>
    </div>
  )
}
