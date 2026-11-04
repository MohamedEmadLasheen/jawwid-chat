/**
 * PARENT-003: the longest message body, in characters as a person counts them
 * (grapheme clusters -- one emoji, one Arabic letter with its marks, is one).
 * The same number, counted the same way, as the clients: the mobile composer's
 * TextField maxLength (MessageComposer.maxCharacters) and the Admin Web
 * composer's counter. A media caption is a body too.
 */
export const MESSAGE_MAX_CHARACTERS = 4000;
/**
 * However few clusters, a body is never more than this many UTF-16 units: a
 * single "character" stacked with thousands of combining marks is not text.
 */
export const MESSAGE_MAX_CODE_UNITS = MESSAGE_MAX_CHARACTERS * 4;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** How many characters a person sees in `text`. */
export function messageLength(text: string): number {
  // A cluster is at least one code unit, so a short string needs no counting.
  if (text.length <= MESSAGE_MAX_CHARACTERS) return text.length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n += 1;
  return n;
}

/** Whether `text` is longer than a message may be. */
export function messageTooLong(text: string): boolean {
  return text.length > MESSAGE_MAX_CODE_UNITS || messageLength(text) > MESSAGE_MAX_CHARACTERS;
}
