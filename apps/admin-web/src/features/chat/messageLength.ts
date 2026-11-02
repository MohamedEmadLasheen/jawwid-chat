/**
 * PARENT-003: the longest message, as the server and the mobile composer count
 * it -- characters a person sees (grapheme clusters). Mirrors
 * apps/api/src/communication/messages/message-length.ts; change both together.
 */
export const MESSAGE_MAX_CHARACTERS = 4000
const MESSAGE_MAX_CODE_UNITS = MESSAGE_MAX_CHARACTERS * 4
/** The counter appears this close to the limit; nearer than that it is noise. */
export const MESSAGE_COUNTER_FROM = MESSAGE_MAX_CHARACTERS - 200

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

export function messageLength(text: string): number {
  if (text.length <= MESSAGE_MAX_CHARACTERS || !segmenter) return text.length
  let n = 0
  for (const _ of segmenter.segment(text)) n += 1
  return n
}

export function messageTooLong(text: string): boolean {
  return text.length > MESSAGE_MAX_CODE_UNITS || messageLength(text) > MESSAGE_MAX_CHARACTERS
}
