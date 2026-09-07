import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from '@/core/auth/SessionProvider'
import { canOpenArea, isDepartment, type NavArea } from '@/core/permissions/capabilities'
import type { Staff } from '@/shared/types/domain'
import { LoadingState } from '@/shared/components/States'
import { AppShell } from './AppShell'
import { LoginPage } from '@/features/auth/LoginPage'
import { ConsolePage } from '@/features/conversations/ConsolePage'
import { DirectoryPage } from '@/features/directory/DirectoryPage'
import { FamilyDetailPage } from '@/features/directory/FamilyDetailPage'
import { GroupsPage } from '@/features/groups/GroupsPage'
import { GroupDetailPage } from '@/features/groups/GroupDetailPage'
import { LabelsPage } from '@/features/labels/LabelsPage'
import { ForbiddenPage } from './ForbiddenPage'
import type { ReactElement } from 'react'

/**
 * Route gating is navigation UX, not security. A role that reaches a page it
 * should not see still gets nothing, because every query behind the page is
 * authorised server-side.
 */
function Area({ area, children }: { area: NavArea; children: ReactElement }) {
  const { staff } = useSession()
  if (!staff) return null
  return canOpenArea(staff.role, area, staff.department) ? children : <ForbiddenPage />
}

function homeFor(staff: Pick<Staff, 'role' | 'department'>): string {
  // A departmental staff member has no communication surface at all: they
  // complete task work and take no part in family communication (PD-5), and
  // the task console is frozen. They land on the forbidden page rather than on
  // a console they may not operate.
  return isDepartment(staff.role, staff.department) ? '/forbidden' : '/console'
}

export function AppRoutes() {
  const { isLoading, isAuthenticated, staff } = useSession()

  if (isLoading) return <LoadingState />
  if (!isAuthenticated || !staff) return <LoginPage />

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to={homeFor(staff)} replace />} />
        <Route path="/console" element={<Area area="console"><ConsolePage /></Area>} />
        <Route
          path="/console/:conversationId"
          element={<Area area="console"><ConsolePage /></Area>}
        />
        {/*
          Phase 3 — the business model. New routes alongside the console; the
          frozen brief-era `/families` route is NOT revived, and nothing here
          touches the console's own paths.
        */}
        <Route path="/directory" element={<Area area="directory"><DirectoryPage /></Area>} />
        <Route
          path="/directory/:familyId"
          element={<Area area="directory"><FamilyDetailPage /></Area>}
        />
        <Route path="/groups" element={<Area area="groups"><GroupsPage /></Area>} />
        <Route path="/groups/:groupId" element={<Area area="groups"><GroupDetailPage /></Area>} />
        <Route path="/labels" element={<Area area="labels"><LabelsPage /></Area>} />

        <Route path="/forbidden" element={<ForbiddenPage />} />
        {/*
          The brief-era routes (/inbox, /families, /tasks, /coverage,
          /dashboard) are GONE from the table. Their pages are frozen on disk
          per PHASE-0-ADMIN-WEB-RECONCILIATION §2.7 and are deleted with a
          later phase — but every query behind them calls an endpoint the API
          does not serve, so routing to one would render a page of errors.

          /approvals and /calls remain reserved seams: the API serves them,
          the console does not surface them yet, and adding one is a Route here
          plus a nav entry — no refactor.
        */}
        <Route path="*" element={<Navigate to={homeFor(staff)} replace />} />
      </Routes>
    </AppShell>
  )
}
