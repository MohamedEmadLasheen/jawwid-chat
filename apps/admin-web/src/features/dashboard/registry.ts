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
  // The Organization page's own key (its lists ask org.view; org.manage is only its writes').
  { key: 'structure', title: { en: 'Organization', ar: 'الهيكل التنظيمي' }, requires: ['org.view'] },
  // PD-47 PR-4: everyone's own tasks are self-service, so no key is needed;
  // the team, decision and super-admin tiles come only to whom they apply.
  { key: 'tasks', title: { en: 'Tasks', ar: 'المهام' }, requires: [] },
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
  // PD-44 PR-7: the Organization page's Children and Teachers tabs, and the Structure tab's covers.
  'learners.unsupervised': {
    label: { en: 'Children without a supervisor', ar: 'أطفال بلا مشرف' },
    icon: 'users',
    backlog: true,
    href: () => '/organization?tab=children&filter=unassigned',
  },
  'teachers.unsupervised': {
    label: { en: 'Teachers without a supervisor', ar: 'معلمون بلا مشرف' },
    icon: 'academy',
    backlog: true,
    href: () => '/organization?tab=teachers',
  },
  'covers.active': {
    label: { en: 'Supervisors away, covered by a backup', ar: 'مشرفون في إجازة يغطيهم البديل' },
    icon: 'users',
    backlog: false,
    href: () => '/organization?tab=structure',
  },
}

/** Without /me's keys (an API before PD-40) every section is asked for, and the server decides. */
export function sectionAllowed(spec: SectionSpec, permissions: readonly string[] | undefined): boolean {
  return !permissions || spec.requires.length === 0 || spec.requires.some((key) => permissions.includes(key))
}
