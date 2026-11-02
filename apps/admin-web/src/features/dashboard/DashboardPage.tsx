import { Navigate } from 'react-router-dom'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { useI18n } from '@/core/i18n/I18nProvider'
import { RefreshAction } from '@/features/admin/common'
import { adminSectionPath } from '@/features/admin/sections'
import { useText } from '@/features/admin/copy'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState } from '@/shared/components/States'
import { D } from './copy'
import { DashboardSections, useDashboardSections } from './ManagerDashboard'

export { DASHBOARD_REFRESH_MS } from './ManagerDashboard'

/**
 * The manager Dashboard (PD-44): what is waiting, as counts, each a link to
 * the page where it is resolved. The super admin has one Dashboard, the
 * Admin Portal's, which shows these sections above its inventory (PR-8, Q7):
 * /dashboard takes them there.
 */
export function DashboardPage() {
  const { staff } = useSession()
  if (staff && isSuperAdmin(staff.role)) return <Navigate to={adminSectionPath('dashboard')} replace />
  return <ManagersDashboard />
}

function ManagersDashboard() {
  const tx = useText()
  const { t } = useI18n()
  const d = useDashboardSections()

  return (
    <div className="page dash">
      <div className="page__inner">
        <PageHeader
          title={t('nav.dashboard')}
          subtitle={tx(D.subtitle)}
          actions={d.asked > 0 && <RefreshAction updatedAt={d.updatedAt} fetching={d.fetching} onRefresh={d.refetch} />}
        />
        {d.asked === 0 || (d.settled && d.shown.length === 0) ? <EmptyState title={tx(D.noSections)} /> : <DashboardSections shown={d.shown} />}
      </div>
    </div>
  )
}
