import type { ChatMention } from './chatApi'
import { mentionSegments } from './mentions'

/**
 * PD-36: a message's text with its "@..." drawn as chips. Each chip is a
 * <bdi>, so an Arabic name inside English text (or the reverse) keeps its own
 * direction and never drags the words around it. The chip names the person the
 * SERVER recorded; the text is only what the sender saw.
 */
export function MentionText({
  body,
  mentions,
  selfId,
}: {
  body: string
  mentions: readonly ChatMention[] | undefined
  /** The viewer: their own chip is drawn stronger. Role chips name no one in particular. */
  selfId?: string
}) {
  if (!mentions || mentions.length === 0) return <>{body}</>
  return (
    <>
      {mentionSegments(body, mentions).map((seg, i) =>
        seg.mention ? (
          <bdi
            key={i}
            className={seg.mention.actorId && seg.mention.actorId === selfId ? 'cw-mention cw-mention--me' : 'cw-mention'}
          >
            {seg.text}
          </bdi>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}
