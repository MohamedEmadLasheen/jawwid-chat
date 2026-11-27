import type { ReactElement } from 'react'

/**
 * The two-tone set: the icons that name a place or a primary action.
 *
 * Same 24px grid and stroke as the rest, but each is drawn with its own
 * silhouette and one signature detail in gold (`accent`), so no two read alike
 * when the rail is scanned. `base` takes currentColor; `accent` takes
 * `--icon-accent`.
 */
export interface Duotone {
  base: ReactElement
  accent: ReactElement
}

export const DUOTONE = {
  /* ---- places ---- */
  conversations: {
    base: (
      <>
        <path d="M4 5h16v11H10.5L6 19.8V16H4Z" />
        <path d="M8 9h8" />
      </>
    ),
    accent: <path d="M8 12.2h5" />,
  },
  home: {
    base: <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19Z" />,
    accent: <path d="M10 20.5V15h4v5.5" />,
  },
  dashboard: {
    base: (
      <>
        <path d="M4 20V5" />
        <path d="M4 20h16.5" />
        <path d="M8 16.5v-4M12.5 16.5v-8" />
      </>
    ),
    accent: <path d="M17 16.5V6" />,
  },
  tasks: {
    base: (
      <>
        <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
        <path d="M9 4.5v-1h6v1" />
      </>
    ),
    accent: <path d="m8.8 13.2 2.2 2.2 4.2-4.6" />,
  },
  requests: {
    base: (
      <>
        <path d="M3.5 13.5 6 5.5h12l2.5 8v5h-17Z" />
        <path d="M3.5 13.5h5l1 2.5h5l1-2.5h5" />
      </>
    ),
    accent: <path d="M9.5 9h5" />,
  },
  people: {
    base: (
      <>
        <circle cx="12" cy="6" r="2.6" />
        <path d="M7.5 13.5a4.5 4.5 0 0 1 9 0" />
        <rect x="3" y="17.5" width="5" height="3.5" rx="0.8" />
        <rect x="16" y="17.5" width="5" height="3.5" rx="0.8" />
      </>
    ),
    accent: <path d="M5.5 17.5v-1.7h13v1.7M12 13.5v2.3" />,
  },
  parents: {
    base: (
      <>
        <circle cx="8.5" cy="8" r="3.2" />
        <path d="M2.5 19.5a6 6 0 0 1 12 0" />
        <circle cx="17.2" cy="10.2" r="2.3" />
      </>
    ),
    accent: <path d="M16.8 19.5a5.4 5.4 0 0 0-1.3-3.6 4.2 4.2 0 0 1 6 3.6" />,
  },
  students: {
    base: (
      <>
        <path d="m2.5 9.5 9.5-4.5 9.5 4.5-9.5 4.5Z" />
        <path d="M6.5 11.6v4.2c0 1.2 2.4 2.7 5.5 2.7s5.5-1.5 5.5-2.7v-4.2" />
      </>
    ),
    accent: <path d="M21.5 9.5v5" />,
  },
  teachers: {
    base: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="1.5" />
        <path d="m8 20.5 2-4.5M16 20.5 14 16" />
        <path d="M7 11.5h3.5" />
      </>
    ),
    accent: <path d="M7 8.3h7" />,
  },
  staff: {
    base: (
      <>
        <circle cx="9.5" cy="7.8" r="3.3" />
        <path d="M3 20a6.5 6.5 0 0 1 9.6-5.7" />
      </>
    ),
    accent: (
      <>
        <rect x="14.5" y="13.5" width="6.5" height="7.5" rx="1.2" />
        <path d="M16.6 17.6h2.3" />
      </>
    ),
  },
  accounts: {
    base: (
      <>
        <circle cx="8" cy="15.5" r="4" />
        <path d="m11 12.6 8.5-8.5" />
      </>
    ),
    accent: <path d="m16 7.6 2.4 2.4M18.6 5 21 7.4" />,
  },
  users: {
    base: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8.6" cy="10.6" r="2" />
        <path d="M5.6 16a3 3 0 0 1 6 0" />
      </>
    ),
    accent: <path d="M14.5 10h4M14.5 13.5h2.6" />,
  },
  teams: {
    base: (
      <>
        <circle cx="12" cy="5.5" r="2.5" />
        <circle cx="5" cy="17.5" r="2.5" />
        <circle cx="19" cy="17.5" r="2.5" />
      </>
    ),
    accent: <path d="M12 8v3.5M12 11.5 6.5 15.5M12 11.5l5.5 4" />,
  },
  organization: {
    base: (
      <>
        <rect x="8.5" y="3" width="7" height="5" rx="1" />
        <rect x="2.5" y="16" width="7" height="5" rx="1" />
        <rect x="14.5" y="16" width="7" height="5" rx="1" />
      </>
    ),
    accent: <path d="M12 8v4M6 16v-4h12v4" />,
  },
  credentials: {
    base: <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6Z" />,
    accent: <path d="m8.8 12.2 2.2 2.2 4.2-4.4" />,
  },
  attendance: {
    base: (
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </>
    ),
    accent: <path d="m8.7 15 2.2 2.1 4.4-4.4" />,
  },
  grants: {
    base: (
      <>
        <rect x="3.5" y="9" width="17" height="4" rx="1" />
        <path d="M5.5 13v7.5h13V13" />
        <path d="M12 9c-1-3.5-2.8-5-4.4-4.6C5.5 5 6.5 9 12 9Zm0 0c1-3.5 2.8-5 4.4-4.6C18.5 5 17.5 9 12 9Z" />
      </>
    ),
    accent: <path d="M12 9v11.5" />,
  },
  sales: {
    base: (
      <>
        <path d="M3.5 20.5h17" />
        <path d="M6 20.5v-5M11 20.5V12" />
        <path d="M16 20.5V8.5" />
      </>
    ),
    accent: <path d="m5 9.5 5.5-4 3 2.2L19.5 3M19.5 3h-3.7M19.5 3v3.7" />,
  },
  pipeline: {
    base: <path d="M3.5 4.5h17l-6.5 8v6l-4 2v-8Z" />,
    accent: <path d="M7.3 8.5h9.4" />,
  },
  trials: {
    base: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5V2M12 22v-1.5" />
      </>
    ),
    accent: <path d="M10.2 8.7v6.6l5.3-3.3Z" />,
  },
  newStudents: {
    base: (
      <>
        <circle cx="9.5" cy="8" r="3.3" />
        <path d="M3 20a6.5 6.5 0 0 1 11.5-4.2" />
      </>
    ),
    accent: <path d="M18 13.5v6M15 16.5h6" />,
  },
  calendar: {
    base: (
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </>
    ),
    accent: <rect x="13.3" y="13" width="3.6" height="3.6" rx="0.7" />,
  },
  teacherSchedules: {
    base: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9.3h18M9 9.3V20" />
        <path d="M12 16.5h3" />
      </>
    ),
    accent: <path d="M12 12.8h6" />,
  },
  studentSchedules: {
    base: (
      <>
        <path d="M4 6.5h16M4 12h16M4 17.5h16" />
        <path d="M4 4v16" />
      </>
    ),
    accent: (
      <>
        <rect x="7.5" y="4.8" width="5" height="3.4" rx="0.7" />
        <rect x="13" y="15.8" width="4.5" height="3.4" rx="0.7" />
      </>
    ),
  },
  operations: {
    base: (
      <>
        <path d="M4 7h9M17.5 7H20M4 17h3M11.5 17H20" />
        <circle cx="15.2" cy="7" r="2.2" />
      </>
    ),
    accent: <circle cx="9.2" cy="17" r="2.2" />,
  },
  needsAction: {
    base: <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
    accent: <path d="M12 9.5v4M12 17h.01" />,
  },
  lessonAudio: {
    base: <path d="M4 10v4M8 6.5v11M16 8v8M20 10.5v3" />,
    accent: <path d="M12 3.5v17" />,
  },
  moderation: {
    base: <path d="M5 21V4M5 4.5h12.5l-2.5 4 2.5 4H5" />,
    accent: <path d="M8.5 8.5h3.5" />,
  },
  certificates: {
    base: (
      <>
        <circle cx="12" cy="9" r="5.5" />
        <path d="m8.7 13.5-1.7 7.5 5-2.7 5 2.7-1.7-7.5" />
      </>
    ),
    accent: <circle cx="12" cy="9" r="2" />,
  },
  materials: {
    base: (
      <>
        <path d="M12 6.5C10.3 5.2 7.9 4.5 4 4.5v13c3.9 0 6.3.7 8 2 1.7-1.3 4.1-2 8-2v-13c-3.9 0-6.3.7-8 2Z" />
        <path d="M12 6.5v13" />
      </>
    ),
    accent: <path d="M15 8.2c1-.4 2-.6 3-.7M15 11.5c1-.4 2-.6 3-.7" />,
  },
  finance: {
    base: (
      <>
        <path d="M17.5 8V5.5H6a2 2 0 0 0-2 2" />
        <path d="M4 7.5v10a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6a2 2 0 0 1-2-.5Z" />
      </>
    ),
    accent: <path d="M15.3 13.8h2.4" strokeWidth={2.4} />,
  },
  instalments: {
    base: (
      <>
        <rect x="4" y="3.5" width="16" height="17" rx="2" />
        <path d="M8 8.5h8M8 12.5h3" />
      </>
    ),
    accent: <path d="M8 16.5h1.5M11.5 16.5H13M15 16.5h1" strokeWidth={2.2} />,
  },
  payments: {
    base: (
      <>
        <path d="M6 3.5h12V21l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21Z" />
        <path d="M9 8h6M9 11.5h6" />
      </>
    ),
    accent: <path d="M12.5 15.5H15" />,
  },
  communication: {
    base: (
      <>
        <path d="M4 10v4h3l7 4.5v-13L7 10Z" />
        <path d="M7.5 14.5 9 20h2.5" />
      </>
    ),
    accent: <path d="M17.5 9.5a4 4 0 0 1 0 5M19.8 7a7.5 7.5 0 0 1 0 10" />,
  },
  calls: {
    base: (
      <path d="M20.5 16.8v2.6a1.8 1.8 0 0 1-2 1.8A17.7 17.7 0 0 1 2.8 5.5a1.8 1.8 0 0 1 1.8-2h2.6A1.8 1.8 0 0 1 9 5c.1.9.4 1.8.7 2.6a1.8 1.8 0 0 1-.4 1.9L8.2 10.6a14 14 0 0 0 5.2 5.2l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.8.3 1.7.6 2.6.7a1.8 1.8 0 0 1 1.5 1.8Z" />
    ),
    accent: <path d="M14.5 3.8a6 6 0 0 1 5.7 5.7" />,
  },
  stories: {
    base: <circle cx="12" cy="12" r="9" strokeDasharray="3.2 2.4" />,
    accent: <circle cx="12" cy="12" r="4.3" />,
  },
  notifications: {
    base: <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />,
    accent: <path d="M10 20a2.2 2.2 0 0 0 4 0" />,
  },
  admin: {
    base: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      </>
    ),
    accent: (
      <>
        <circle cx="17" cy="17" r="1.6" />
        <path d="M17 13.2v1M17 19.8v1M13.2 17h1M19.8 17h1" />
      </>
    ),
  },

  /* ---- actions ---- */
  search: {
    base: <circle cx="11" cy="11" r="7" />,
    accent: <path d="m20 20-3.5-3.5" />,
  },
  phone: {
    base: (
      <path d="M20.5 16.8v2.6a1.8 1.8 0 0 1-2 1.8A17.7 17.7 0 0 1 2.8 5.5a1.8 1.8 0 0 1 1.8-2h2.6A1.8 1.8 0 0 1 9 5c.1.9.4 1.8.7 2.6a1.8 1.8 0 0 1-.4 1.9L8.2 10.6a14 14 0 0 0 5.2 5.2l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.8.3 1.7.6 2.6.7a1.8 1.8 0 0 1 1.5 1.8Z" />
    ),
    accent: <path d="M15 4.5h5v5M20 4.5 14.5 10" />,
  },
  download: {
    base: <path d="M12 4v11M7.5 10.8l4.5 4.5 4.5-4.5" />,
    accent: <path d="M4.5 19.5h15" />,
  },
  language: {
    base: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
      </>
    ),
    accent: <path d="M3 12h18" />,
  },
  lockNote: {
    base: <rect x="4.5" y="10.5" width="15" height="10" rx="2" />,
    accent: <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />,
  },
} satisfies Record<string, Duotone>

export type DuotoneName = keyof typeof DUOTONE
