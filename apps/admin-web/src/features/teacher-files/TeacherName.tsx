import { Link } from 'react-router-dom'
import { teacherFilePath } from '@/features/supervision/TeachersTabs'
import { useOpensTeacherFiles } from './hooks'

/**
 * A teacher's name on the Teacher Supervision page: a link to their Teacher File
 * for whoever may open it (the Teachers department, the super admin), the name
 * alone for an Operations supervisor (PD-26 amendment).
 */
export function TeacherName({ basePath, teacher }: { basePath: string; teacher: { id: string; name: string | null } }) {
  const opens = useOpensTeacherFiles()
  return opens ? <Link to={teacherFilePath(basePath, teacher.id)}>{teacher.name}</Link> : <span dir="auto">{teacher.name}</span>
}
