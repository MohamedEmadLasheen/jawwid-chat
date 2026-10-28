/**
 * UX AFFORDANCES ONLY — NOT A SECURITY BOUNDARY.
 *
 * The backend is the sole authority (brief §12; docs/qa/rbac-matrix.md: "A
 * UI-only restriction is a defect, not a control"). Everything here exists so
 * that an operator sees a disabled control with an honest reason instead of
 * typing a reply and discovering a 403.
 *
 * Two consequences we hold ourselves to:
 *   1. Nothing here ever *grants* access. If the server says no, the answer is
 *      no, and the UI shows the server's message and refreshes.
 *   2. Per-family decisions are NOT made here. Only the server can evaluate
 *      on_duty(family, now), stickiness, assist eligibility and owner_locked,
 *      so each page takes them from the server's answer.
 *
 * This file therefore only answers coarse, role-level questions used for
 * navigation and page-level routing.
 */
import type { Staff, StaffRole } from '@/shared/types/domain'

export type NavArea =
  | 'chat'
  | 'tasks'
  | 'dashboard'
  | 'stories'
  | 'organization'
  | 'teachers'
  | 'instalments'
  | 'parents'
  | 'payments'
  | 'trials'
  | 'calls'
  | 'teacher-profiles'
  | 'accounts'
  | 'materials'
  | 'schedule'
  | 'cases'
  | 'certificates'
  | 'lesson-audio'
  | 'settings'

/** Roles that operate the customer relationship. */
const OPERATOR_ROLES: readonly StaffRole[] = ['admin', 'coverage', 'manager']

/** Departments: see and complete only their own tasks. Never message families. */
const DEPARTMENT_ROLES: readonly StaffRole[] = ['finance', 'technical', 'academic']

export function isOperator(role: StaffRole): boolean {
  return OPERATOR_ROLES.includes(role)
}

export function isDepartment(role: StaffRole): boolean {
  return DEPARTMENT_ROLES.includes(role)
}

export function isManager(role: StaffRole): boolean {
  return role === 'manager'
}

/**
 * The organization owner (PD-5). Sees every Admin Portal section, including the
 * ones still in development, plus every legacy screen. Seeing a section is not
 * being allowed to act in it: the API answers each request on its own. The
 * /admin sections are read-only inspection; the Chat workspace is where the
 * super admin replies, because PD-8 gives it full read+write on every
 * conversation of its organization (chat.staff_conversation_access).
 */
export function isSuperAdmin(role: StaffRole): boolean {
  return role === 'super_admin'
}

/** Which nav areas this role may even attempt to open. */
export function visibleAreas(role: StaffRole): NavArea[] {
  if (isSuperAdmin(role)) {
    // `teachers` stays routable for the super admin; it is offered as the
    // Admin Portal's Reports section rather than as an operator area.
    // `instalments` likewise: offered as an Admin Portal section.
    // `trials` (PD-11 T4, PD-16) is offered under People beside the Admin Portal's sections.
    // `chat` is the real conversation workspace: offered beside the read-only
    // Conversations section, so the super admin can reply (PD-8).
    // `calls` stays routable too (a call link lands on /calls/join/:id); the
    // page itself is offered as the Admin Portal's Calls section.
    // `teacher-profiles` (the teacher certificate review queue) is offered
    // under People as Teacher credentials review: the server admits the super
    // admin as a reviewer.
    // `parents` (PD-17) likewise: offered as the Admin Portal's Parents section.
    // `accounts` (PD-21) is offered beside the read-only Users section.
    // `payments` (PD-27) likewise: offered as the Admin Portal's Payments section.
    // `materials` (PD-29) is offered under More beside the Admin Portal's sections.
    // `schedule` (PD-38) is offered under People beside the Admin Portal's sections.
    // `certificates` (PD-41) is offered under People: the page and its types.
    // `lesson-audio` (PD-48): the voice-over review page, under More.
    return ['chat', 'tasks', 'dashboard', 'stories', 'teachers', 'instalments', 'parents', 'payments', 'trials', 'calls', 'teacher-profiles', 'accounts', 'materials', 'schedule', 'cases', 'certificates', 'lesson-audio', 'settings']
  }
  if (isManager(role)) {
    // PD-8: the department's structure -- children's supervisors and backups.
    // PD-11 T5: teacher statistics -- offered only when the server confirms
    // the Teachers department (see TEACHERS_DEPARTMENT_AREAS).
    // PD-12 S3 instalments and PD-11 T4 trials / new students -- each offered
    // only when the server confirms the department (see SERVER_CONFIRMED_AREAS).
    // PD-13: the Calls page (voice calls, scheduled calls, call links).
    // PD-29: the Materials library -- offered only when the server confirms
    // the Teachers manager (see SERVER_CONFIRMED_AREAS).
    // PD-38: the scheduling calendar -- offered only when the server confirms it.
    // PD-41: the Certificates page -- offered when GET /certificates/access opens it.
    // PD-48: Lesson audio -- offered when GET /lesson-audio/access opens it (the Teachers manager).
    return ['chat', 'calls', 'organization', 'teachers', 'schedule', 'instalments', 'parents', 'payments', 'trials', 'tasks', 'dashboard', 'stories', 'teacher-profiles', 'accounts', 'materials', 'cases', 'certificates', 'lesson-audio', 'settings']
  }
  if (isOperator(role)) {
    // No coverage configuration, no manager dashboard, no config editing.
    // Stories IS here: admin and coverage hold the publisher role server-side
    // (AuthorizationService.canPublishStory), and a nav entry that hid a page
    // the server would happily serve is a worse lie than one that shows it.
    //
    // Chat is first: the conversation workspace on the real conversation API
    // (the same conversations parents and teachers are in). The server decides
    // which ones this admin may open -- staff scope -- not this list.
    //
    // Calls (PD-13): the account's calls, scheduled calls and call links. What
    // each call may do is decided by the server's call capability.
    // teacher-profiles is here for the same reason stories is: admin and
    // coverage hold the reviewer role server-side
    // (AuthorizationService.canReviewTeacherProfile).
    // PD-48: Lesson audio, for a Teachers supervisor (listens) -- on the server's word.
    return ['chat', 'calls', 'teachers', 'schedule', 'instalments', 'parents', 'payments', 'trials', 'tasks', 'stories', 'teacher-profiles', 'accounts', 'cases', 'certificates', 'lesson-audio']
  }
  if (role === 'specialist') {
    // PD-40/PD-41: the Designer -- the Certificates page; PD-48: the
    // Pronunciation reviewer -- the Lesson audio page. Each only on the server's word.
    return ['certificates', 'lesson-audio']
  }
  if (isDepartment(role)) {
    // Departments get tasks — they may not open family records — and, PD-21
    // (owner decision: every staff role), account administration.
    return ['tasks', 'accounts']
  }
  return []
}

/**
 * PD-40: does GET /me report one of these permission keys? The page-level gate
 * for pages that are a permission's, not a role's (Staff accounts, Roles). It
 * fails closed: no keys reported (an API older than PD-40) is no page. The
 * super admin holds every key (chat.staff_access_profile). UX only.
 */
export function holdsAny(staff: Pick<Staff, 'role' | 'permissions'> | null | undefined, keys: readonly string[]): boolean {
  if (!staff) return false
  if (isSuperAdmin(staff.role)) return true
  return keys.some((key) => staff.permissions?.includes(key) === true)
}

export function canOpenArea(role: StaffRole, area: NavArea): boolean {
  return visibleAreas(role).includes(area)
}

/**
 * Areas offered only when the server confirms a fact the role alone does not
 * carry. The Teachers area (statistics, and -- PD-12 -- teacher files,
 * certificates, leave) belongs to the Teachers department (PD-10), and the
 * client cannot tell a Teachers supervisor from an Operations one by role, so
 * ONE probe, `GET /lessons/access`, decides whether the entry is shown.
 */
export const TEACHERS_DEPARTMENT_AREAS: ReadonlySet<NavArea> = new Set<NavArea>(['teachers'])

/** The server's answers to GET /lessons/access: the departments a role alone cannot tell apart. */
export interface DepartmentAccess {
  lessonManager?: boolean
  /** PD-11 T4: Sales books trials and records the decision. */
  sales?: boolean
  /** PD-11 T4: Operations sets up new students. */
  operations?: boolean
  /** PD-12 S3: GET /instalments/access -- Operations reads instalments (and, PD-17, Parent Profiles). */
  billingReader?: boolean
  /** PD-29: GET /materials/admin/access -- the super admin or the Teachers manager manages the library. */
  materialsManager?: boolean
  /** PD-38: GET /lessons/access -- the Teachers department, Operations and the super admin open the schedule. */
  calendar?: boolean
  /**
   * PD-26 amendment (owner 2026-10-27): GET /lessons/access -- the Teacher
   * Supervision page, for the Teachers department, the super admin and an
   * Operations supervisor (the teachers of their families).
   */
  supervisionPage?: boolean
  /** PD-41: GET /certificates/access -- the account holds a certificates key. */
  certificates?: boolean
  /** PD-48: GET /lesson-audio/access -- the account holds lesson_audio.view or .review. */
  lessonAudio?: boolean
}

/**
 * Every area offered only on the server's word, and the word it needs. The
 * Trials area serves three departments: Sales (trials), the Teachers
 * department (the teachers' trials) and Operations (new students).
 */
const SERVER_CONFIRMED_AREAS: Partial<Record<NavArea, (a: DepartmentAccess) => boolean>> = {
  // The Teachers department's area; Operations is offered its Supervision page only (PD-26 amendment).
  teachers: (a) => a.lessonManager === true || a.supervisionPage === true,
  trials: (a) => a.lessonManager === true || a.sales === true || a.operations === true,
  instalments: (a) => a.billingReader === true,
  // PD-17: the Parent Profile follows the same rule as the money on it.
  parents: (a) => a.billingReader === true,
  // PD-27: receipts and settings, read by whoever reads a family's money (each action is the server's).
  payments: (a) => a.billingReader === true,
  // PD-29: the library is the Teachers manager's (and the super admin's).
  materials: (a) => a.materialsManager === true,
  // PD-38: the scheduling calendar.
  schedule: (a) => a.calendar === true,
  // PD-41: the Certificates page, for whoever holds a certificates key.
  certificates: (a) => a.certificates === true,
  // PD-48: the Lesson audio review page, for whoever may listen.
  'lesson-audio': (a) => a.lessonAudio === true,
}

/** What navigation shows: the areas this role may open, minus those the server has not confirmed. */
export function navAreas(role: StaffRole, opts: DepartmentAccess = {}): NavArea[] {
  return visibleAreas(role).filter((area) => SERVER_CONFIRMED_AREAS[area]?.(opts) ?? true)
}

/** Manager-only, per the brief's invariants and AI #5's matrix. */
export const managerOnly = {
  editConfigWeights: isManager,
  readAuditLog: isManager,
  activateBackup: isManager,
  viewTeamWorkload: isManager,
  viewUnattended: isManager,
} as const

/** The task scope a role should request from the API. */
export function taskScopeFor(role: StaffRole): 'mine' | 'team' | 'department' {
  if (isManager(role) || isSuperAdmin(role)) return 'team'
  if (isDepartment(role)) return 'department'
  return 'mine'
}
