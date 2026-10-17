import { useParams } from 'react-router-dom'
import { EmptyState } from '@/shared/components/States'
import { useDocumentTitle } from './common'
import { TEXT, useText } from './copy'
import { findAdminSection } from './sections'
import { DashboardView } from './DashboardView'
import { ConversationsView } from './ConversationsView'
import { UsersView } from './UsersView'
import { StoriesView } from './StoriesView'
import { DevelopmentPlaceholder } from './DevelopmentPlaceholder'
import { OrganizationPage } from '@/features/organization/OrganizationPage'

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
      return <StoriesView section={section} />
    case 'teams':
      return <OrganizationPage />
    default:
      return <DevelopmentPlaceholder section={section} />
  }
}
