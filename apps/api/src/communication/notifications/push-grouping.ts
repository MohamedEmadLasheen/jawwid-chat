import { createHash } from 'node:crypto';

/**
 * LR-11b: THE ONE RULE for which pushes replace each other on a device.
 *
 * iOS uses it as the `apns-collapse-id`; Android notification tags (#449)
 * must use the same key, so both platforms group the same way. The rule is
 * recorded in docs/architecture/push-grouping.md as well.
 *
 *   held (summary) chat push      -> its own stable key, HELD_PUSH_GROUP.
 *                                    It stands for several chats, so it never
 *                                    replaces (or is replaced by) one chat's
 *                                    banner; a newer summary replaces an older.
 *   otherwise                     -> EVENT TYPE + SUBJECT, where the subject is
 *                                    the call when `data` names one, else the
 *                                    conversation.
 *   no event type or no subject   -> no key: never merged with anything.
 *
 * The event type is part of the key on purpose: a missed call, a lost
 * connection, a reminder or a mention in a chat must never replace that
 * chat's message banner, or the other way round. Only pushes of the SAME
 * event type for the SAME chat (or call) collapse.
 *
 * The key is opaque: a SHA-256 prefix, 32 hex characters (APNs allows 64
 * bytes), so no id travels in a header, and it is stable for the same group.
 * It is not keyed with a server secret: no existing secret serves this kind of
 * purpose, the value only goes to Apple/Google, and it reveals nothing to
 * someone who does not already hold the chat id.
 */
export const HELD_PUSH_GROUP = 'held-chats';

export interface PushGroupInput {
  /** The push `data` (as built by `buildPushData`). */
  data: Record<string, string>;
  /** True for a held (deferred, summary) chat push. */
  held?: boolean;
}

/** The readable group, before hashing. Exported for tests and documentation. */
export function pushGroupIdentity(input: PushGroupInput): string | undefined {
  if (input.held) return HELD_PUSH_GROUP;
  const eventType = input.data.eventType;
  if (!eventType) return undefined;
  const subject = input.data.callId
    ? `call:${input.data.callId}`
    : input.data.conversationId
      ? `conversation:${input.data.conversationId}`
      : undefined;
  return subject ? `${eventType}:${subject}` : undefined;
}

/** The opaque key a device groups on (APNs collapse id, Android tag), or undefined. */
export function pushGroupKey(input: PushGroupInput): string | undefined {
  const identity = pushGroupIdentity(input);
  if (!identity) return undefined;
  return createHash('sha256').update(`jawwid-push:${identity}`).digest('hex').slice(0, 32);
}
