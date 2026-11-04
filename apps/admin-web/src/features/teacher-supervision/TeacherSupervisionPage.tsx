import { Navigate, useSearchParams } from 'react-router-dom'
import { attendancePath, grantsPath } from '@/features/teacher-records/paths'

export type HubSection = 'leave' | 'absences' | 'lateness' | 'rewards' | 'complaints' | 'feedback'

/**
 * Where an old Teacher Supervision link (PD-26) lands now that PD-52 split the
 * page in two (plan §5.1): leave, absences, lateness and complaints on
 * Attendance & Complaints; rewards on Grants & Testimonials. Parent feedback
 * goes by its category -- praise to Testimonials, a suggestion to the
 * Suggestions view, anything else (a complaint, or no category) to
 * Complaints. The rest of the query is kept.
 */
export function supervisionRedirect(basePath: string, params: URLSearchParams): string {
  const next = new URLSearchParams(params)
  const section = (params.get('section') ?? 'leave') as HubSection
  const category = params.get('category')
  next.delete('category')
  const go = (path: string, s: string, extra: Record<string, string> = {}) => {
    next.set('section', s)
    for (const [k, v] of Object.entries(extra)) next.set(k, v)
    return `${path}?${next.toString()}`
  }
  switch (section) {
    case 'rewards':
      return go(grantsPath(basePath), 'grants')
    case 'feedback':
      if (category === 'praise') return go(grantsPath(basePath), 'testimonials')
      if (category === 'suggestion') return go(attendancePath(basePath), 'complaints', { view: 'suggestions' })
      return go(attendancePath(basePath), 'complaints')
    case 'absences':
      return go(attendancePath(basePath), 'excuses')
    case 'lateness':
    case 'complaints':
      return go(attendancePath(basePath), section)
    default:
      return go(attendancePath(basePath), 'leave')
  }
}

/** PD-26's page is now only where its old links land (PD-52). */
export function TeacherSupervisionPage({ basePath }: { basePath: string; eyebrow?: string }) {
  const [params] = useSearchParams()
  return <Navigate to={supervisionRedirect(basePath, params)} replace />
}
