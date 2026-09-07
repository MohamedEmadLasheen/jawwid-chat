import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from '@/core/auth/SessionProvider'
import { canOpenArea, isDepartment, type NavArea } from '@/core/permissions/capabilities'
import type { Staff } from '@/shared/types/domain'
import { LoadingState } from '@/shared/components/States'
import { AppShell } from './AppShell'
import { LoginPage } from '@/features/auth/LoginPage'
import { InboxPage } from '@/features/inbox/InboxPage'
import { FamiliesPage } from '@/features/family/FamiliesPage'
import { TasksPage } from '@/features/tasks/TasksPage'
import { CoveragePage } from '@/features/coverage/CoveragePage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
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
  // Departments have no inbox — they only ever see their own tasks. A
  // department is an attribute rather than a role since Phase 1, so it has to
  // be passed alongside: asking the role alone would send a finance admin to an
  // inbox they cannot open.
  return isDepartment(staff.role, staff.department) ? '/tasks' : '/inbox'
}

export function AppRoutes() {
  const { isLoading, isAuthenticated, staff } = useSession()

  if (isLoading) return <LoadingState />
  if (!isAuthenticated || !staff) return <LoginPage />

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to={homeFor(staff)} replace />} />
        <Route path="/inbox" element={<Area area="inbox"><InboxPage /></Area>} />
        <Route path="/inbox/:familyId" element={<Area area="inbox"><InboxPage /></Area>} />
        <Route path="/families" element={<Area area="families"><FamiliesPage /></Area>} />
        <Route path="/tasks" element={<Area area="tasks"><TasksPage /></Area>} />
        <Route path="/coverage" element={<Area area="coverage"><CoveragePage /></Area>} />
        <Route path="/dashboard" element={<Area area="dashboard"><DashboardPage /></Area>} />
        {/*
          Reserved seams (docs/admin/backend-contract-required.md §10):
          /approvals and /calls are intentionally unregistered. They exist in
          the AI #4 role assignment but in no part of the product brief, so
          they are not built. Adding one is a single Route here plus a nav
          registry entry — no refactor.
        */}
        <Route path="*" element={<Navigate to={homeFor(staff)} replace />} />
      </Routes>
    </AppShell>
  )
}
