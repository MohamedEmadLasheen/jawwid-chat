import { ATTENDANCE_PATH, GRANTS_PATH } from '@/features/teacher-records/paths'
import { SALES_PIPELINE_PATH } from '@/features/sales-pipeline/paths'
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

export type DestinationKey =
  | 'conversations'
  | 'dashboard'
  | 'people'
  | 'sales'
  | 'scheduling'
  | 'operations'
  | 'certificates'
  | 'materials'
  | 'finance'
  | 'communication'
  | 'admin'

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

/**
 * The nine sections of the Admin Portal, in rail order (owner-approved
 * architecture). Each page has exactly one home; a destination with no page a
 * role may open is left out of that role's rail.
 */
export const DESTINATIONS: readonly { key: DestinationKey; icon: IconName; label: Bilingual }[] = [
  { key: 'conversations', icon: 'conversations', label: { en: 'Conversations', ar: 'المحادثات' } },
  // PD-44: a manager's Dashboard is one click from anywhere, beside the chats it counts.
  { key: 'dashboard', icon: 'dashboard', label: { en: 'Dashboard', ar: 'لوحة المتابعة' } },
  { key: 'people', icon: 'users', label: { en: 'People & Organization', ar: 'الأشخاص والهيكل التنظيمي' } },
  { key: 'sales', icon: 'chart', label: { en: 'Sales', ar: 'المبيعات' } },
  { key: 'scheduling', icon: 'calendar', label: { en: 'Scheduling', ar: 'الجدولة' } },
  { key: 'operations', icon: 'academy', label: { en: 'Operations', ar: 'التشغيل' } },
  // Their own icons: the Marketing designer's whole workspace is Certificates, and the
  // educational materials are used by Teachers and Operations alike, so neither sits inside one department's menu.
  { key: 'certificates', icon: 'star', label: { en: 'Certificates', ar: 'الشهادات' } },
  { key: 'materials', icon: 'book', label: { en: 'Educational materials', ar: 'المواد التعليمية' } },
  { key: 'finance', icon: 'banknote', label: { en: 'Finance', ar: 'المالية' } },
  { key: 'communication', icon: 'notifications', label: { en: 'Communication', ar: 'التواصل' } },
  // Last, at the foot of the rail, apart from the everyday destinations.
  { key: 'admin', icon: 'settings', label: { en: 'Admin & Settings', ar: 'الإدارة والإعدادات' } },
]

/**
 * Where each Admin Portal section lives. A Record, so a section added to the
 * registry does not compile until it has been given a place.
 *
 * The nine sections that have no backend yet (Quality, Academy operations,
 * Forms, Notifications, WhatsApp, Approvals, Integrations, Audit, Settings) are
 * marked "in development" wherever they sit, and the ones that are not
 * communication live under Admin & Settings, off the everyday rail.
 */
export const SECTION_DESTINATION: Record<AdminSectionKey, DestinationKey> = {
  conversations: 'conversations',
  dashboard: 'dashboard',
  tasks: 'dashboard',
  users: 'people',
  teams: 'people',
  teachers: 'people',
  parents: 'people',
  instalments: 'finance',
  payments: 'finance',
  stories: 'communication',
  calls: 'communication',
  notifications: 'communication',
  whatsapp: 'communication',
  reports: 'admin',
  quality: 'admin',
  academy: 'admin',
  forms: 'admin',
  approvals: 'admin',
  integrations: 'admin',
  audit: 'admin',
  settings: 'admin',
}

/** Operator areas. `settings` has no page, so it has no place (as before). */
export const AREA_DESTINATION: Record<NavArea, DestinationKey | null> = {
  chat: 'conversations',
  moderation: 'conversations',
  dashboard: 'dashboard',
  tasks: 'dashboard',
  organization: 'people',
  teachers: 'people',
  parents: 'people',
  students: 'people',
  'teacher-profiles': 'people',
  accounts: 'people',
  'teacher-attendance': 'people',
  'teacher-grants': 'people',
  'sales-pipeline': 'sales',
  trials: 'sales',
  'new-students': 'sales',
  schedule: 'scheduling',
  'teacher-schedules': 'scheduling',
  'student-schedules': 'scheduling',
  'needs-action': 'operations',
  cases: 'operations',
  certificates: 'certificates',
  'lesson-audio': 'operations',
  materials: 'materials',
  instalments: 'finance',
  payments: 'finance',
  calls: 'communication',
  stories: 'communication',
  settings: null,
}

export const AREA_PATH: Record<OperatorArea, string> = {
  chat: '/chat',
  calls: '/calls',
  organization: '/organization',
  teachers: '/teachers',
  instalments: '/instalments',
  parents: '/parents',
  students: '/students',
  payments: '/payments',
  'sales-pipeline': SALES_PIPELINE_PATH,
  trials: '/trials',
  'new-students': '/trials/new-students',
  'needs-action': '/teachers/needs-action',
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
  students: 'users',
  payments: 'tag',
  'sales-pipeline': 'chart',
  trials: 'calendar',
  'new-students': 'users',
  'needs-action': 'alert',
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

/** PD-29: the educational materials library, a destination of its own. */
export const ADMIN_MATERIALS_LABEL: Bilingual = { en: 'Educational materials', ar: 'المواد التعليمية' }

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
  // PD-60: the student directory, beside Parents.
  { area: 'students', destination: 'people' },
  // PD-38: the academy's schedule.
  { area: 'schedule', destination: 'scheduling', label: ADMIN_SCHEDULE_LABEL },
  { area: 'teacher-schedules', destination: 'scheduling' },
  { area: 'student-schedules', destination: 'scheduling' },
  // PD-11 T4 / PD-16: trial lessons and new students: Sales' workspace.
  // PD-59: the Sales pipeline leads Sales' workspace: a lead comes before its trial.
  { area: 'sales-pipeline', destination: 'sales' },
  { area: 'trials', destination: 'sales', label: ADMIN_TRIALS_LABEL },
  { area: 'new-students', destination: 'sales' },
  // Teacher Profile V2: the credential review queue.
  { area: 'teacher-profiles', destination: 'people', label: ADMIN_TEACHER_CREDENTIALS_LABEL },
  // The supervisors' daily queue.
  { area: 'needs-action', destination: 'operations' },
  // PD-29: the Materials library.
  { area: 'materials', destination: 'materials', label: ADMIN_MATERIALS_LABEL },
  // PD-35 B5: escalation cases.
  { area: 'cases', destination: 'operations', label: ADMIN_CASES_LABEL },
  // PD-41: the Certificates page and its types.
  { area: 'certificates', destination: 'certificates' },
  // PD-48: lesson voice-over review.
  { area: 'lesson-audio', destination: 'operations' },
  // PD-57: the moderation queue.
  { area: 'moderation', destination: 'conversations' },
]

const ADMIN_SUBGROUPS = {
  insight: { key: 'insight', label: { en: 'Reports & quality', ar: 'التقارير والجودة' } },
  system: { key: 'system', label: { en: 'System', ar: 'النظام' } },
} as const

function adminDestinations(): Map<DestinationKey, NavEntryGroup[]> {
  const out = new Map<DestinationKey, NavEntryGroup[]>()
  // Sections keep their registry order; inside a destination that spans more
  // than one registry group (More), each group becomes a heading.
  for (const group of ADMIN_GROUPS) {
    for (const section of ADMIN_SECTIONS.filter((s) => s.group === group.key)) {
      const dest = SECTION_DESTINATION[section.key]
      const groups = out.get(dest) ?? []
      // One heading-less group per destination, except Admin & Settings, whose
      // reports and quality pages are kept apart from the system's own.
      const split = dest === 'admin' ? ADMIN_SUBGROUPS[group.key === 'administration' ? 'system' : 'insight'] : null
      const bucketKey = split?.key ?? dest
      let bucket = groups.find((g) => g.key === bucketKey)
      if (!bucket) {
        bucket = { key: bucketKey, label: split?.label ?? null, entries: [] }
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
  // A destination with one group needs no heading.
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
  { key: 'families', label: { en: 'Families', ar: 'العائلات' }, members: ['parents', 'students'] },
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
    // A Teachers-department account (the server confirms `lessonManager` only: neither `sales` nor
    // `operations`) keeps its Trial lessons page, but it is listed under Operations: the Sales icon is
    // for Sales, Operations and the super admin.
    const dest = area === 'trials' && access.sales !== true && access.operations !== true ? 'operations' : AREA_DESTINATION[area]
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
