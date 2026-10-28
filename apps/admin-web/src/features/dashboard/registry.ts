import type { Bilingual } from '@/features/admin/copy'
import type { IconName } from '@/shared/components/Icon'
import type { DashboardSectionKey } from './api'

/**
 * PD-44: what the Dashboard knows about each section and tile. The server
 * decides which tiles a person gets and what they count; this says only how
 * each is named and which page resolves it (plan §3, §4.4).
 *
 * A section is asked for only with the PD-40 key of the page its tiles link
 * to (the same key its route requires), so nobody is shown a section their
 * own account would be refused.
 */
export interface SectionSpec {
  key: DashboardSectionKey
  title: Bilingual
  requires: readonly string[]
}

export const SECTIONS: readonly SectionSpec[] = [
  { key: 'chats', title: { en: 'Chats', ar: 'المحادثات' }, requires: ['chat.use'] },
  { key: 'cases', title: { en: 'Escalation cases', ar: 'حالات التصعيد' }, requires: ['cases.view'] },
  { key: 'lessons', title: { en: 'Lessons', ar: 'الحصص' }, requires: ['lessons.view', 'schedule.view'] },
]

/** Today on the Schedule (its day view opens on today); the Teachers department's queue. */
const TODAY = () => '/schedule?view=day'
const NEEDS_ACTION = () => '/teachers/needs-action'

export interface TileSpec {
  label: Bilingual
  icon: IconName
  /** A backlog: above zero it wants doing, so it is marked. Informational counts never are. */
  backlog: boolean
  /** The page that resolves it, given the tile keys the section returned. */
  href: (present: ReadonlySet<string>) => string
}

export const TILES: Readonly<Record<string, TileSpec>> = {
  'chats.waiting': {
    label: { en: 'Chats waiting for our reply', ar: 'محادثات تنتظر ردّنا' },
    icon: 'conversations',
    backlog: true,
    href: () => '/chat?view=waiting',
  },
  'cases.mine_open': {
    label: { en: 'Cases assigned to me', ar: 'حالات مسندة إليّ' },
    icon: 'tasks',
    backlog: false,
    href: () => '/cases?tab=mine',
  },
  'cases.department_open': {
    label: { en: 'Open cases in the department', ar: 'حالات مفتوحة في القسم' },
    icon: 'tasks',
    backlog: false,
    href: () => '/cases?tab=department',
  },
  'cases.overdue': {
    label: { en: 'Cases past their due date', ar: 'حالات تجاوزت موعدها' },
    icon: 'clock',
    backlog: true,
    // Overdue counts the caller's own cases and their department's together:
    // the department list holds both for a manager, Mine for anyone else.
    href: (present) => (present.has('cases.department_open') ? '/cases?tab=department' : '/cases?tab=mine'),
  },
  'lessons.today_upcoming': {
    label: { en: 'Lessons still to come today', ar: 'حصص قادمة اليوم' },
    icon: 'calendar',
    backlog: false,
    href: TODAY,
  },
  'lessons.today_unreported': {
    label: { en: "Today's lessons with no outcome yet", ar: 'حصص اليوم بلا نتيجة' },
    icon: 'clock',
    backlog: true,
    href: TODAY,
  },
  'lessons.today_held': {
    label: { en: 'Held today', ar: 'حصص تمّت اليوم' },
    icon: 'check',
    backlog: false,
    href: TODAY,
  },
  'lessons.today_student_absent': {
    label: { en: 'Student absent today', ar: 'غياب الطالب اليوم' },
    icon: 'users',
    backlog: false,
    href: TODAY,
  },
  'lessons.today_teacher_absent': {
    label: { en: 'Teacher absent today', ar: 'غياب المعلّم اليوم' },
    icon: 'academy',
    backlog: false,
    href: TODAY,
  },
  'lessons.today_cancelled': {
    label: { en: 'Cancelled today', ar: 'حصص أُلغيت اليوم' },
    icon: 'calendar',
    backlog: false,
    href: TODAY,
  },
  'lessons.needs_outcome': {
    label: { en: 'Lessons waiting for an outcome', ar: 'حصص تنتظر تسجيل النتيجة' },
    icon: 'tasks',
    backlog: true,
    href: NEEDS_ACTION,
  },
  'lessons.rulings_open': {
    label: { en: 'Late apologies to rule on', ar: 'اعتذارات متأخرة تنتظر قرارًا' },
    icon: 'approvals',
    backlog: true,
    href: NEEDS_ACTION,
  },
}

/** Without /me's keys (an API before PD-40) every section is asked for, and the server decides. */
export function sectionAllowed(spec: SectionSpec, permissions: readonly string[] | undefined): boolean {
  return !permissions || spec.requires.some((key) => permissions.includes(key))
}
