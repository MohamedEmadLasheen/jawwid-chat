import { NavLink } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
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
  { key: 'leave', segment: 'leave', label: { en: 'Leave requests', ar: 'طلبات الإجازة' } },
  // PD-12 S2.
  { key: 'discipline', segment: 'discipline', label: { en: 'Discipline', ar: 'الانضباط' } },
]

export function teachersTabPath(tab: TeachersTab, base: string = TEACHERS_AREA_BASE): string {
  return tab.segment ? `${base}/${tab.segment}` : base
}

/** The area's tab strip. Links, not buttons: every tab is a real URL. */
export function TeachersAreaTabs({ base = TEACHERS_AREA_BASE }: { base?: string }) {
  const { locale } = useI18n()
  if (TEACHERS_TABS.length < 2) return null // one page needs no tabs
  return (
    <nav className="ts-tabs" aria-label={locale === 'ar' ? 'المعلمون' : 'Teachers'}>
      {TEACHERS_TABS.map((tab) => (
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
