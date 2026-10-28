import { NavLink } from 'react-router-dom'
import { TeachersAreaTabs } from '@/features/teachers/area'
import { S, useCopy } from './copy'
import './supervision.css'

/**
 * The tab strip for a page of the Teachers department's work.
 *
 * Operators are in the Teachers area (/teachers): its one tab registry
 * (features/teachers/area.tsx, PD-11 T5) carries Statistics, Teacher files
 * and Supervision; certificates have their own page since PD-41. The super admin reaches the same pages from
 * Admin > Teachers (/admin/teachers), where Statistics lives under Admin >
 * Reports instead -- so that home shows its own three tabs.
 */
export function TeachersTabs({ basePath }: { basePath: string }) {
  const tx = useCopy()
  if (!basePath.startsWith('/admin')) return <TeachersAreaTabs />
  const tabs = [
    { to: basePath, label: tx(S.tabTeachers), end: true },
    { to: `${basePath}/supervision`, label: tx(S.tabSupervision), end: false },
  ]
  return (
    <nav className="sv-tabs" aria-label={tx(S.sections)}>
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className="sv-tab">
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}

/** Where a teacher's file is, from a page in either home. */
export function teacherFilePath(basePath: string, teacherId: string): string {
  const id = encodeURIComponent(teacherId)
  return basePath.startsWith('/admin') ? `${basePath}/${id}` : `${basePath}/files/${id}`
}
