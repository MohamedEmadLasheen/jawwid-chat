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
import { StoriesStudio } from '@/features/stories/StoriesStudio'
import { StoryComposer } from '@/features/stories/StoryComposer'
import { StoryInsights } from '@/features/stories/StoryInsights'
import { AdminSectionPage } from '@/features/admin/AdminSectionPage'
import { adminSectionPath } from '@/features/admin/sections'
import { ProfilePage } from '@/features/profile/ProfilePage'
import { OrganizationPage } from '@/features/organization/OrganizationPage'
import { TeacherStatsPage } from '@/features/teachers/TeacherStatsPage'
import { NeedsActionPage } from '@/features/teachers/NeedsActionPage'
import { SchedulesPage } from '@/features/teachers/SchedulesPage'
import { StudentsPage } from '@/features/teachers/StudentsPage'
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

/** Where "/" (and so a fresh sign-in with no deep link) lands: the role's
 *  conversations. The Dashboard stays at its own URL, under More. */
function homeFor(role: Parameters<typeof isDepartment>[0]): string {
  if (isSuperAdmin(role)) return adminSectionPath('conversations')
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
        <Route path="/organization" element={<Area area="organization"><OrganizationPage /></Area>} />
        {/* The Teachers area (features/teachers/area.tsx): Statistics is its base tab. */}
        <Route path="/teachers" element={<Area area="teachers"><TeacherStatsPage inTeachersArea /></Area>} />
        <Route path="/teachers/needs-action" element={<Area area="teachers"><NeedsActionPage /></Area>} />
        <Route path="/teachers/schedules" element={<Area area="teachers"><SchedulesPage /></Area>} />
        <Route path="/teachers/students" element={<Area area="teachers"><StudentsPage /></Area>} />
        <Route path="/tasks" element={<Area area="tasks"><TasksPage /></Area>} />
        <Route path="/coverage" element={<Area area="coverage"><CoveragePage /></Area>} />
        <Route path="/dashboard" element={<Area area="dashboard"><DashboardPage /></Area>} />
        {/*
          Stories: one studio, two homes. Operators (admin, coverage, manager)
          publish under /stories; the super admin under /admin/stories. The
          server decides every request on its own (canPublishStory).
        */}
        <Route path="/stories" element={<Area area="stories"><StoriesStudio basePath="/stories" /></Area>} />
        <Route path="/stories/new" element={<Area area="stories"><StoryComposer basePath="/stories" /></Area>} />
        <Route path="/stories/:storyId" element={<Area area="stories"><StoryInsights basePath="/stories" /></Area>} />
        {/*
          Staff profiles: every staff role, no Area gate. What a profile shows
          and what may be changed on it is decided by /staff-profiles per
          request; the route only names which profile to ask for.
        */}
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/:staffId" element={<ProfilePage />} />
        <Route
          path="/admin/:section"
          element={<SuperAdminOnly><AdminSectionPage /></SuperAdminOnly>}
        />
        <Route
          path="/admin/stories/new"
          element={<SuperAdminOnly><StoryComposer basePath={adminSectionPath('stories')} /></SuperAdminOnly>}
        />
        <Route
          path="/admin/stories/:storyId"
          element={<SuperAdminOnly><StoryInsights basePath={adminSectionPath('stories')} /></SuperAdminOnly>}
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
