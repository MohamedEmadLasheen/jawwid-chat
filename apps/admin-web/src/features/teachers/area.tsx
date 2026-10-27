import { NavLink } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useLessonAccess } from './hooks'
import type { Pair } from './copy'

/**
 * The Teachers area: one nav entry (`teachers`, "Teachers"), one gate
 * (GET /lessons/access -> lessonManager, see TEACHERS_DEPARTMENT_AREAS), and
 * its pages as tabs. Each page renders <TeachersAreaTabs /> at its top.
 *
 * ADDING A TAB is appending to TEACHERS_TABS and registering its route(s) in
 * AppRoutes under the same `teachers` area -- nothing else. `segment` is
 * relative to the area's base ('' is the base itself, matched exactly); a tab
 * whose pages have sub-routes (`files/:teacherId`) stays selected on them.
 *
 * Coordination (2026-10-19, owner-approved plan): Statistics is PD-11 T5;
 * Needs action, Schedules and Students are the supervisors' daily operations
 * (PD-11 T1-T3); Teacher files, Certificates and Leave requests arrive with
 * PD-12 S1 (#48), appended after them in that order.
 */
export interface TeachersTab {
  key: string
  /** Relative to the area base: '' (the base), 'files', 'certificates', ... */
  segment: string
  label: Pair
}

export const TEACHERS_AREA_BASE = '/teachers'

export const TEACHERS_TABS: TeachersTab[] = [
  { key: 'statistics', segment: '', label: { en: 'Statistics', ar: 'الإحصائيات' } },
  { key: 'needs-action', segment: 'needs-action', label: { en: 'Needs action', ar: 'بحاجة إلى إجراء' } },
  { key: 'schedules', segment: 'schedules', label: { en: 'Schedules', ar: 'الجداول' } },
  { key: 'students', segment: 'students', label: { en: 'Students', ar: 'الطلاب' } },
  // PD-10 Teacher File and PD-12 S1's queues.
  { key: 'files', segment: 'files', label: { en: 'Teacher files', ar: 'ملفات المعلمين' } },
  { key: 'certificates', segment: 'certificates', label: { en: 'Certificates', ar: 'الشهادات' } },
  // PD-26: leave, apologies and absences, lateness, rewards and complaints (was Leave requests + Discipline).
  { key: 'supervision', segment: 'supervision', label: { en: 'Supervision', ar: 'الإشراف' } },
  // PD-35 B5: escalation cases (the same page as /cases).
  { key: 'cases', segment: 'cases', label: { en: 'Escalations', ar: 'التصعيدات' } },
]

export function teachersTabPath(tab: TeachersTab, base: string = TEACHERS_AREA_BASE): string {
  return tab.segment ? `${base}/${tab.segment}` : base
}

/** The area's tab strip. Links, not buttons: every tab is a real URL. */
export function TeachersAreaTabs({ base = TEACHERS_AREA_BASE }: { base?: string }) {
  const { locale } = useI18n()
  const access = useLessonAccess()
  if (TEACHERS_TABS.length < 2) return null // one page needs no tabs
  // PD-26 amendment: Operations is offered the Supervision page and nothing else of the
  // Teachers area. Until the server answers, the tabs stay as they were.
  const pageOnly = access.data !== undefined && access.data.lessonManager !== true && access.data.supervisionPage === true
  const tabs = pageOnly ? TEACHERS_TABS.filter((t) => t.key === 'supervision') : TEACHERS_TABS
  return (
    <nav className="ts-tabs" aria-label={locale === 'ar' ? 'المعلمون' : 'Teachers'}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.key}
          to={teachersTabPath(tab, base)}
          end={tab.segment === ''}
          className={({ isActive }) => `ts-tab${isActive ? ' ts-tab--active' : ''}`}
        >
          {locale === 'ar' ? tab.label.ar : tab.label.en}
        </NavLink>
      ))}
    </nav>
  )
}
