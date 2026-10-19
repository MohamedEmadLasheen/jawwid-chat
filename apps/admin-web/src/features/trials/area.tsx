import { NavLink } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useLessonAccess } from '../teachers/hooks'
import type { Pair } from '../teachers/copy'

/**
 * The Trials area (PD-11 T4): Trial lessons for Sales and the Teachers
 * department, New students for Operations and Sales. One probe -- GET
 * /lessons/access -- decides which tabs a reader is offered; each page still
 * asks the server.
 */
export const TRIALS_AREA_BASE = '/trials'

interface TrialsTab {
  key: string
  path: string
  label: Pair
  offered: (a: { lessonManager: boolean; sales: boolean; operations: boolean }) => boolean
}

export const TRIALS_TABS: TrialsTab[] = [
  { key: 'trials', path: TRIALS_AREA_BASE, label: { en: 'Trial lessons', ar: 'الحصص التجريبية' }, offered: (a) => a.sales || a.lessonManager },
  { key: 'new-students', path: `${TRIALS_AREA_BASE}/new-students`, label: { en: 'New students', ar: 'الطلاب الجدد' }, offered: (a) => a.sales || a.operations },
]

export function useTrialsAccess() {
  const q = useLessonAccess()
  return {
    lessonManager: q.data?.lessonManager === true,
    sales: q.data?.sales === true,
    operations: q.data?.operations === true,
  }
}

export function TrialsAreaTabs() {
  const { locale } = useI18n()
  const access = useTrialsAccess()
  const tabs = TRIALS_TABS.filter((t) => t.offered(access))
  if (tabs.length < 2) return null
  return (
    <nav className="ts-tabs" aria-label={locale === 'ar' ? 'الحصص التجريبية' : 'Trials'}>
      {tabs.map((tab) => (
        <NavLink key={tab.key} to={tab.path} end className={({ isActive }) => `ts-tab${isActive ? ' ts-tab--active' : ''}`}>
          {locale === 'ar' ? tab.label.ar : tab.label.en}
        </NavLink>
      ))}
    </nav>
  )
}
