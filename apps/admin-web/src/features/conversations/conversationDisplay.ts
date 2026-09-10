import type { Conversation } from '@/shared/types/conversation'

/**
 * How a conversation is NAMED, decided once.
 *
 * The list row, the conversation header, the forward picker and the search
 * result all have to agree, and three of them previously each did their own
 * `title ?? members.join(...)`. One conversation appearing under two names in
 * two panes of the same screen is a small bug that costs an operator real
 * confidence, so the rule lives here.
 *
 * `title` is the server's when it has one. Otherwise the conversation is named
 * after the people in it — never after an id, which is not a name and reads as
 * a leak.
 */
export function titleOf(conversation: Conversation): string {
  if (conversation.title) return conversation.title

  const names = (conversation.members ?? [])
    .map((member) => member.displayName)
    .filter((name): name is string => Boolean(name))

  // The Arabic comma, deliberately: a Latin comma inside an Arabic run is a
  // visible seam, and this string sits in both locales.
  return names.length > 0 ? names.join('، ') : ''
}

/** The display name of a member, by actor id. Empty when the server sent none. */
export function memberName(
  conversation: Conversation,
  actorId: string | null,
): string {
  if (!actorId) return ''
  return (
    conversation.members?.find((member) => member.actorId === actorId)?.displayName ?? ''
  )
}
