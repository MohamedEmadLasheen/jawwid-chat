import { useParams } from 'react-router-dom'
import { EmptyState } from '@/shared/components/States'
import { useDocumentTitle, useEyebrow } from './common'
import { TEXT, useText } from './copy'
import { adminSectionPath, findAdminSection } from './sections'
import { DashboardView } from './DashboardView'
import { ConversationsView } from './ConversationsView'
import { UsersView } from './UsersView'
import { StoriesStudio } from '@/features/stories/StoriesStudio'
import { DevelopmentPlaceholder } from './DevelopmentPlaceholder'
import { OrganizationPage } from '@/features/organization/OrganizationPage'
import { TeacherStatsPage } from '@/features/teachers/TeacherStatsPage'
import { TeacherFilesPage } from '@/features/teacher-files/TeacherFilesPage'
import { InstalmentsPage } from '@/features/instalments/InstalmentsPage'
import { ParentsPage } from '@/features/profiles/ParentsPage'
import { PaymentsPage } from '@/features/payments/PaymentsPage'
import { CallsPage } from '@/features/calls-page/CallsPage'
import { TasksPage } from '@/features/tasks/TasksPage'

/**
 * One route, `/admin/:section`, for every Admin Portal section. The four built
 * sections read their real `/admin/*` endpoint; every other one is an explicit
 * placeholder that requests nothing.
 */
export function AdminSectionPage() {
  const { section: key } = useParams<{ section: string }>()
  const tx = useText()
  const section = findAdminSection(key)
  useDocumentTitle(section ? tx(section.label) : null)

  if (!section) {
    return (
      <div className="page">
        <EmptyState icon="info" title={tx(TEXT.notFound)} />
      </div>
    )
  }

  switch (section.key) {
    case 'dashboard':
      return <DashboardView section={section} />
    case 'conversations':
      return <ConversationsView section={section} />
    case 'users':
      return <UsersView section={section} />
    case 'stories':
      return <AdminStories section={section} />
    case 'teams':
      return <OrganizationPage />
    case 'reports':
      return <TeacherStatsPage />
    case 'teachers':
      return <TeacherFilesPage basePath={adminSectionPath('teachers')} />
    case 'instalments':
      return <AdminInstalments section={section} />
    case 'parents':
      return <AdminParents section={section} />
    case 'payments':
      return <AdminPayments section={section} />
    case 'calls':
      return <CallsPage />
    case 'tasks':
      return <AdminTasks section={section} />
    default:
      return <DevelopmentPlaceholder section={section} />
  }
}

/** PD-17: the parents list; each opens at /parents/:id, the one URL a Parent Profile has. */
function AdminParents({ section }: { section: NonNullable<ReturnType<typeof findAdminSection>> }) {
  const eyebrow = useEyebrow(section)
  return <ParentsPage eyebrow={eyebrow} />
}

/** PD-27: receipts and settings; the same page operators open at /payments. */
function AdminPayments({ section }: { section: NonNullable<ReturnType<typeof findAdminSection>> }) {
  const eyebrow = useEyebrow(section)
  return <PaymentsPage eyebrow={eyebrow} />
}

/** PD-47: the Tasks page, with the super admin's All and Decisions tabs. */
function AdminTasks({ section }: { section: NonNullable<ReturnType<typeof findAdminSection>> }) {
  const eyebrow = useEyebrow(section)
  return <TasksPage eyebrow={eyebrow} />
}

function AdminInstalments({ section }: { section: NonNullable<ReturnType<typeof findAdminSection>> }) {
  const eyebrow = useEyebrow(section)
  return <InstalmentsPage eyebrow={eyebrow} />
}

/** The Admin Portal's home for the Stories studio (2026-10-17: the super admin publishes). */
function AdminStories({ section }: { section: NonNullable<ReturnType<typeof findAdminSection>> }) {
  const eyebrow = useEyebrow(section)
  return <StoriesStudio basePath={adminSectionPath('stories')} eyebrow={eyebrow} />
}
