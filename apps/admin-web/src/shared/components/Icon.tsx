import type { ReactElement } from 'react'

/**
 * One icon set, one stroke style (24px grid, 1.75 stroke, round joins), drawn
 * inline so there is no icon dependency and every glyph inherits currentColor.
 *
 * Icons are decorative by default (aria-hidden): the control they sit in owns
 * the accessible name. Arrows and chevrons that point "forward" are marked
 * directional and mirror in RTL.
 */
const PATHS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  conversations: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18.5 14.3A6.5 6.5 0 0 1 21.5 20" />
    </>
  ),
  teams: (
    <>
      <circle cx="12" cy="5.5" r="2.5" />
      <circle cx="5" cy="17.5" r="2.5" />
      <circle cx="19" cy="17.5" r="2.5" />
      <path d="M12 8v3.5M12 11.5 6.5 15.5M12 11.5l5.5 4" />
    </>
  ),
  stories: (
    <>
      <circle cx="12" cy="12" r="9" strokeDasharray="3.2 2.4" />
      <circle cx="12" cy="12" r="4.5" />
    </>
  ),
  quality: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6Z" />
      <path d="m8.8 12.2 2.2 2.2 4.2-4.4" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V6M17 16v-8" />
    </>
  ),
  notifications: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  calls: (
    <path d="M21 16.6v2.9a1.9 1.9 0 0 1-2.1 1.9A18.8 18.8 0 0 1 2.6 5.1 1.9 1.9 0 0 1 4.5 3h2.9a1.9 1.9 0 0 1 1.9 1.6c.1 1 .4 1.9.7 2.8a1.9 1.9 0 0 1-.4 2L8.3 10.7a15 15 0 0 0 5 5l1.3-1.3a1.9 1.9 0 0 1 2-.4c.9.3 1.8.6 2.8.7a1.9 1.9 0 0 1 1.6 1.9Z" />
  ),
  academy: (
    <>
      <path d="m2.5 9 9.5-5 9.5 5-9.5 5Z" />
      <path d="M6.5 11.2v4.6c0 1.4 2.5 3.2 5.5 3.2s5.5-1.8 5.5-3.2v-4.6" />
      <path d="M21.5 9v5" />
    </>
  ),
  integrations: (
    <>
      <path d="M9 3v4M15 3v4" />
      <path d="M6.5 7h11v4a5.5 5.5 0 0 1-11 0Z" />
      <path d="M12 16.5V21" />
    </>
  ),
  audit: (
    <>
      <path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  forms: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <path d="M9 10h6M9 14h6M9 18h3" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M3.5 20.5 5 15.6A8.5 8.5 0 1 1 8.4 19Z" />
      <path d="M9 9.2c0 3 2.4 5.6 5.6 5.8l1-1.6-2-1-.8.8a3.6 3.6 0 0 1-2-2l.8-.8-1-2Z" />
    </>
  ),
  tasks: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="m8 12.2 2.8 2.8L16.2 9.5" />
    </>
  ),
  approvals: (
    <>
      <path d="M9 3h6v4.5l2 1.5H7l2-1.5Z" />
      <path d="M4.5 13h15v4h-15Z" />
      <path d="M6 21h12" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),

  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.25" />
      <circle cx="12" cy="12" r="1.25" />
      <circle cx="19" cy="12" r="1.25" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronForward: <path d="m9 6 6 6-6 6" />,
  arrowBack: <path d="M19 12H5M11 6l-6 6 6 6" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.8-3.6L4 9" />
      <path d="M4 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.8 3.6L20 15" />
      <path d="M20 20v-5h-5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </>
  ),
  signOut: (
    <>
      <path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5" />
      <path d="M16 16.5 20.5 12 16 7.5M20.5 12H9.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16.5v-5M12 8h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  paperclip: <path d="m20.5 11.5-8.6 8.6a5.3 5.3 0 0 1-7.5-7.5l8.6-8.6a3.5 3.5 0 0 1 5 5l-8.6 8.6a1.8 1.8 0 0 1-2.5-2.5l7.9-7.9" />,
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15V15h-6v5.5H5.5A1.5 1.5 0 0 1 4 19Z" />
    </>
  ),
  messages: (
    <>
      <path d="M20 13.5a7.5 7.5 0 0 1-10.9 6.7L4 21.5l1.3-4.6A7.5 7.5 0 1 1 20 13.5Z" transform="translate(0 -1.5)" />
      <path d="M8.5 11h7M8.5 14h4.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  hammer: (
    <>
      <path d="m14.5 12.5-8.6 8.6a2.1 2.1 0 0 1-3-3l8.6-8.6" />
      <path d="m17.6 15.6 3.9-3.9-2.3-2.3-1-.2-1.5-1.5V6.3L14 3.6c-1.6-1.5-4-1.5-5.6-.1l3.1 3.1v1.7l3.5 3.5.3 1.3Z" />
    </>
  ),
  // Stories studio (2026-10-17).
  text: <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="m20.5 16-4.8-4.8a1.5 1.5 0 0 0-2.1 0L5 19.5" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="m16 10.5 5-3v9l-5-3" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  trash: <path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7" />,
  chart: <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" />,
  send: <path d="m4 12 16-8-6 16-2.5-6.5L4 12ZM11.5 13.5 20 4" />,
  pin: <path d="M9 4h6M10 4v5.5L7 13h10l-3-3.5V4M12 13v7" />,
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4.5" rx="1.25" />
      <path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4" />
    </>
  ),
  reply: <path d="M9.5 6 4 11.5 9.5 17M4 11.5h10a6 6 0 0 1 6 6V19" />,
  forward: <path d="M14.5 6 20 11.5 14.5 17M20 11.5H10a6 6 0 0 0-6 6V19" />,
  checkSquare: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14a4.2 4.2 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  bellOff: <path d="M6.3 6.3A6 6 0 0 0 6 9c0 6-2.5 7.5-2.5 7.5h13M9 4a6 6 0 0 1 9 5c0 2.5.4 4.2.9 5.4M10 20a2.2 2.2 0 0 0 4 0M3 3l18 18" />,
  /** Favorite chats (WhatsApp's Favorites list). */
  heart: <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" />,
  /** Edit a message. */
  pencil: <path d="M14.5 5.5 18.5 9.5M4 20l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L8.5 19 4 20Z" />,
  // Calls page (PD-13).
  calendarPlus: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5" />
    </>
  ),
  /** A call that came in: an arrow down to the corner. */
  callIncoming: <path d="M17 7 7 17M7 9.5V17h7.5" />,
  /** A call this account placed: an arrow up and away. */
  callOutgoing: <path d="M7 17 17 7M9.5 7H17v7.5" />,
  tag: (
    <>
      <path d="M3.5 12.1V4.5a1 1 0 0 1 1-1h7.6a1 1 0 0 1 .7.3l7.7 7.7a1 1 0 0 1 0 1.4l-7.6 7.6a1 1 0 0 1-1.4 0l-7.7-7.7a1 1 0 0 1-.3-.7Z" />
      <path d="M8 8h.01" />
    </>
  ),
  /** PD-36: an @mention. */
  at: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </>
  ),
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />,
  /** PD-29 Materials: an open book. */
  book: (
    <>
      <path d="M12 6.5C10.3 5.2 7.9 4.5 4 4.5v13c3.9 0 6.3.7 8 2 1.7-1.3 4.1-2 8-2v-13c-3.9 0-6.3.7-8 2Z" />
      <path d="M12 6.5v13" />
    </>
  ),
  /** PD-47: the Finance tag on a financial task. */
  banknote: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v.01M18 14.5v.01" />
    </>
  ),
} satisfies Record<string, ReactElement>

export type IconName = keyof typeof PATHS

const DIRECTIONAL: ReadonlySet<IconName> = new Set<IconName>(['chevronForward', 'arrowBack', 'signOut', 'send', 'reply', 'forward'])

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
  return (
    <svg
      className={DIRECTIONAL.has(name) ? 'icon icon--directional' : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
