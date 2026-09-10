import type { MessageKey } from '@/core/i18n/messages'

/**
 * SYSTEM EVENTS, TURNED INTO SENTENCES.
 *
 * The API stores a system message's body as `JSON.stringify({ kind, ...payload })`
 * — see `systemMessage()` in `communication/conversations/conversation.service.ts`
 * and its twin in `calls/call.service.ts`. That is a deliberate contract: the
 * server records WHAT HAPPENED, in one language-free shape, and each client
 * renders it in the reader's own language. `terminology.md` §8.6 asks for
 * exactly this — key plus params, never a server-composed sentence, never
 * fragments the client glues together.
 *
 * What was missing was the other half of that contract. The console printed
 * `message.body` verbatim, so a real group conversation showed a parent-facing
 * operator the string `{"kind":"group.created","learner":"learner_smoke"}`.
 *
 * ## The rule this module exists to keep
 *
 * **A raw payload never reaches a pixel.** Every path below ends in either a
 * localized sentence or a plain-text body that was never JSON — there is no
 * branch that falls through to printing the envelope. An event this console has
 * not been taught renders as the generic "conversation update" rather than as
 * its own internals: a reader learns nothing from a `kind` they cannot act on,
 * and a new server event must never be able to leak a payload into a family's
 * history by being deployed before the client knows it.
 *
 * ## Why a pure function
 *
 * It returns a key and params rather than a string, so the mapping is testable
 * without React or a locale, and so the rendering component stays the only
 * thing that knows about `t()`.
 */
export type SystemMessagePresentation =
  | { kind: 'localized'; key: MessageKey; params?: Record<string, string> }
  /**
   * A body that was never JSON — a plain sentence written before this
   * convention existed. Rendered as-is, because it is already human text.
   */
  | { kind: 'literal'; text: string }

/** Present only when the value is a non-empty string; otherwise absent. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * A count from the payload.
 *
 * Zero and a missing value are deliberately the same answer — "nothing to
 * say" — so that `added: 0` does not render as a number an operator would
 * read as an event.
 */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function presentSystemMessage(body: string | null): SystemMessagePresentation {
  const raw = body?.trim() ?? ''
  if (raw === '') return { kind: 'localized', key: 'system.unknown' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Not JSON at all, so it cannot be a payload: it is somebody's sentence.
    return { kind: 'literal', text: raw }
  }

  // A JSON-encoded bare string is still just a sentence.
  if (typeof parsed === 'string') {
    const inner = parsed.trim()
    return inner === ''
      ? { kind: 'localized', key: 'system.unknown' }
      : { kind: 'literal', text: inner }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'localized', key: 'system.unknown' }
  }

  const payload = parsed as Record<string, unknown>
  const eventKind = text(payload.kind)

  switch (eventKind) {
    case 'group.created': {
      const learner = text(payload.learner)
      return learner
        ? { kind: 'localized', key: 'system.groupCreated', params: { learner } }
        : { kind: 'localized', key: 'system.groupCreatedUnnamed' }
    }

    case 'group.membership_changed': {
      const added = count(payload.added)
      const removed = count(payload.removed)
      if (added > 0 && removed > 0) {
        return {
          kind: 'localized',
          key: 'system.membersChangedBoth',
          params: { added: String(added), removed: String(removed) },
        }
      }
      if (added > 0) {
        return {
          kind: 'localized',
          key: 'system.membersChangedAdded',
          params: { added: String(added) },
        }
      }
      if (removed > 0) {
        return {
          kind: 'localized',
          key: 'system.membersChangedRemoved',
          params: { removed: String(removed) },
        }
      }
      return { kind: 'localized', key: 'system.membersChanged' }
    }

    case 'group.archived': {
      const reason = text(payload.reason)
      return reason
        ? { kind: 'localized', key: 'system.groupArchivedReason', params: { reason } }
        : { kind: 'localized', key: 'system.groupArchived' }
    }

    case 'class_call_started': {
      // The teacher is named rather than described, per `terminology.md` §8.1:
      // a name carries no grammatical gender, and a role noun would.
      const teacher = text(payload.teacherName)
      const group = text(payload.groupName)
      if (teacher && group) {
        return {
          kind: 'localized',
          key: 'system.classCallStarted',
          params: { teacher, group },
        }
      }
      if (teacher) {
        return {
          kind: 'localized',
          key: 'system.classCallStartedNoGroup',
          params: { teacher },
        }
      }
      return { kind: 'localized', key: 'system.callStarted' }
    }

    default:
      // A kind this build has not been taught. The reader gets the fact that
      // something changed, and never the envelope it arrived in.
      return { kind: 'localized', key: 'system.unknown' }
  }
}
