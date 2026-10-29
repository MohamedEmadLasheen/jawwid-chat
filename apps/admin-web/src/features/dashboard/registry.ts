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
  { key: 'enrolment', title: { en: 'Trials and new students', ar: 'الحصص التجريبية والطلاب الجدد' }, requires: ['trials.view', 'new_students.view'] },
  {
    key: 'teachers',
    title: { en: 'Teachers', ar: 'المعلمون' },
    // Not certificates.view alone: the route does not open on it (PD-41's Designer reaches only certificates).
    requires: ['teacher_supervision.view', 'teacher_profiles.review'],
  },
  // PD-47 PR-4: everyone's own tasks are self-service, so no key is needed;
  // the team, decision and super-admin tiles come only to whom they apply.
  { key: 'tasks', title: { en: 'Tasks', ar: 'المهام' }, requires: [] },
]

/** Today on the Schedule (its day view opens on today); the Teachers department's queue. */
const TODAY = () => '/schedule?view=day'
const NEEDS_ACTION = () => '/teachers/needs-action'
/** A section of the Teacher Supervision page, which keeps its section (and filters) in the URL. */
const SUPERVISION = (query: string) => () => `/teachers/supervision?${query}`

export interface TileSpec {
  label: Bilingual
  icon: IconName
  /** A backlog: above zero it wants doing, so it is marked. Informational counts never are. */
  backlog: boolean
  /** The page that resolves it, given the tile keys the section returned. */
  href: (present: ReadonlySet<string>) => string
}

/** PD-47: each task tile opens the Tasks view it counts (the same list, the same filter). */
const tasksView = (tab: 'mine' | 'team' | 'all', filter = '') => () => `/tasks${tab === 'mine' ? (filter ? `?${filter}` : '') : `?tab=${tab}${filter ? `&${filter}` : ''}`}`
const taskTiles = (tab: 'mine' | 'team' | 'all', whose: { en: string; ar: string }): Record<string, TileSpec> => ({
  [`tasks.${tab}_open`]: {
    label: { en: `Open tasks (${whose.en})`, ar: `مهام مفتوحة (${whose.ar})` },
    icon: 'tasks',
    backlog: false,
    href: tasksView(tab),
  },
  [`tasks.${tab}_overdue`]: {
    label: { en: `Overdue tasks (${whose.en})`, ar: `مهام متأخرة (${whose.ar})` },
    icon: 'clock',
    backlog: true,
    href: tasksView(tab, 'overdue=true'),
  },
  [`tasks.${tab}_urgent`]: {
    label: { en: `High-level tasks (${whose.en})`, ar: `مهام عالية المستوى (${whose.ar})` },
    icon: 'alert',
    backlog: true,
    href: tasksView(tab, 'level=high'),
  },
  [`tasks.${tab}_financial`]: {
    label: { en: `Financial tasks (${whose.en})`, ar: `مهام مالية (${whose.ar})` },
    icon: 'banknote',
    backlog: false,
    href: tasksView(tab, 'category=financial'),
  },
})

export const TILES: Readonly<Record<string, TileSpec>> = {
  ...taskTiles('mine', { en: 'mine', ar: 'لي' }),
  ...taskTiles('team', { en: 'my team', ar: 'فريقي' }),
  ...taskTiles('all', { en: 'everyone', ar: 'الجميع' }),
  'tasks.awaiting_decision': {
    label: { en: 'Tasks waiting for my decision', ar: 'مهام تنتظر قراري' },
    icon: 'approvals',
    backlog: true,
    href: () => '/tasks?tab=decisions',
  },
  'tasks.needs_reassignment': {
    label: { en: 'Tasks whose assignee left', ar: 'مهام غادر المسند إليه' },
    icon: 'users',
    backlog: true,
    // The same list, filtered to an assignee who left (tile == list).
    href: (present) => (present.has('tasks.all_open') ? '/tasks?tab=all&gone=true' : '/tasks?tab=team&gone=true'),
  },
  'tasks.unmanaged': {
    label: { en: 'Tasks no manager can move', ar: 'مهام لا يستطيع أي مدير نقلها' },
    icon: 'alert',
    backlog: true,
    // Every task no live manager stands to (tile == list).
    href: () => '/tasks?tab=all&unmanaged=true',
  },
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
  // PD-44 PR-4: the Trials page's tabs and the New Students page's filters.
  'trials.awaiting': {
    label: { en: 'Trial lessons awaiting a decision', ar: 'حصص تجريبية تنتظر القرار' },
    icon: 'clock',
    backlog: true,
    href: () => '/trials?filter=decision',
  },
  'trials.upcoming': {
    label: { en: 'Trial lessons to come', ar: 'حصص تجريبية قادمة' },
    icon: 'calendar',
    backlog: false,
    href: () => '/trials?filter=upcoming',
  },
  'new_students.unassigned': {
    label: { en: 'New students not yet assigned', ar: 'طلاب جدد لم يُعيَّنوا بعد' },
    icon: 'users',
    backlog: true,
    href: () => '/trials/new-students?filter=unassigned',
  },
  'new_students.waiting': {
    label: { en: 'New students waiting for the parent', ar: 'طلاب جدد بانتظار ولي الأمر' },
    icon: 'clock',
    backlog: false,
    href: () => '/trials/new-students?filter=waiting',
  },
  // PD-44 PR-6: the Teacher Supervision page's queues, the Certificates page's Pending tab, the credentials queue.
  'leave.pending': {
    label: { en: 'Leave requests waiting for a decision', ar: 'طلبات إجازة تنتظر القرار' },
    icon: 'calendar',
    backlog: true,
    href: SUPERVISION('section=leave'),
  },
  'absences.open': {
    label: { en: 'Absences waiting for a decision', ar: 'غيابات تنتظر القرار' },
    icon: 'users',
    backlog: true,
    href: SUPERVISION('section=absences'),
  },
  'lateness.open': {
    label: { en: 'Lateness waiting for a decision', ar: 'تأخيرات تنتظر القرار' },
    icon: 'clock',
    backlog: true,
    href: SUPERVISION('section=lateness'),
  },
  'feedback.received': {
    label: { en: 'New parent feedback', ar: 'آراء جديدة من أولياء الأمور' },
    icon: 'conversations',
    backlog: true,
    href: SUPERVISION('section=feedback&status=received'),
  },
  'feedback.in_review': {
    label: { en: 'Parent feedback in review', ar: 'آراء أولياء الأمور قيد المراجعة' },
    icon: 'conversations',
    backlog: false,
    href: SUPERVISION('section=feedback&status=in_review'),
  },
  'certificates.student_requested': {
    label: { en: 'Student certificates requested', ar: 'شهادات طلاب مطلوبة' },
    icon: 'academy',
    backlog: false,
    href: () => '/certificates?category=student',
  },
  'certificates.teacher_requested': {
    label: { en: 'Teacher certificates requested', ar: 'شهادات معلمين مطلوبة' },
    icon: 'academy',
    backlog: false,
    href: () => '/certificates?category=teacher',
  },
  'teacher_profiles.pending': {
    label: { en: 'Teacher credentials to review', ar: 'مؤهلات معلمين تنتظر المراجعة' },
    icon: 'approvals',
    backlog: true,
    href: () => '/teacher-profiles',
  },
}

/** Without /me's keys (an API before PD-40) every section is asked for, and the server decides. */
export function sectionAllowed(spec: SectionSpec, permissions: readonly string[] | undefined): boolean {
  return !permissions || spec.requires.length === 0 || spec.requires.some((key) => permissions.includes(key))
}
