import type { ChatMention, SendMention } from './chatApi'

/**
 * PD-36 @mentions -- the text half, kept pure so it is tested on its own.
 *
 * Offsets are UTF-16 code units, which is what a JS string indexes by and what
 * the server stores, so `body.slice(start, start + length)` is the chip in
 * Arabic and English alike. The composer never tracks offsets while typing:
 * it remembers WHO was picked and under which label, and finds each "@label"
 * in the final text when it sends -- an edit in between cannot leave a span
 * pointing at the wrong words.
 */

/** Someone picked from the @ list, under the label inserted into the text (no "@"). */
export interface PickedMention {
  label: string
  target: { actorId: string } | { role: 'supervisor' | 'admin' }
}

const MAX_QUERY = 40

/**
 * The "@query" being typed just before the caret, or null. The "@" opens a
 * mention only at the start or after whitespace (so an e-mail address does
 * not), and the query runs to the caret with no whitespace in it.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  if (caret < 1 || caret > text.length) return null
  for (let i = caret - 1; i >= 0 && caret - i <= MAX_QUERY + 1; i--) {
    const ch = text[i]!
    if (/\s/.test(ch)) return null
    if (ch === '@') {
      if (i > 0 && !/\s/.test(text[i - 1]!)) return null
      return { start: i, query: text.slice(i + 1, caret) }
    }
  }
  return null
}

/** Replace the "@query" at `start..caret` with "@label " and put the caret after it. */
export function insertMention(text: string, caret: number, start: number, label: string): { text: string; caret: number } {
  const chip = `@${label} `
  const next = text.slice(0, start) + chip + text.slice(caret)
  return { text: next, caret: start + chip.length }
}

/**
 * At send: where each picked mention sits in the final text. A pick whose
 * "@label" is no longer there (deleted, or retyped) is dropped -- it mentions
 * nobody. Spans never overlap, and each occurrence is used once.
 */
export function spansFor(text: string, picked: readonly PickedMention[]): SendMention[] {
  const taken: Array<[number, number]> = []
  const free = (s: number, e: number) => taken.every(([a, b]) => e <= a || s >= b)
  const out: SendMention[] = []
  // Longer labels first, so "@Laila Mansour" is not claimed as "@Laila".
  const order = [...picked].sort((a, b) => b.label.length - a.label.length)
  for (const p of order) {
    const needle = `@${p.label}`
    for (let from = 0; ; ) {
      const at = text.indexOf(needle, from)
      if (at < 0) break
      const end = at + needle.length
      const boundaryBefore = at === 0 || /\s/.test(text[at - 1]!)
      if (boundaryBefore && free(at, end)) {
        taken.push([at, end])
        out.push('actorId' in p.target
          ? { start: at, length: needle.length, actorId: p.target.actorId }
          : { start: at, length: needle.length, role: p.target.role })
        break
      }
      from = at + 1
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** The body cut into plain runs and chips. A span that does not fit the text is drawn as text. */
export function mentionSegments(body: string, mentions: readonly ChatMention[] | undefined): Array<{ text: string; mention?: ChatMention }> {
  const valid = [...(mentions ?? [])]
    .filter((m) => m.start >= 0 && m.length > 0 && m.start + m.length <= body.length && body[m.start] === '@')
    .sort((a, b) => a.start - b.start)
  const out: Array<{ text: string; mention?: ChatMention }> = []
  let at = 0
  for (const m of valid) {
    if (m.start < at) continue // overlapping: the first wins
    if (m.start > at) out.push({ text: body.slice(at, m.start) })
    out.push({ text: body.slice(m.start, m.start + m.length), mention: m })
    at = m.start + m.length
  }
  if (at < body.length) out.push({ text: body.slice(at) })
  return out
}
