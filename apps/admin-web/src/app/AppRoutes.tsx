import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from '@/core/auth/SessionProvider'
import { canOpenArea, isDepartment, isSuperAdmin, type NavArea } from '@/core/permissions/capabilities'
import { LoadingState } from '@/shared/components/States'
import { AppShell } from './AppShell'
import { LoginPage } from '@/features/auth/LoginPage'
import { InboxPage } from '@/features/inbox/InboxPage'
import { ChatPage } from '@/features/chat/ChatPage'
import { FamiliesPage } from '@/features/family/FamiliesPage'
import { TasksPage } from '@/features/tasks/TasksPage'
import { CoveragePage } from '@/features/coverage/CoveragePage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { StoriesPage } from '@/features/stories/StoriesPage'
import { AdminSectionPage } from '@/features/admin/AdminSectionPage'
import { adminSectionPath } from '@/features/admin/sections'
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
  return canOpenArea(staff.role, area) ? children : <ForbiddenPage />
}

/** The Admin Portal sections. Same rule as Area: UX, not security -- every
 *  `/admin/*` request is refused server-side for anyone but super_admin. */
function SuperAdminOnly({ children }: { children: ReactElement }) {
  const { staff } = useSession()
  if (!staff) return null
  return isSuperAdmin(staff.role) ? children : <ForbiddenPage />
}

function homeFor(role: Parameters<typeof isDepartment>[0]): string {
  if (isSuperAdmin(role)) return adminSectionPath('dashboard')
  // Departments have no inbox — they only ever see their own tasks. Operators
  // land in their conversations: the chat workspace on the real API.
  return isDepartment(role) ? '/tasks' : '/chat'
}

export function AppRoutes() {
  const { isLoading, isAuthenticated, staff } = useSession()

  if (isLoading) return <LoadingState />
  if (!isAuthenticated || !staff) return <LoginPage />

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to={homeFor(staff.role)} replace />} />
        <Route path="/chat" element={<Area area="chat"><ChatPage /></Area>} />
        <Route path="/chat/:conversationId" element={<Area area="chat"><ChatPage /></Area>} />
        <Route path="/inbox" element={<Area area="inbox"><InboxPage /></Area>} />
        <Route path="/inbox/:familyId" element={<Area area="inbox"><InboxPage /></Area>} />
        <Route path="/families" element={<Area area="families"><FamiliesPage /></Area>} />
        <Route path="/tasks" element={<Area area="tasks"><TasksPage /></Area>} />
        <Route path="/coverage" element={<Area area="coverage"><CoveragePage /></Area>} />
        <Route path="/dashboard" element={<Area area="dashboard"><DashboardPage /></Area>} />
        <Route path="/stories" element={<Area area="stories"><StoriesPage /></Area>} />
        <Route
          path="/admin/:section"
          element={<SuperAdminOnly><AdminSectionPage /></SuperAdminOnly>}
        />
        {/*
          Reserved seams (docs/admin/backend-contract-required.md §10):
          /approvals and /calls are intentionally unregistered. They exist in
          the AI #4 role assignment but in no part of the product brief, so
          they are not built. Adding one is a single Route here plus a nav
          registry entry — no refactor.
        */}
        <Route path="*" element={<Navigate to={homeFor(staff.role)} replace />} />
      </Routes>
    </AppShell>
  )
}
