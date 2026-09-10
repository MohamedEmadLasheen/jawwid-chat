/**
 * An identity mark for a conversation or a person.
 *
 * There are no uploaded avatars in this product, so this draws initials on a
 * tinted disc. Two rules it exists to keep:
 *
 *   - **It never carries meaning on its own.** The shape says only what KIND
 *     of conversation this is (a group's mark is a rounded square, a person's
 *     is a circle); everything else — who, what state, whether it needs a
 *     reply — is words elsewhere in the row.
 *   - **It is decorative to assistive tech.** The name it abbreviates is
 *     always rendered as real text beside it, so announcing the initials again
 *     would be noise.
 */
export function Avatar({
  name,
  kind = 'person',
  size = 'md',
  tone,
}: {
  name: string
  kind?: 'person' | 'group'
  size?: 'sm' | 'md' | 'lg'
  tone?: 'brand' | 'muted'
}) {
  const classes = [
    'avatar',
    size === 'sm' ? 'avatar--sm' : size === 'lg' ? 'avatar--lg' : '',
    kind === 'group' ? 'avatar--group' : '',
    tone === 'muted' ? 'avatar--muted' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span className={classes} aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}

/**
 * Up to two initials, from real name tokens only.
 *
 * ## What counts as a token
 *
 * A conversation title can be a composed identity — `learner_smoke · Jawwid`,
 * `أسرة العبد الله`, `parent_smoke، manager_smoke` — so the separators people
 * and the server put between names must never become initials. A token has to
 * contain at least one LETTER OR DIGIT to count; `·`, `—`, `،`, `-` and `|`
 * are punctuation, and punctuation is not a name. Without this the group
 * `learner_smoke · Jawwid` rendered as «l·».
 *
 * The definite article «ال» is dropped, because «أسرة العبد الله» abbreviated
 * to «أ ا» says nothing that «أ ع» does not say better. Leading punctuation
 * inside a token (`_smoke`, `(Jawwid)`) is trimmed for the same reason.
 *
 * ## Case
 *
 * Uppercased. Arabic script has no case, so this is a no-op there and a real
 * improvement for the Latin names that fixtures and mixed families produce —
 * «LJ» rather than «lJ». `toUpperCase` without a locale is deliberate: a
 * locale-aware uppercase would apply Turkish dotted-I rules to names that are
 * not Turkish.
 *
 * Uses `Array.from` so a name beginning with an astral character (an emoji in
 * a group title) yields that whole character rather than half of a surrogate
 * pair.
 */
export function initialsOf(name: string): string {
  const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

  const words = name
    .trim()
    .split(/\s+/)
    // A token with no letter and no digit is a separator, not a name.
    .filter((word) => LETTER_OR_DIGIT.test(word))
    // Trim punctuation that would otherwise become the initial.
    .map((word) => word.replace(/^[^\p{L}\p{N}]+/u, ''))
    .map((word) => (word.startsWith('ال') && Array.from(word).length > 2 ? word.slice(2) : word))
    .filter((word) => word.length > 0)

  if (words.length === 0) return '؟'

  const first = Array.from(words[0]!)
  if (words.length === 1) return first.slice(0, 2).join('').toUpperCase()
  return `${first[0]}${Array.from(words[1]!)[0]}`.toUpperCase()
}
