import { isSuperAdmin, navAreas, type DepartmentAccess, type NavArea } from '@/core/permissions/capabilities'
import type { StaffRole } from '@/shared/types/domain'
import {
  ADMIN_GROUPS,
  ADMIN_SECTIONS,
  adminSectionPath,
  type AdminSectionKey,
} from '@/features/admin/sections'
import type { Bilingual } from '@/features/admin/copy'
import type { IconName } from '@/shared/components/Icon'

/**
 * The primary navigation: a handful of destinations, each holding the routes
 * that belong to it. Every route a role may open has exactly one place here,
 * so shrinking the navigation never makes a page unreachable; and nothing a
 * role may not open is listed, so it never advertises a page that would only
 * answer "forbidden". (Listing is UX, not security: the server decides.)
 */

export type DestinationKey = 'conversations' | 'calls' | 'people' | 'stories' | 'more'

type OperatorArea = Exclude<NavArea, 'settings'>

export type EntryLabel = { text: Bilingual } | { message: `nav.${OperatorArea}` }

export interface NavEntry {
  /** The section or area key; unique within a role's navigation. */
  key: string
  path: string
  icon: IconName
  label: EntryLabel
  /** A placeholder page: it says so, and does nothing else. */
  inDevelopment: boolean
}

export interface NavEntryGroup {
  key: string
  /** A heading inside a destination; null when the destination needs none. */
  label: Bilingual | null
  entries: NavEntry[]
}

export interface Destination {
  key: DestinationKey
  icon: IconName
  label: Bilingual
  groups: NavEntryGroup[]
}

export const DESTINATIONS: readonly { key: DestinationKey; icon: IconName; label: Bilingual }[] = [
  { key: 'conversations', icon: 'conversations', label: { en: 'Conversations', ar: 'المحادثات' } },
  { key: 'calls', icon: 'calls', label: { en: 'Calls', ar: 'المكالمات' } },
  { key: 'people', icon: 'users', label: { en: 'People & teams', ar: 'الأشخاص والفرق' } },
  { key: 'stories', icon: 'stories', label: { en: 'Stories', ar: 'الحالات' } },
  { key: 'more', icon: 'more', label: { en: 'More', ar: 'المزيد' } },
]

/**
 * Where each Admin Portal section lives. A Record, so a section added to the
 * registry does not compile until it has been given a place.
 *
 * The Dashboard is under More: it is no longer the front door (Conversations
 * is), but it stays one click away and its URL keeps working.
 */
export const SECTION_DESTINATION: Record<AdminSectionKey, DestinationKey> = {
  conversations: 'conversations',
  calls: 'calls',
  users: 'people',
  teams: 'people',
  teachers: 'people',
  instalments: 'more',
  parents: 'people',
  payments: 'more',
  stories: 'stories',
  dashboard: 'more',
  notifications: 'more',
  whatsapp: 'more',
  quality: 'more',
  academy: 'more',
  tasks: 'more',
  forms: 'more',
  reports: 'more',
  approvals: 'more',
  integrations: 'more',
  audit: 'more',
  settings: 'more',
}

/** Operator areas. `settings` has no page, so it has no place (as before). */
export const AREA_DESTINATION: Record<NavArea, DestinationKey | null> = {
  chat: 'conversations',
  inbox: 'conversations',
  calls: 'calls',
  organization: 'people',
  teachers: 'people',
  instalments: 'people',
  parents: 'people',
  payments: 'people',
  trials: 'people',
  'teacher-profiles': 'people',
  accounts: 'people',
  stories: 'stories',
  materials: 'more',
  schedule: 'people',
  tasks: 'more',
  // PD-35 B5: escalation cases, for every operator who may open or own one.
  cases: 'people',
  dashboard: 'more',
  settings: null,
}

export const AREA_PATH: Record<OperatorArea, string> = {
  chat: '/chat',
  inbox: '/inbox',
  calls: '/calls',
  organization: '/organization',
  teachers: '/teachers',
  instalments: '/instalments',
  parents: '/parents',
  payments: '/payments',
  trials: '/trials',
  tasks: '/tasks',
  dashboard: '/dashboard',
  stories: '/stories',
  'teacher-profiles': '/teacher-profiles',
  accounts: '/accounts',
  materials: '/materials',
  schedule: '/schedule',
  cases: '/cases',
}

const AREA_ICON: Record<OperatorArea, IconName> = {
  chat: 'conversations',
  inbox: 'conversations',
  calls: 'calls',
  organization: 'teams',
  teachers: 'academy',
  instalments: 'calendar',
  parents: 'users',
  payments: 'tag',
  trials: 'calendar',
  tasks: 'tasks',
  dashboard: 'dashboard',
  stories: 'stories',
  'teacher-profiles': 'approvals',
  accounts: 'lock',
  materials: 'book',
  schedule: 'calendar',
  cases: 'tasks',
}

/** The super admin's name for /chat, distinct from the read-only section's. */
export const ADMIN_CHAT_LABEL: Bilingual = { en: 'Chat', ar: 'الدردشة' }

/** PD-29: the Materials library, under More. */
export const ADMIN_MATERIALS_LABEL: Bilingual = { en: 'Materials', ar: 'المواد التعليمية' }

/** PD-38: the scheduling calendar, under People. */
export const ADMIN_SCHEDULE_LABEL: Bilingual = { en: 'Schedule', ar: 'الجدول' }

/** PD-11 T4 / PD-16: trial lessons and new students, under People. */
export const ADMIN_TRIALS_LABEL: Bilingual = { en: 'Trials & new students', ar: 'الحصص التجريبية والطلاب الجدد' }

/** PD-35 B5: escalation cases, under People. */
export const ADMIN_CASES_LABEL: Bilingual = { en: 'Escalations', ar: 'التصعيدات' }

/** PD-21: account administration, beside the read-only Users section. */
export const ADMIN_ACCOUNTS_LABEL: Bilingual = { en: 'Accounts', ar: 'الحسابات' }

function adminDestinations(): Map<DestinationKey, NavEntryGroup[]> {
  const out = new Map<DestinationKey, NavEntryGroup[]>()
  // Sections keep their registry order; inside a destination that spans more
  // than one registry group (More), each group becomes a heading.
  for (const group of ADMIN_GROUPS) {
    for (const section of ADMIN_SECTIONS.filter((s) => s.group === group.key)) {
      const dest = SECTION_DESTINATION[section.key]
      const groups = out.get(dest) ?? []
      let bucket = groups.find((g) => g.key === group.key)
      if (!bucket) {
        bucket = { key: group.key, label: group.label, entries: [] }
        groups.push(bucket)
      }
      bucket.entries.push({
        key: section.key,
        path: adminSectionPath(section.key),
        icon: section.icon,
        label: { text: section.navLabel ?? section.label },
        inDevelopment: section.status === 'in_development',
      })
      out.set(dest, groups)
    }
  }
  // PD-8: the super admin replies in the Chat workspace -- the same
  // conversations, on the real conversation API. It leads its destination, so
  // replying is offered first and read-only inspection second.
  out.get('conversations')?.[0]?.entries.unshift({
    key: 'chat',
    path: AREA_PATH.chat,
    icon: AREA_ICON.chat,
    label: { text: ADMIN_CHAT_LABEL },
    inDevelopment: false,
  })
  // PD-21: the super admin administers accounts (reset, set inactive) at
  // /accounts, the same page every staff role has; Users stays read-only.
  out.get('people')?.[0]?.entries.push({
    key: 'accounts',
    path: AREA_PATH.accounts,
    icon: AREA_ICON.accounts,
    label: { text: ADMIN_ACCOUNTS_LABEL },
    inDevelopment: false,
  })
  // PD-38: the academy's schedule at /schedule, the same page the Teachers
  // department and Operations have.
  out.get('people')?.[0]?.entries.push({
    key: 'schedule',
    path: AREA_PATH.schedule,
    icon: AREA_ICON.schedule,
    label: { text: ADMIN_SCHEDULE_LABEL },
    inDevelopment: false,
  })
  // PD-11 T4 / PD-16: trial lessons and new students at /trials, the same
  // pages Sales and Operations have; the server admits the super admin to
  // both, and the page offers each tab GET /lessons/access confirms.
  out.get('people')?.[0]?.entries.push({
    key: 'trials',
    path: AREA_PATH.trials,
    icon: AREA_ICON.trials,
    label: { text: ADMIN_TRIALS_LABEL },
    inDevelopment: false,
  })
  // PD-29: the super admin manages the Materials library at /materials, the
  // same page the Teachers manager has.
  out.get('more')?.[0]?.entries.push({
    key: 'materials',
    path: AREA_PATH.materials,
    icon: AREA_ICON.materials,
    label: { text: ADMIN_MATERIALS_LABEL },
    inDevelopment: false,
  })
  // PD-35 B5: the escalation cases the super admin sees and acts on, at /cases.
  out.get('people')?.[0]?.entries.push({
    key: 'cases',
    path: AREA_PATH.cases,
    icon: AREA_ICON.cases,
    label: { text: ADMIN_CASES_LABEL },
    inDevelopment: false,
  })
  // One registry group inside a destination needs no heading.
  for (const groups of out.values()) {
    if (groups.length === 1) groups[0]!.label = null
  }
  return out
}

function operatorDestinations(role: StaffRole, access: DepartmentAccess): Map<DestinationKey, NavEntryGroup[]> {
  const out = new Map<DestinationKey, NavEntryGroup[]>()
  // navAreas, not visibleAreas: the legacy Inbox stays routable but is never offered.
  for (const area of navAreas(role, access)) {
    const dest = AREA_DESTINATION[area]
    if (dest === null || area === 'settings') continue
    const groups = out.get(dest) ?? [{ key: dest, label: null, entries: [] }]
    groups[0]!.entries.push({
      key: area,
      // PD-26 amendment: without the Teachers department, the Teachers area is its Supervision page.
      path: area === 'teachers' && access.lessonManager !== true ? `${AREA_PATH.teachers}/supervision` : AREA_PATH[area],
      icon: AREA_ICON[area],
      label: { message: `nav.${area}` },
      inDevelopment: false,
    })
    out.set(dest, groups)
  }
  return out
}

/**
 * The destinations this role sees, in rail order; empty ones are left out.
 * `opts` is the server's answers to GET /lessons/access (PD-11 T4/T5) and
 * GET /instalments/access (PD-12 S3).
 */
export function destinationsFor(role: StaffRole, opts: DepartmentAccess = {}): Destination[] {
  const byKey = isSuperAdmin(role) ? adminDestinations() : operatorDestinations(role, opts)
  return DESTINATIONS.filter((d) => byKey.has(d.key)).map((d) => ({ ...d, groups: byKey.get(d.key)! }))
}

export function entriesOf(destination: Destination): NavEntry[] {
  return destination.groups.flatMap((g) => g.entries)
}

/**
 * A destination with a single page is that page: the rail links straight to
 * it, under the page's own name and icon, instead of opening a one-item menu.
 */
export function soleEntry(destination: Destination): NavEntry | null {
  const entries = entriesOf(destination)
  return entries.length === 1 ? entries[0]! : null
}

/** Which destination the current page belongs to, if any. */
export function destinationForPath(destinations: Destination[], pathname: string): DestinationKey | null {
  for (const d of destinations) {
    if (entriesOf(d).some((e) => pathname === e.path || pathname.startsWith(`${e.path}/`))) return d.key
  }
  return null
}
