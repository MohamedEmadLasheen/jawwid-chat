/**
 * THE ICON SET.
 *
 * `design-system.md` §6: one outline set, 1.5px stroke, 20px default, and ONE
 * icon per concept product-wide. Inline SVG rather than an icon package —
 * fifteen glyphs do not justify a dependency, and inlining is what lets every
 * one of them inherit `currentColor` so a rail item, a disabled control and a
 * danger action are one component in three states rather than three assets.
 *
 * ## Mirroring
 *
 * The test is *"does this icon describe a direction in the reading flow, or a
 * direction in the physical world?"* Reading-flow glyphs (back, reply, send)
 * mirror under RTL and are marked `mirror`; physical ones (clock, paperclip,
 * check) never do. Ambiguous cases resolve to DO NOT MIRROR — an unmirrored
 * icon looks slightly odd, a wrongly-mirrored one looks broken.
 */
import type { CSSProperties } from 'react'

export type IconName =
  | 'chat'
  | 'families'
  | 'groups'
  | 'labels'
  | 'stories'
  | 'broadcast'
  | 'moderation'
  | 'command'
  | 'attention'
  | 'knowledge'
  | 'search'
  | 'close'
  | 'back'
  | 'send'
  | 'more'
  | 'reply'
  | 'info'
  | 'note'
  | 'student'
  | 'shield'
  | 'clock'
  | 'lock'

/** Glyphs that describe a direction in the reading flow, and so mirror in RTL. */
const MIRRORED: ReadonlySet<IconName> = new Set<IconName>(['back', 'send', 'reply'])

const PATHS: Record<IconName, string> = {
  chat: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.8L3 21l1.9-5.3A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z',
  families: 'M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 20v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  groups: 'M4 21v-1.5A3.5 3.5 0 0 1 7.5 16h2A3.5 3.5 0 0 1 13 19.5V21M8.5 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM15 21v-1.5a4 4 0 0 0-1.2-2.8M16 7.2a3 3 0 0 1 0 5.6M20 21v-1a4.5 4.5 0 0 0-2-3.7',
  labels: 'M20.6 13.2 13 20.8a1.7 1.7 0 0 1-2.4 0l-7-7A1.7 1.7 0 0 1 3 12.6V5a2 2 0 0 1 2-2h7.6c.5 0 .9.2 1.2.5l6.8 6.8a1.7 1.7 0 0 1 0 2.4ZM7.5 7.5h.01',
  stories: 'M4 19.5V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v14.5M4 19.5A1.5 1.5 0 0 0 5.5 21H19M8 7h7M8 11h7M8 15h4',
  broadcast: 'M3 11v2a1 1 0 0 0 1 1h2.5L12 18V6L6.5 10H4a1 1 0 0 0-1 1ZM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  moderation: 'M12 3 4 6v6c0 4.4 3.2 8.2 8 9 4.8-.8 8-4.6 8-9V6l-8-3ZM9.5 12l1.8 1.8 3.5-3.6',
  command: 'M4 20V10M9.5 20V5M15 20v-7M20.5 20V8',
  attention: 'M12 4.5 3.5 19h17L12 4.5ZM12 10v4M12 17h.01',
  knowledge: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5v-15ZM4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5Z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
  send: 'M4.5 12h15M12.5 5.5 19.5 12l-7 6.5',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  reply: 'M9 8 4.5 12 9 16M4.5 12H14a5 5 0 0 1 5 5v1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  note: 'M6 3h9l4 4v14H6V3ZM14.5 3v4.5H19M9 12h6M9 16h4',
  student: 'M12 4 2.5 8.5 12 13l9.5-4.5L12 4ZM6.5 10.8V15c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4.2M21.5 8.5V14',
  shield: 'M12 3 4.5 6v6.2c0 4.2 3.1 7.9 7.5 8.8 4.4-.9 7.5-4.6 7.5-8.8V6L12 3Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  lock: 'M6 10.5h12V21H6V10.5ZM8.5 10.5V7a3.5 3.5 0 1 1 7 0v3.5',
}

export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      className={className}
      style={{
        // The mirror is expressed here rather than in a stylesheet rule per
        // icon, so adding a glyph is one entry in MIRRORED and nothing else.
        ...(MIRRORED.has(name) ? { transform: 'scaleX(var(--icon-mirror, 1))' } : null),
        ...style,
      }}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Icons are never the only carrier of meaning: every icon-only control
      // in this app has its own accessible label, so the glyph itself is
      // decoration to a screen reader.
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
