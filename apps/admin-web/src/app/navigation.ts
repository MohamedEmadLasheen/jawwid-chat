import { ATTENDANCE_PATH, GRANTS_PATH } from '@/features/teacher-records/paths'
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

export type DestinationKey = 'conversations' | 'dashboard' | 'calls' | 'people' | 'sales' | 'scheduling' | 'stories' | 'more'

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
  /**
   * Another entry's path lies beneath this one's (`/trials` and
   * `/trials/new-students`): the link is current on its own page only.
   */
  exact?: boolean
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
  // PD-44: a manager's Dashboard is one click from anywhere, beside the chats it counts.
  { key: 'dashboard', icon: 'dashboard', label: { en: 'Dashboard', ar: 'لوحة المتابعة' } },
  // The owner's order: People & Organization is the third icon.
  { key: 'people', icon: 'users', label: { en: 'People & Organization', ar: 'الأشخاص والهيكل التنظيمي' } },
  // Sales and Scheduling are the two most-used workspaces after People.
  { key: 'sales', icon: 'tag', label: { en: 'Sales', ar: 'المبيعات' } },
  { key: 'scheduling', icon: 'calendar', label: { en: 'Scheduling', ar: 'الجدولة' } },
  { key: 'calls', icon: 'calls', label: { en: 'Calls', ar: 'المكالمات' } },
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
  calls: 'calls',
  organization: 'people',
  teachers: 'people',
  instalments: 'more',
  parents: 'people',
  payments: 'more',
  trials: 'sales',
  'new-students': 'sales',
  'teacher-schedules': 'scheduling',
  'student-schedules': 'scheduling',
  'teacher-profiles': 'people',
  accounts: 'people',
  stories: 'stories',
  materials: 'more',
  schedule: 'scheduling',
  tasks: 'more',
  // PD-35 B5: escalation cases, for every operator who may open or own one.
  cases: 'more',
  // PD-41: the Certificates page.
  certificates: 'more',
  // PD-48: lesson voice-over review.
  'lesson-audio': 'more',
  // PD-57: the moderation queue.
  moderation: 'more',
  // PD-52: the teacher-records pages, in their own group under People.
  'teacher-attendance': 'people',
  'teacher-grants': 'people',
  // PD-44: out of More, its own destination (the super admin's stays in the
  // Admin Portal's More until PD-44 PR-8).
  dashboard: 'dashboard',
  settings: null,
}

export const AREA_PATH: Record<OperatorArea, string> = {
  chat: '/chat',
  calls: '/calls',
  organization: '/organization',
  teachers: '/teachers',
  instalments: '/instalments',
  parents: '/parents',
  payments: '/payments',
  trials: '/trials',
  'new-students': '/trials/new-students',
  'teacher-schedules': '/teachers/schedules',
  'student-schedules': '/schedule/students',
  tasks: '/tasks',
  dashboard: '/dashboard',
  stories: '/stories',
  'teacher-profiles': '/teacher-profiles',
  accounts: '/accounts',
  materials: '/materials',
  schedule: '/schedule',
  cases: '/cases',
  certificates: '/certificates',
  'lesson-audio': '/lesson-audio',
  moderation: '/moderation',
  'teacher-attendance': ATTENDANCE_PATH,
  'teacher-grants': GRANTS_PATH,
}

const AREA_ICON: Record<OperatorArea, IconName> = {
  chat: 'conversations',
  calls: 'calls',
  organization: 'teams',
  teachers: 'academy',
  instalments: 'calendar',
  parents: 'users',
  payments: 'tag',
  trials: 'calendar',
  'new-students': 'users',
  'teacher-schedules': 'calendar',
  'student-schedules': 'calendar',
  tasks: 'tasks',
  dashboard: 'dashboard',
  stories: 'stories',
  'teacher-profiles': 'approvals',
  accounts: 'lock',
  materials: 'book',
  schedule: 'calendar',
  cases: 'tasks',
  certificates: 'star',
  'lesson-audio': 'approvals',
  moderation: 'alert',
  'teacher-attendance': 'calendar',
  'teacher-grants': 'star',
}

/** The super admin's name for /chat, distinct from the read-only section's. */
export const ADMIN_CHAT_LABEL: Bilingual = { en: 'Chat', ar: 'الدردشة' }

/** PD-29: the Materials library, under More. */
export const ADMIN_MATERIALS_LABEL: Bilingual = { en: 'Materials', ar: 'المواد التعليمية' }

/** PD-38: the academy's calendar, first page of Scheduling. */
export const ADMIN_SCHEDULE_LABEL: Bilingual = { en: 'Academy calendar', ar: 'تقويم الأكاديمية' }

/** PD-11 T4 / PD-16: trial lessons, first page of Sales. */
export const ADMIN_TRIALS_LABEL: Bilingual = { en: 'Trial lessons', ar: 'الحصص التجريبية' }

/** Teacher Profile V2: the credential review queue, under People -- not "Teacher profiles",
 *  whose Arabic is Teacher files' own name. */
export const ADMIN_TEACHER_CREDENTIALS_LABEL: Bilingual = { en: 'Teacher credentials review', ar: 'مراجعة مؤهلات المعلمين' }

/** PD-35 B5: escalation cases, under People. */
export const ADMIN_CASES_LABEL: Bilingual = { en: 'Escalations', ar: 'التصعيدات' }

/** PD-21: account administration, beside the read-only Users section. */
export const ADMIN_ACCOUNTS_LABEL: Bilingual = { en: 'Accounts', ar: 'الحسابات' }

/**
 * The pages the super admin holds beyond the Admin Portal's own sections: each
 * is an operator area (same path, same page) offered in the portal's rail. One
 * table, in the order they appear, so the placement of a page is one line and
 * the navigation, the routes and the tests cannot disagree about it.
 *
 * `into`: the first heading of the destination (every page here joins it), or
 * the Chat page, which leads its destination (PD-8: reply first, inspect second).
 */
interface AdminAreaEntry {
  area: OperatorArea
  /** Where the page is offered; the placement is the only thing that differs from the operator's. */
  destination: DestinationKey
  /** The super admin's own wording, where it differs from the operator's. */
  label?: Bilingual
  lead?: boolean
}

const ADMIN_AREA_ENTRIES: readonly AdminAreaEntry[] = [
  // PD-8: the super admin replies in the Chat workspace.
  { area: 'chat', destination: 'conversations', label: ADMIN_CHAT_LABEL, lead: true },
  // PD-21: Accounts, the page every staff role shares; Users stays read-only.
  { area: 'accounts', destination: 'people', label: ADMIN_ACCOUNTS_LABEL },
  // PD-38: the academy's schedule.
  { area: 'schedule', destination: 'scheduling', label: ADMIN_SCHEDULE_LABEL },
  { area: 'teacher-schedules', destination: 'scheduling' },
  { area: 'student-schedules', destination: 'scheduling' },
  // PD-11 T4 / PD-16: trial lessons and new students: Sales' workspace.
  { area: 'trials', destination: 'sales', label: ADMIN_TRIALS_LABEL },
  { area: 'new-students', destination: 'sales' },
  // Teacher Profile V2: the credential review queue.
  { area: 'teacher-profiles', destination: 'people', label: ADMIN_TEACHER_CREDENTIALS_LABEL },
  // PD-29: the Materials library.
  { area: 'materials', destination: 'more', label: ADMIN_MATERIALS_LABEL },
  // PD-35 B5: escalation cases.
  { area: 'cases', destination: 'more', label: ADMIN_CASES_LABEL },
  // PD-41: the Certificates page and its types.
  { area: 'certificates', destination: 'more' },
  // PD-48: lesson voice-over review.
  { area: 'lesson-audio', destination: 'more' },
  // PD-57: the moderation queue.
  { area: 'moderation', destination: 'more' },
]

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
  for (const e of ADMIN_AREA_ENTRIES) {
    const entry: NavEntry = {
      key: e.area,
      path: AREA_PATH[e.area],
      icon: AREA_ICON[e.area],
      label: e.label ? { text: e.label } : { message: `nav.${e.area}` },
      inDevelopment: false,
    }
    // A destination with no registry section of its own (Sales, Scheduling) starts here.
    if (!out.has(e.destination)) out.set(e.destination, [{ key: e.destination, label: null, entries: [] }])
    const first = out.get(e.destination)![0]!
    if (e.lead) first.entries.unshift(entry)
    else first.entries.push(entry)
  }
  // PD-52: the two teacher-records pages (the super admin's own paths).
  for (const area of ['teacher-attendance', 'teacher-grants'] as const) {
    out.get('people')?.[0]?.entries.push({
      key: area,
      path: `/admin${AREA_PATH[area]}`,
      icon: AREA_ICON[area],
      label: { message: `nav.${area}` as const },
      inDevelopment: false,
    })
  }
  organizePeople(out)
  // One registry group inside a destination needs no heading.
  for (const groups of out.values()) {
    if (groups.length === 1) groups[0]!.label = null
  }
  return out
}

/**
 * People & Organization, grouped by what each page is about. The same four
 * headings for every role; a heading with no page the role may open is left
 * out, and a single remaining heading is dropped (the rail then shows the
 * pages alone).
 */
export const PEOPLE_GROUPS: readonly { key: string; label: Bilingual; members: readonly string[] }[] = [
  { key: 'accounts', label: { en: 'Staff & accounts', ar: 'الموظفون والحسابات' }, members: ['accounts', 'users'] },
  { key: 'teachers', label: { en: 'Teachers', ar: 'المعلمون' }, members: ['teachers', 'teacher-profiles', 'teacher-attendance', 'teacher-grants'] },
  { key: 'families', label: { en: 'Families', ar: 'العائلات' }, members: ['parents'] },
  { key: 'organization', label: { en: 'Organization', ar: 'الهيكل التنظيمي' }, members: ['teams', 'organization'] },
]

function organizePeople(out: Map<DestinationKey, NavEntryGroup[]>): void {
  const groups = out.get('people')
  if (!groups) return
  const entries = groups.flatMap((g) => g.entries)
  const bucketed: NavEntryGroup[] = PEOPLE_GROUPS.map((g) => ({ key: g.key, label: g.label, entries: [] }))
  for (const e of entries) {
    const i = PEOPLE_GROUPS.findIndex((g) => g.members.includes(e.key))
    // A page nobody placed lands in the last group rather than vanishing.
    bucketed[i === -1 ? bucketed.length - 1 : i]!.entries.push(e)
  }
  for (const [i, g] of bucketed.entries()) {
    const order = PEOPLE_GROUPS[i]!.members
    g.entries.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  }
  const kept = bucketed.filter((g) => g.entries.length > 0)
  if (kept.length === 1) kept[0]!.label = null
  out.set('people', kept)
}

function operatorDestinations(role: StaffRole, access: DepartmentAccess): Map<DestinationKey, NavEntryGroup[]> {
  const out = new Map<DestinationKey, NavEntryGroup[]>()
  // navAreas, not visibleAreas: some areas wait for the server to confirm them.
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
  organizePeople(out)
  return out
}

/**
 * The destinations this role sees, in rail order; empty ones are left out.
 * `opts` is the server's answers to GET /lessons/access (PD-11 T4/T5) and
 * GET /instalments/access (PD-12 S3).
 */
export function destinationsFor(role: StaffRole, opts: DepartmentAccess = {}): Destination[] {
  const byKey = isSuperAdmin(role) ? adminDestinations() : operatorDestinations(role, opts)
  const all = [...byKey.values()].flatMap((gs) => gs.flatMap((g) => g.entries))
  for (const e of all) if (all.some((o) => o.path.startsWith(`${e.path}/`))) e.exact = true
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
