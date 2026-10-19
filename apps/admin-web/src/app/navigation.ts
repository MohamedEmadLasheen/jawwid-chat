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
  { key: 'calls', icon: 'calls', label: { en: 'Calls & media', ar: 'المكالمات والوسائط' } },
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
  families: 'people',
  organization: 'people',
  teachers: 'people',
  instalments: 'people',
  trials: 'people',
  coverage: 'people',
  stories: 'stories',
  tasks: 'more',
  dashboard: 'more',
  settings: null,
}

export const AREA_PATH: Record<OperatorArea, string> = {
  chat: '/chat',
  inbox: '/inbox',
  families: '/families',
  organization: '/organization',
  teachers: '/teachers',
  instalments: '/instalments',
  trials: '/trials',
  tasks: '/tasks',
  coverage: '/coverage',
  dashboard: '/dashboard',
  stories: '/stories',
}

const AREA_ICON: Record<OperatorArea, IconName> = {
  chat: 'conversations',
  inbox: 'conversations',
  families: 'users',
  organization: 'teams',
  teachers: 'academy',
  instalments: 'calendar',
  trials: 'calendar',
  tasks: 'tasks',
  coverage: 'teams',
  dashboard: 'dashboard',
  stories: 'stories',
}

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
      path: AREA_PATH[area],
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
