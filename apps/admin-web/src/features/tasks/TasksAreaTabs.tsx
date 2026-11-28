import { NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny } from '@/core/permissions/capabilities'
import { casesApi } from '@/features/cases/api'
import '../teachers/teachers.css'
import './tasks.css'

/** The cases an account works on: the ones it owns and, for a department's manager, the department's open ones. */
export const CASES_ACCESS_KEYS = ['cases.manage'] as const

/**
 * The open escalations that are this account's work: the cases it owns plus, for a department's manager,
 * the department's. The server decides what each list holds; a list it refuses counts as none.
 */
export function useOpenCaseCount(enabled: boolean): number | null {
  const q = useQuery({
    queryKey: ['cases', 'open-count'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const [mine, department] = await Promise.all([
        casesApi.list('mine', 'open').catch(() => ({ cases: [] })),
        casesApi.list('department', 'open').catch(() => ({ cases: [] })),
      ])
      return new Set([...mine.cases, ...department.cases].map((c) => c.id)).size
    },
  })
  return q.data ?? null
}

/**
 * Tasks and Escalations are two pages of one place: the work that is waiting for this person. An escalation
 * keeps its own page, lifecycle and audit trail (it is a case, never a task); this strip is only how the two
 * are reached. Shown to whoever works cases; everyone else sees Tasks alone, as before.
 */
export function TasksAreaTabs() {
  const { locale } = useI18n()
  const { staff } = useSession()
  const hasCases = holdsAny(staff, CASES_ACCESS_KEYS)
  const count = useOpenCaseCount(hasCases)
  const here = useLocation().pathname
  if (!hasCases) return null
  const ar = locale === 'ar'
  // The Admin Portal hosts the same page at /admin/tasks: the strip marks it there too, and stays there.
  const tasksPath = here !== '/tasks' && /\/tasks$/.test(here) ? here : '/tasks'
  return (
    <nav className="ts-tabs" aria-label={ar ? 'المهام والتصعيدات' : 'Tasks and escalations'}>
      <NavLink to={tasksPath} end className={({ isActive }) => `ts-tab${isActive ? ' ts-tab--active' : ''}`}>
        {ar ? 'المهام' : 'Tasks'}
      </NavLink>
      <NavLink to="/cases" className={({ isActive }) => `ts-tab${isActive ? ' ts-tab--active' : ''}`}>
        {ar ? 'التصعيدات' : 'Escalations'}
        {count !== null && count > 0 && (
          <span className="ts-tab__count" aria-label={ar ? `${count} مفتوحة` : `${count} open`}>
            {/* Drawn as a bare numeral, like every other tab count; the brackets are for a reader of the text alone. */}
            <span className="sr-only"> (</span>
            {count}
            <span className="sr-only">)</span>
          </span>
        )}
      </NavLink>
    </nav>
  )
}
