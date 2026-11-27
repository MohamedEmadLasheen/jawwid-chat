import { GLYPHS, type GlyphName } from './glyphs'

/**
 * One icon set, one weight, one grid: Phosphor regular (glyphs.ts), drawn
 * inline so every glyph inherits currentColor and there is no icon dependency.
 *
 * Icons are decorative by default (aria-hidden): the control they sit in owns
 * the accessible name. Arrows and chevrons that point "forward" are marked
 * directional and mirror in RTL.
 */
export type IconName = GlyphName

const DIRECTIONAL: ReadonlySet<IconName> = new Set<IconName>([
  'chevronForward',
  'caretLeft',
  'arrowBack',
  'arrowForward',
  'signOut',
  'send',
  'reply',
  'forward',
  'external',
])

export function Icon({
  name,
  size = 18,
  label,
}: {
  name: IconName
  size?: number
  /** Only for an icon that stands alone with no text beside it. */
  label?: string
}) {
  const glyph: string | readonly string[] = GLYPHS[name]
  const paths = typeof glyph === 'string' ? [glyph] : glyph
  return (
    <svg
      className={DIRECTIONAL.has(name) ? 'icon icon--directional' : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
