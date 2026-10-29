import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from '@/core/auth/SessionProvider'
import { canOpenArea, holdsAny, isDepartment, isSuperAdmin, type NavArea } from '@/core/permissions/capabilities'
import { LoadingState } from '@/shared/components/States'
import { AppShell } from './AppShell'
import { LoginPage } from '@/features/auth/LoginPage'
import { ChatPage } from '@/features/chat/ChatPage'
import { TasksPage } from '@/features/tasks/TasksPage'
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
import { TeachersAreaTabs } from '@/features/teachers/area'
import { CasesPage } from '@/features/cases/CasesPage'
import { TrialsPage } from '@/features/trials/TrialsPage'
import { NewStudentsPage } from '@/features/trials/NewStudentsPage'
import { TeacherFilesPage } from '@/features/teacher-files/TeacherFilesPage'
import { TeacherFilePage } from '@/features/teacher-files/TeacherFilePage'
import { CertificatesPage } from '@/features/certificates/CertificatesPage'
import { LessonAudioPage } from '@/features/lesson-audio/LessonAudioPage'
import type { Staff } from '@/shared/types/domain'
import { TeacherSupervisionPage } from '@/features/teacher-supervision/TeacherSupervisionPage'
import { TeacherBoardsPage } from '@/features/teacher-boards/TeacherBoardsPage'
import { BoardViewerPage } from '@/features/teacher-boards/BoardViewerPage'
import { BOARD_KEYS } from '@/features/teacher-boards/api'
import { InstalmentsPage } from '@/features/instalments/InstalmentsPage'
import { ParentsPage } from '@/features/profiles/ParentsPage'
import { ParentProfilePage } from '@/features/profiles/ParentProfilePage'
import { StudentProfilePage } from '@/features/profiles/StudentProfilePage'
import { PaymentsPage } from '@/features/payments/PaymentsPage'
import { MaterialsPage } from '@/features/materials/MaterialsPage'
import { CallsPage } from '@/features/calls-page/CallsPage'
import { JoinLinkPage } from '@/features/calls-page/JoinLinkPage'
import { TeacherProfilesPage } from '@/features/teacher-profiles/TeacherProfilesPage'
import { AccountsPage } from '@/features/accounts/AccountsPage'
import { StaffAccountsPage } from '@/features/staff-accounts/StaffAccountsPage'
import { RolesPage } from '@/features/staff-accounts/RolesPage'
import { ROLE_PAGE_KEYS, STAFF_ACCOUNT_KEYS } from '@/features/staff-accounts/AccountsTabs'
import { SupportSessionPage } from '@/features/support/SupportSessionPage'
import { DevicesPage } from '@/features/devices/DevicesPage'
import { NotificationsPage } from '@/features/notification-center/NotificationsPage'
import { SchedulePage } from '@/features/schedule/SchedulePage'
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

/**
 * PD-40: a page that belongs to a permission, not a role -- open when GET /me
 * reports one of `any`. Same rule as Area: UX, not security.
 */
function RequirePermission({ any, children }: { any: readonly string[]; children: ReactElement }) {
  const { staff } = useSession()
  if (!staff) return null
  return holdsAny(staff, any) ? children : <ForbiddenPage />
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
function homeFor(staff: Pick<Staff, 'role' | 'permissions'>): string {
  const role = staff.role
  if (isSuperAdmin(role)) return adminSectionPath('conversations')
  // PD-40/PD-41: the Designer's whole Admin Web is the Certificates page;
  // PD-48: a Pronunciation reviewer's is Lesson audio.
  if (role === 'specialist') return holdsAny(staff, ['lesson_audio.view', 'lesson_audio.review']) && !holdsAny(staff, ['certificates.view', 'certificates.design']) ? '/lesson-audio' : '/certificates'
  // The legacy department roles (finance, technical, academic) have no
  // conversations: they land on their Tasks (PD-47). Operators land in their
  // conversations: the chat workspace on the real API.
  return isDepartment(role) ? '/tasks' : '/chat'
}

export function AppRoutes() {
  const { isLoading, isAuthenticated, staff } = useSession()

  if (isLoading) return <LoadingState />
  if (!isAuthenticated || !staff) return <LoginPage />

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to={homeFor(staff)} replace />} />
        <Route path="/chat" element={<Area area="chat"><ChatPage /></Area>} />
        <Route path="/chat/:conversationId" element={<Area area="chat"><ChatPage /></Area>} />
        {/* PD-13: the Calls page; the super admin reaches it as /admin/calls. A
            call link (members-only) lands on /calls/join/:id for both. */}
        <Route path="/calls" element={<Area area="calls"><CallsPage /></Area>} />
        <Route path="/calls/join/:scheduledCallId" element={<Area area="calls"><JoinLinkPage /></Area>} />
        <Route path="/organization" element={<Area area="organization"><OrganizationPage /></Area>} />
        {/* The Teachers area (features/teachers/area.tsx): Statistics is its base tab. */}
        <Route path="/teachers" element={<Area area="teachers"><TeacherStatsPage inTeachersArea /></Area>} />
        <Route path="/teachers/needs-action" element={<Area area="teachers"><NeedsActionPage /></Area>} />
        <Route path="/teachers/schedules" element={<Area area="teachers"><SchedulesPage /></Area>} />
        <Route path="/teachers/students" element={<Area area="teachers"><StudentsPage /></Area>} />
        {/* PD-38: the academy's scheduling calendar; the server decides each request (GET /calendar*). */}
        <Route path="/schedule" element={<Area area="schedule"><SchedulePage /></Area>} />
        {/* PD-10 Teacher Files: a tab of the same area; the server refuses anyone else. */}
        <Route path="/teachers/files" element={<Area area="teachers"><TeacherFilesPage basePath="/teachers/files" /></Area>} />
        <Route path="/teachers/files/:teacherId" element={<Area area="teachers"><TeacherFilePage basePath="/teachers/files" /></Area>} />
        {/* PD-12: the department's queues, tabs of the same area. */}
        {/* PD-41: certificates have their own page; the PD-12 tab lands there. */}
        <Route path="/certificates" element={<Area area="certificates"><CertificatesPage /></Area>} />
        {/* PD-48: lesson voice-over review (listen; two different reviewers approve each clip). */}
        <Route path="/lesson-audio" element={<Area area="lesson-audio"><LessonAudioPage /></Area>} />
        <Route path="/teachers/certificates" element={<Navigate to="/certificates?category=student" replace />} />
        {/* PD-26: leave, absences, lateness, rewards and complaints are one page; the old tabs land on their section. */}
        <Route path="/teachers/supervision" element={<Area area="teachers"><TeacherSupervisionPage basePath="/teachers" /></Area>} />
        {/* PD-35 B5: escalation cases -- a Teachers tab, and /cases for everyone else who opens or owns one. */}
        <Route path="/teachers/cases" element={<Area area="teachers"><CasesPage header={<TeachersAreaTabs />} /></Area>} />
        {/* PD-39: the teachers' boards, read only; the server decides each teacher. */}
        <Route path="/teachers/boards" element={<Area area="teachers"><RequirePermission any={BOARD_KEYS}><TeacherBoardsPage basePath="/teachers" /></RequirePermission></Area>} />
        <Route path="/teachers/boards/:boardId" element={<Area area="teachers"><RequirePermission any={BOARD_KEYS}><BoardViewerPage basePath="/teachers" /></RequirePermission></Area>} />
        <Route path="/cases" element={<Area area="cases"><CasesPage /></Area>} />
        <Route path="/teachers/leave" element={<Navigate to="/teachers/supervision?section=leave" replace />} />
        {/* PD-11 T4: Sales' trials and Operations' new students (features/trials/area.tsx). */}
        <Route path="/trials" element={<Area area="trials"><TrialsPage /></Area>} />
        <Route path="/trials/new-students" element={<Area area="trials"><NewStudentsPage /></Area>} />
        <Route path="/teachers/discipline" element={<Navigate to="/teachers/supervision?section=absences" replace />} />
        {/* PD-12 S3: Operations; the super admin reaches it as /admin/instalments. */}
        <Route path="/instalments" element={<Area area="instalments"><InstalmentsPage /></Area>} />
        {/* PD-17: the administration's Parent Profile (the super admin lists parents at /admin/parents). */}
        <Route path="/parents" element={<Area area="parents"><ParentsPage /></Area>} />
        <Route path="/parents/:contactId" element={<Area area="parents"><ParentProfilePage /></Area>} />
        {/* PD-27: receipts to verify and payment settings (the super admin reaches it as /admin/payments). */}
        <Route path="/payments" element={<Area area="payments"><PaymentsPage /></Area>} />
        {/* PD-29: the Materials library (the super admin and the Teachers manager). */}
        <Route path="/materials" element={<Area area="materials"><MaterialsPage /></Area>} />
        {/* PD-17: the Student Profile. Several departments open it, so the server alone decides. */}
        <Route path="/students/:learnerId" element={<StudentProfilePage />} />
        <Route path="/tasks" element={<Area area="tasks"><TasksPage /></Area>} />
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
          Teacher qualification certificates: the review queue (Teacher Profile
          V2). Not PD-12's student certificates, which live under Teachers.
          The server decides every request (canReviewTeacherProfile).
        */}
        <Route
          path="/teacher-profiles"
          element={<Area area="teacher-profiles"><TeacherProfilesPage /></Area>}
        />
        {/* PD-21: account administration -- every staff role; the server decides each account and action. */}
        <Route path="/accounts" element={<Area area="accounts"><AccountsPage /></Area>} />
        {/* PD-40: tabs of the Accounts page, each for the permission keys /me reports; the server decides every request. */}
        <Route
          path="/accounts/staff"
          element={<Area area="accounts"><RequirePermission any={STAFF_ACCOUNT_KEYS}><StaffAccountsPage /></RequirePermission></Area>}
        />
        <Route
          path="/accounts/roles"
          element={<Area area="accounts"><RequirePermission any={ROLE_PAGE_KEYS}><RolesPage /></RequirePermission></Area>}
        />
        {/* PD-21: a support session (acting as a parent or teacher); the token lives in memory only. */}
        <Route path="/support/:impersonationId" element={<Area area="accounts"><SupportSessionPage /></Area>} />
        {/*
          Staff profiles: every staff role, no Area gate. What a profile shows
          and what may be changed on it is decided by /staff-profiles per
          request; the route only names which profile to ask for.
        */}
        <Route path="/profile" element={<ProfilePage />} />
        {/* PD-23: the signed-in staff member's own devices and sessions, every
            role (GET /me/sessions answers only for the caller). A static
            segment, so it outranks /profile/:staffId. */}
        <Route path="/profile/devices" element={<DevicesPage />} />
        {/* PD-34: every staff member's own Notification Center; the server
            answers only for the caller. */}
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile/:staffId" element={<ProfilePage />} />
        <Route
          path="/admin/:section"
          element={<SuperAdminOnly><AdminSectionPage /></SuperAdminOnly>}
        />
        <Route path="/admin/teachers/certificates" element={<Navigate to="/certificates?category=student" replace />} />
        <Route
          path="/admin/teachers/discipline"
          element={<Navigate to={`${adminSectionPath('teachers')}/supervision?section=absences`} replace />}
        />
        <Route
          path="/admin/teachers/leave"
          element={<Navigate to={`${adminSectionPath('teachers')}/supervision?section=leave`} replace />}
        />
        <Route
          path="/admin/teachers/supervision"
          element={<SuperAdminOnly><TeacherSupervisionPage basePath={adminSectionPath('teachers')} /></SuperAdminOnly>}
        />
        <Route path="/admin/teachers/boards" element={<SuperAdminOnly><TeacherBoardsPage basePath={adminSectionPath('teachers')} /></SuperAdminOnly>} />
        <Route path="/admin/teachers/boards/:boardId" element={<SuperAdminOnly><BoardViewerPage basePath={adminSectionPath('teachers')} /></SuperAdminOnly>} />
        <Route
          path="/admin/teachers/:teacherId"
          element={<SuperAdminOnly><TeacherFilePage basePath={adminSectionPath('teachers')} /></SuperAdminOnly>}
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
          Reserved seam (docs/admin/backend-contract-required.md §10):
          /approvals is intentionally unregistered. It exists in the AI #4
          role assignment but in no part of the product brief, so it is not
          built. Adding it is a single Route here plus a nav registry entry —
          no refactor. (/calls was the other seam; PD-13 filled it.)
        */}
        <Route path="*" element={<Navigate to={homeFor(staff)} replace />} />
      </Routes>
    </AppShell>
  )
}
