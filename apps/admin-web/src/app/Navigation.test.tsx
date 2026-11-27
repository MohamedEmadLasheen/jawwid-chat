import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { navAreas, visibleAreas, type NavArea } from '@/core/permissions/capabilities'
import { ADMIN_SECTIONS } from '@/features/admin/sections'
import type { StaffRole } from '@/shared/types/domain'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { AREA_PATH, DESTINATIONS, destinationsFor, entriesOf, soleEntry } from './navigation'

/**
 * Conversation-first navigation (2026-10-13): "/" opens the role's
 * conversations, a desktop icon rail holds five destinations, the drawer holds
 * the same ones below desktop width, and no page a role may open has become
 * unreachable. Every actor here is synthetic, so this proves the UI's routing
 * and listing only; what each role may actually read is decided server-side.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/v1/, '').split('?')[0]!
    if (path in routes) return jsonResponse(routes[path])
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404)
  })
}

/** Answers min-width/max-width queries for a window of the given width. */
function viewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    const max = /max-width:\s*(\d+)px/.exec(query)
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])) && Boolean(min || max)
    return { matches, media: query, addEventListener: () => {}, removeEventListener: () => {} }
  })
}

function Where() {
  const { pathname, search } = useLocation()
  return <output data-testid="where">{pathname + search}</output>
}

const staff = (role: StaffRole) => makeStaff({ id: `staff_${role}`, name: `Synthetic ${role}`, role })
const superAdmin = staff('super_admin')
const OPERATOR_ROLES: StaffRole[] = ['manager', 'admin', 'coverage', 'finance', 'technical', 'academic']

/** PD-44: what GET /dashboard/chats and /dashboard/cases answer a manager here. */
const DASHBOARD_ROUTES = {
  '/dashboard/chats': { generatedAt: '2026-10-28T09:00:00.000Z', tiles: [{ key: 'chats.waiting', count: 2, oldestAt: null, capped: false }] },
  '/dashboard/cases': {
    generatedAt: '2026-10-28T09:00:00.000Z',
    tiles: [
      { key: 'cases.mine_open', count: 0, oldestAt: null, capped: false },
      { key: 'cases.department_open', count: 1, oldestAt: null, capped: false },
      { key: 'cases.overdue', count: 0, oldestAt: null, capped: false },
    ],
  },
}
const dashboardManager = makeStaff({ id: 'staff_manager', role: 'manager', permissions: ['chat.use', 'cases.view'] })

beforeEach(() => {
  localStorage.clear()
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('The navigation registry', () => {
  it('gives each of the twenty-one sections exactly one destination, in the nine sections of the rail', () => {
    const destinations = destinationsFor('super_admin')
    expect(destinations.map((d) => d.key)).toEqual([
      'conversations', 'dashboard', 'people', 'sales', 'scheduling', 'operations', 'certificates', 'materials', 'finance', 'communication', 'admin',
    ])
    const keys = destinations.flatMap((d) => entriesOf(d).map((e) => e.key))
    // The twenty-one sections, plus Chat (PD-8: where the super admin replies),
    // Accounts (PD-21: where every staff role administers accounts),
    // Materials (PD-29: the library the super admin manages), the Schedule
    // (PD-38: the academy's calendar), Trials and New students (PD-11 T4,
    // PD-16, now Sales), the Teachers' and Student schedules (Scheduling), Teacher credentials review, Escalations (PD-35 B5) and
    // Certificates (PD-41) and Lesson audio (PD-48, under More), and
    // the two teacher-records pages (PD-52, their own group under People), and
    // Team (the staff directory, beside Accounts and Users).
    expect(keys).toHaveLength(39)
    expect([...keys].sort()).toEqual(
      [...ADMIN_SECTIONS.map((s) => s.key), 'needs-action', 'chat', 'accounts', 'materials', 'schedule', 'teacher-schedules', 'student-schedules', 'students', 'sales-pipeline', 'trials', 'new-students', 'teacher-profiles', 'certificates', 'lesson-audio', 'moderation', 'teacher-attendance', 'teacher-grants', 'team'].sort(),
    )
    const conversations = destinations.find((d) => d.key === 'conversations')!
    expect(entriesOf(conversations).map((e) => e.path)).toEqual(['/chat', '/admin/conversations', '/moderation'])
    const dashboard = destinations.find((d) => d.key === 'dashboard')!
    expect(entriesOf(dashboard).map((e) => e.key)).toEqual(['dashboard', 'tasks'])
    const finance = destinations.find((d) => d.key === 'finance')!
    expect(entriesOf(finance).map((e) => e.key)).toEqual(['instalments', 'payments'])
    const admin = destinations.find((d) => d.key === 'admin')!
    expect(admin.groups.map((g) => g.label?.en)).toEqual(['Reports & quality', 'System'])
  })

  it('lists for each role exactly the pages it may open: nothing hidden, nothing extra', () => {
    for (const role of OPERATOR_ROLES) {
      for (const [lessonManager, billingReader] of [[false, false], [true, false], [false, true], [true, true]] as const) {
        const listed = destinationsFor(role, { lessonManager, billingReader }).flatMap((d) => entriesOf(d).map((e) => e.path))
        // Exactly the openable areas, with one deliberate exception: Teacher
        // statistics is offered only when the server confirms the Teachers
        // department (GET /lessons/access), which the role alone cannot tell --
        // and Instalments likewise waits for Operations (GET /instalments/access).
        // Escalations (`cases`) is a tab of Tasks, not an entry of the rail.
        const allowed = navAreas(role, { lessonManager, billingReader })
          .filter((a): a is Exclude<NavArea, 'settings' | 'cases'> => a !== 'settings' && a !== 'cases')
          .map((a) => AREA_PATH[a])
        // Team is not an area: a manager lists their own team (GET /staff-profiles/team decides who).
        if (role === 'manager') allowed.push('/team')
        expect([...listed].sort(), role).toEqual([...allowed].sort())
        expect(listed, role).not.toContain('/inbox')
        const withheld = [
          ...(!lessonManager && visibleAreas(role).includes('teachers') ? ['teachers'] : []),
          // PD-38: the Schedule waits for GET /lessons/access to say `calendar`.
          ...(visibleAreas(role).includes('schedule') ? ['schedule'] : []),
          // Scheduling desks: the Teachers department's, on the same word as its area.
          ...(!lessonManager && visibleAreas(role).includes('teacher-schedules') ? ['teacher-schedules', 'student-schedules', 'students', 'needs-action'] : []),
          ...(!billingReader && visibleAreas(role).includes('instalments') ? ['instalments'] : []),
          // PD-17: the Parent Profile follows the money's rule (GET /instalments/access).
          ...(!billingReader && visibleAreas(role).includes('parents') ? ['parents'] : []),
          // PD-27: Payments likewise.
          ...(!billingReader && visibleAreas(role).includes('payments') ? ['payments'] : []),
          // PD-59: the Sales pipeline waits for `sales` (GET /lessons/access), not asked here.
          ...(visibleAreas(role).includes('sales-pipeline') ? ['sales-pipeline'] : []),
          ...(!lessonManager && visibleAreas(role).includes('trials') ? ['trials'] : []),
          // New students waits for Sales or Operations (GET /lessons/access), neither asked here.
          ...(visibleAreas(role).includes('new-students') ? ['new-students'] : []),
          // ADMIN-006: Teacher credentials waits for the Teachers department (GET /lessons/access).
          ...(!lessonManager && visibleAreas(role).includes('teacher-profiles') ? ['teacher-profiles'] : []),
          // PD-29: Materials waits for the Teachers manager (GET /materials/admin/access).
          ...(visibleAreas(role).includes('materials') ? ['materials'] : []),
          // PD-41: Certificates waits for GET /certificates/access.
          ...(visibleAreas(role).includes('certificates') ? ['certificates'] : []),
          // PD-48: Lesson audio waits for GET /lesson-audio/access.
          ...(visibleAreas(role).includes('lesson-audio') ? ['lesson-audio'] : []),
          // PD-57: the moderation queue waits for the moderation.view permission.
          ...(visibleAreas(role).includes('moderation') ? ['moderation'] : []),
          // PD-52: Attendance & complaints waits for GET /teacher-records/access.
          ...(visibleAreas(role).includes('teacher-attendance') ? ['teacher-attendance'] : []),
          ...(visibleAreas(role).includes('teacher-grants') ? ['teacher-grants'] : []),
        ]
        expect(visibleAreas(role).filter((a) => !navAreas(role, { lessonManager, billingReader }).includes(a)), role).toEqual(withheld)
        expect(listed.some((p) => p.startsWith('/admin/')), role).toBe(false)
      }
    }
    // And the super admin's navigation is the portal, not the operator screens
    // -- except Chat, the one workspace it writes in (PD-8), Accounts, the
    // one page every staff role shares (PD-21), the Schedule it shares with
    // the Teachers department and Operations (PD-38), Trials & new students,
    // which it shares with Sales and Operations (PD-11 T4, PD-16), Teacher
    // credentials review (the queue it reviews with operators), Escalations
    // (PD-35 B5) and Materials, the library it manages with the Teachers
    // manager (PD-29), and Lesson audio, whose keys it holds (PD-48); and Team,
    // the staff directory every manager has for their own people.
    const listed = destinationsFor('super_admin').flatMap((d) => entriesOf(d).map((e) => e.path))
    expect(listed.filter((p) => !p.startsWith('/admin/'))).toEqual(['/chat', '/moderation', '/accounts', '/team', '/teacher-profiles', '/students', '/sales/pipeline', '/trials', '/trials/new-students', '/schedule', '/teachers/schedules', '/schedule/students', '/teachers/needs-action', '/lesson-audio', '/certificates', '/materials'])
    // PD-38: an operator is offered the Schedule on the server's word only
    // (the department roles -- finance, technical, academic -- never are).
    for (const role of ['manager', 'admin', 'coverage'] as const) {
      expect(destinationsFor(role, { calendar: true }).flatMap((d) => entriesOf(d).map((e) => e.path)), role).toContain('/schedule')
      expect(destinationsFor(role, {}).flatMap((d) => entriesOf(d).map((e) => e.path)), role).not.toContain('/schedule')
    }
    // The Teachers manager is offered Materials on the server's word only.
    expect(destinationsFor('manager', { materialsWorkspace: true }).flatMap((d) => entriesOf(d).map((e) => e.path))).toContain('/materials')
    // ...a Teachers supervisor (admin) and a designated Content author (specialist) on the same word -- never without it.
    for (const role of ['admin', 'coverage', 'specialist'] as const) {
      expect(destinationsFor(role, { materialsWorkspace: true }).flatMap((d) => entriesOf(d).map((e) => e.path)), role).toContain('/materials')
      expect(destinationsFor(role, {}).flatMap((d) => entriesOf(d).map((e) => e.path)), role).not.toContain('/materials')
    }
  })
})

describe('People & Organization', () => {
  it('groups the super admin\'s pages by subject and holds nothing that is not about people', () => {
    const people = destinationsFor('super_admin').find((d) => d.key === 'people')!
    expect(people.groups.map((g) => [g.label?.en, g.entries.map((e) => e.key)])).toEqual([
      ['Staff & accounts', ['accounts', 'users', 'team']],
      ['Teachers', ['teachers', 'teacher-profiles', 'teacher-attendance', 'teacher-grants']],
      ['Families', ['parents', 'students']],
      ['Organization', ['teams']],
    ])
    // Money, trials, scheduling and escalations moved out; they are not people management.
    const keys = entriesOf(people).map((e) => e.key)
    for (const gone of ['instalments', 'payments', 'trials', 'schedule', 'cases', 'certificates']) expect(keys).not.toContain(gone)
  })

  it('shows an operator only the headings it has pages under, and no heading for a lone group', () => {
    const manager = destinationsFor('manager', { lessonManager: true, billingReader: true }).find((d) => d.key === 'people')!
    expect(manager.groups.map((g) => g.key)).toEqual(['accounts', 'teachers', 'families', 'organization'])
    const admin = destinationsFor('admin', {}).find((d) => d.key === 'people')!
    expect(admin.groups.map((g) => g.label)).toEqual([null])
  })
})

describe('The nine sections', () => {
  const pathsIn = (dest: string, role: 'admin' | 'manager' | 'super_admin' | 'specialist', access = {}) => {
    const d = destinationsFor(role, access).find((x) => x.key === dest)
    return d ? entriesOf(d).map((e) => e.path) : []
  }

  it('Finance holds Instalments and Payments for whoever reads a family\'s money, and nobody else', () => {
    expect(pathsIn('finance', 'admin', { billingReader: true })).toEqual(['/instalments', '/payments'])
    expect(pathsIn('finance', 'admin', {})).toEqual([])
    expect(pathsIn('finance', 'super_admin')).toEqual(['/admin/instalments', '/admin/payments'])
    // Parents stay under People, and their profile is where money is recorded.
    expect(pathsIn('people', 'admin', { billingReader: true })).toContain('/parents')
  })

  it('Operations holds the supervisors\' queue, escalations and lesson audio; Certificates and Educational materials have destinations of their own', () => {
    const access = { lessonManager: true, certificates: true, lessonAudio: true, materialsWorkspace: true }
    expect(pathsIn('operations', 'manager', access)).toEqual([
      // The Teachers department's Trial lessons page is listed here, not under Sales (PD-59 owner decision).
      '/teachers/needs-action', '/trials', '/lesson-audio',
    ])
    expect(pathsIn('certificates', 'manager', access)).toEqual(['/certificates'])
    expect(pathsIn('materials', 'manager', access)).toEqual(['/materials'])
    expect(pathsIn('operations', 'admin', {})).toEqual([])
    // Escalations is a tab of Tasks: reached from there, never listed in the rail.
    for (const role of ['admin', 'manager', 'super_admin'] as const) expect(destinationsFor(role, access).flatMap((d) => entriesOf(d).map((e) => e.key)), role).not.toContain('cases')
    // The Marketing designer's whole workspace is one rail item, and nothing else is listed for them but their tasks.
    const designer = destinationsFor('specialist', { certificates: true })
    expect(designer.map((d) => d.key)).toEqual(['dashboard', 'certificates'])
    expect(soleEntry(designer.find((d) => d.key === 'certificates')!)?.path).toBe('/certificates')
    // Nobody is offered either page without the server's word.
    for (const role of ['manager', 'admin', 'coverage', 'specialist'] as const) {
      expect(destinationsFor(role, {}).map((d) => d.key), role).not.toContain('certificates')
      expect(destinationsFor(role, {}).map((d) => d.key), role).not.toContain('materials')
    }
  })

  it('Communication holds Calls and Stories; the unbuilt communication tools sit beside them for the super admin', () => {
    expect(pathsIn('communication', 'admin')).toEqual(['/calls', '/stories'])
    expect(pathsIn('communication', 'super_admin')).toEqual(['/admin/stories', '/admin/notifications', '/admin/calls', '/admin/whatsapp'])
  })

  it('every role\'s rail is in the owner\'s order, and no destination is empty', () => {
    const order = DESTINATIONS.map((d) => d.key)
    for (const role of ['super_admin', 'manager', 'admin', 'coverage', 'finance'] as const) {
      const keys = destinationsFor(role, { lessonManager: true, sales: true, operations: true, billingReader: true, calendar: true }).map((d) => d.key)
      expect(keys, role).toEqual(order.filter((k) => keys.includes(k)))
      for (const d of destinationsFor(role, { lessonManager: true })) expect(entriesOf(d).length, `${role}/${d.key}`).toBeGreaterThan(0)
    }
  })
})

describe('No URL was lost in the redesign', () => {
  const ALL = { lessonManager: true, sales: true, operations: true, billingReader: true, calendar: true, materialsWorkspace: true, certificates: true, lessonAudio: true, teacherAttendance: true, teacherGrants: true, moderation: true }

  /** Every path this suite can render must stay where it points: not sent home, not Forbidden. */
  async function staysPut(role: StaffRole, path: string) {
    vi.stubGlobal('fetch', routeFetch({}))
    const { unmount } = renderWithProviders(
      <>
        <AppRoutes />
        <Where />
      </>,
      // The moderation queue is a permission's page, not a role's: hold its key.
      { staff: makeStaff({ id: `staff_${role}`, name: `Synthetic ${role}`, role, permissions: ['moderation.view'] }), route: path },
    )
    await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByTestId('where').textContent, `${role} ${path}`).toBe(path)
    expect(document.querySelector('.state--forbidden'), `${role} ${path} is forbidden`).toBeNull()
    unmount()
  }

  it('every page the rail offers a role opens on its own URL', async () => {
    for (const role of ['super_admin', 'manager', 'admin', 'coverage', 'finance'] as const) {
      const paths = destinationsFor(role, ALL).flatMap((d) => entriesOf(d).map((e) => e.path))
      expect(paths.length, role).toBeGreaterThan(0)
      expect(new Set(paths).size, `${role}: one entry per page`).toBe(paths.length)
      for (const path of paths) await staysPut(role, path)
    }
  }, 60_000)

  it('every URL that existed before the redesign still opens for the roles that had it', async () => {
    const legacy = [
      '/trials', '/trials/new-students', '/sales/pipeline', '/schedule', '/teachers', '/teachers/needs-action', '/teachers/schedules',
      '/teachers/students', '/teachers/files', '/cases', '/certificates',
      '/lesson-audio', '/moderation', '/instalments', '/parents', '/payments', '/materials', '/tasks', '/dashboard',
      '/stories', '/accounts', '/organization', '/calls', '/chat', '/teacher-profiles', '/teacher-attendance', '/teacher-grants',
    ]
    for (const path of legacy) await staysPut('manager', path)
    // The Teachers area's old Escalations tab now lives on Tasks: its link lands on /cases.
    vi.stubGlobal('fetch', routeFetch({}))
    const redirected = renderWithProviders(<><AppRoutes /><Where /></>, { staff: makeStaff({ id: 'staff_manager', role: 'manager', permissions: ['cases.manage'] }), route: '/teachers/cases' })
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/cases'))
    redirected.unmount()
    // The older Supervision and Leave links keep redirecting to Attendance & complaints (PD-52).
    // They are covered by the PD-52 tests.
    const admin = ['/admin/conversations', '/admin/dashboard', '/admin/tasks', '/admin/reports', '/admin/teachers', '/admin/instalments', '/admin/payments', '/admin/parents', '/admin/users', '/admin/teams', '/admin/calls', '/admin/stories', '/admin/whatsapp', '/admin/audit', '/admin/settings', '/admin/teacher-attendance', '/admin/teacher-grants']
    for (const path of admin) await staysPut('super_admin', path)
  }, 90_000)
})

describe('Landing and deep links', () => {
  it('"/" opens each role\'s conversations, and a department\'s tasks', async () => {
    const expected: [StaffRole, string][] = [
      ['super_admin', '/admin/conversations'],
      ['manager', '/chat'],
      ['admin', '/chat'],
      ['coverage', '/chat'],
      ['finance', '/tasks'],
    ]
    for (const [role, home] of expected) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(
        <>
          <AppRoutes />
          <Where />
        </>,
        { staff: staff(role), route: '/' },
      )
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(home))
      unmount()
    }
  })

  it('keeps a deep link where it points, including the Dashboard that left the rail', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(
      <>
        <AppRoutes />
        <Where />
      </>,
      { staff: superAdmin, route: '/admin/dashboard' },
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/dashboard')
  })

  it('PD-13: opens the Calls page at /calls for operators and /admin/calls for the super admin', async () => {
    for (const [role, route] of [['admin', '/calls'], ['coverage', '/calls'], ['manager', '/calls'], ['super_admin', '/admin/calls']] as const) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(<AppRoutes />, { staff: staff(role), route })
      expect(await screen.findByRole('heading', { level: 1, name: 'Calls' }), role).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Schedule call' }), role).toBeInTheDocument()
      unmount()
    }
    // A department has no calls page; the route answers Forbidden.
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: staff('finance'), route: '/calls' })
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission")
  })

  it('sends an unknown path home, never to a page the role cannot open', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(
      <>
        <AppRoutes />
        <Where />
      </>,
      { staff: staff('finance'), route: '/no-such-page' },
    )
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/tasks'))
  })

  it('answers a page outside the role with Forbidden, and does not list it', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: staff('admin'), route: '/dashboard' })
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission")
    expect(within(screen.getByRole('navigation')).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
  })
})

describe('The retired Coverage page', () => {
  // Shifts, coverage rules and absences were replaced by PD-8 backups and
  // PD-33 covers on the Organization page; the API never had /coverage routes.
  it('is listed for no role', () => {
    for (const role of [...OPERATOR_ROLES, 'super_admin'] as StaffRole[]) {
      const entries = destinationsFor(role, { lessonManager: true, billingReader: true }).flatMap(entriesOf)
      expect(entries.map((e) => e.path)).not.toContain('/coverage')
      expect(entries.map((e) => e.key)).not.toContain('coverage')
    }
  })

  it('is not a route: /coverage falls to the unknown-path handling, like any other', async () => {
    for (const [role, home] of [['manager', '/chat'], ['super_admin', '/admin/conversations']] as const) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(
        <>
          <AppRoutes />
          <Where />
        </>,
        { staff: staff(role), route: '/coverage' },
      )
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(home))
      expect(screen.queryByRole('heading', { name: 'Coverage' })).not.toBeInTheDocument()
      unmount()
    }
  })
})

describe('The retired Families page', () => {
  // The API never served GET /families: family records live in Chat, the
  // Parent Profile (/parents) and Accounts (/accounts).
  it('is listed for no role', () => {
    for (const role of [...OPERATOR_ROLES, 'super_admin'] as StaffRole[]) {
      expect(visibleAreas(role), role).not.toContain('families')
      const entries = destinationsFor(role, { lessonManager: true, billingReader: true }).flatMap(entriesOf)
      expect(entries.map((e) => e.path)).not.toContain('/families')
      expect(entries.map((e) => e.key)).not.toContain('families')
    }
  })

  it('is not a route: /families falls to the unknown-path handling, like any other', async () => {
    for (const [role, home] of [['manager', '/chat'], ['super_admin', '/admin/conversations']] as const) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(
        <>
          <AppRoutes />
          <Where />
        </>,
        { staff: staff(role), route: '/families?bucket=now' },
      )
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(home))
      expect(screen.queryByRole('heading', { name: 'Families' })).not.toBeInTheDocument()
      unmount()
    }
  })

  it('is no longer where the Dashboard sends the manager', async () => {
    const fetchMock = routeFetch(DASHBOARD_ROUTES)
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AppRoutes />, { staff: dashboardManager, route: '/dashboard' })
    // PD-44: every tile opens a working page; none opens the retired families list.
    await screen.findByRole('link', { name: /Chats waiting for our reply/ })
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href') ?? '')
    expect(hrefs.filter((h) => /^\/families(\/|\?|$)/.test(h))).toEqual([])
    expect(fetchMock.mock.calls.some(([url]) => /\/families(\?|$)/.test(String(url)))).toBe(false)
  })
})

describe('The desktop rail', () => {
  beforeEach(() => viewport(1440))

  it('shows the super admin nine destinations, Conversations current and Admin & Settings last', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/' })
    const nav = await screen.findByRole('navigation', { name: 'Admin Portal' })
    const items = [...nav.querySelectorAll('[data-destination]')]
    expect(items.map((el) => el.getAttribute('data-destination'))).toEqual([
      'conversations', 'dashboard', 'people', 'sales', 'scheduling', 'operations', 'certificates', 'materials', 'finance', 'communication', 'admin',
    ])
    // Conversations is a menu now -- Chat and All conversations -- and it is
    // where the super admin lands.
    await waitFor(() =>
      expect(within(nav).getByRole('button', { name: 'Conversations' })).toHaveAttribute('aria-current', 'true'),
    )
    // Finance holds two pages, so it is a menu; the Dashboard holds the Dashboard and Tasks.
    expect(within(nav).getByRole('button', { name: 'Finance' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(nav).getByRole('button', { name: 'Communication' })).toHaveAttribute('aria-expanded', 'false')
    // A placeholder still says so, inside its menu.
    expect(within(nav).queryByRole('link', { name: /In development/ })).not.toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'People & Organization' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(nav).getByRole('button', { name: 'Admin & Settings' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens Admin & Settings as a grouped menu; choosing a page goes there and closes it', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations' })
    const nav = await screen.findByRole('navigation', { name: 'Admin Portal' })
    const more = within(nav).getByRole('button', { name: 'Admin & Settings' })
    await userEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')

    const menu = document.getElementById(more.getAttribute('aria-controls')!)!
    // Reports, Quality, Academy operations and Forms; then Approvals, Integrations, Audit log and System settings.
    expect(within(menu).getAllByRole('link')).toHaveLength(8)
    expect(within(menu).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Reports & quality', 'System'])
    await userEvent.click(within(menu).getByRole('link', { name: /^Quality & supervision/ }))
    expect(await screen.findByRole('heading', { level: 1, name: /Quality & supervision/ })).toBeInTheDocument()
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveAttribute('aria-current', 'true')
  })

  it('works from the keyboard: ArrowDown enters, arrows move and wrap, Escape returns', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories' })
    const nav = await screen.findByRole('navigation', { name: 'Admin Portal' })
    const people = within(nav).getByRole('button', { name: 'People & Organization' })
    people.focus()
    await userEvent.keyboard('{ArrowDown}')
    // People & Organization is grouped by subject: accounts first (PD-21),
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Accounts'))
    for (const name of [
      'Users', // the read-only directory beside the account actions,
      'Team', // and the staff profiles,
      'Teachers', // PD-10, then the teachers' pages: files,
      'Teacher credentials review',
      'Attendance & complaints', // PD-52
      'Grants & testimonials',
      'Parents', // PD-17: the families,
      'Students', // PD-60: and their children,
      'Organization', // PD-8: and the structure, then the menu wraps.
      'Accounts',
    ]) {
      await userEvent.keyboard('{ArrowDown}')
      expect(document.activeElement).toHaveAccessibleName(name)
    }
    await userEvent.keyboard('{Escape}')
    expect(people).toHaveAttribute('aria-expanded', 'false')
    expect(people).toHaveFocus()
  })

  it('closes an open menu on a click elsewhere', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories' })
    const nav = await screen.findByRole('navigation', { name: 'Admin Portal' })
    const more = within(nav).getByRole('button', { name: 'Admin & Settings' })
    await userEvent.click(more)
    await userEvent.click(screen.getByRole('heading', { level: 1 }))
    expect(more).toHaveAttribute('aria-expanded', 'false')
  })

  it('gives each operator role only its own destinations, and links a one-page destination directly', async () => {
    const cases: [StaffRole, string[], string[], string[]][] = [
      // role, destinations, direct links, menus
      // Conversations is a direct link to /chat (the legacy Inbox is retired).
      // A destination with one page is that page's link; with several it is a menu.
      // A manager has the Dashboard and Tasks (a menu), People (Organization and
      // Accounts), and Calls with Stories; Escalations is a tab of Tasks.
      ['manager', ['conversations', 'dashboard', 'people', 'communication'], ['Conversations'], ['Dashboard', 'People & Organization', 'Communication']],
      ['admin', ['conversations', 'dashboard', 'people', 'communication'], ['Conversations', 'Tasks', 'Accounts'], ['Communication']],
      ['coverage', ['conversations', 'dashboard', 'people', 'communication'], ['Conversations', 'Tasks', 'Accounts'], ['Communication']],
      // PD-21: Accounts is every role's; a department has Tasks and Accounts, one page each.
      ['finance', ['dashboard', 'people'], ['Tasks', 'Accounts'], []],
    ]
    for (const [role, keys, links, menus] of cases) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(<AppRoutes />, { staff: staff(role), route: '/' })
      const nav = await screen.findByRole('navigation', { name: 'Jawwid Operations' })
      expect([...nav.querySelectorAll('[data-destination]')].map((el) => el.getAttribute('data-destination')), role).toEqual(keys)
      expect(within(nav).getAllByRole('link').map((l) => l.textContent), role).toEqual(links)
      // By accessible name: a long place name may be shortened on screen (People & Organization reads "People").
      expect(within(nav).queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent), role).toEqual(menus)
      unmount()
    }
  })

  it('is folded to its icons by default; the toggle opens it and the choice is remembered', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    const { unmount } = renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories' })
    const sidebar = await waitFor(() => document.getElementById('app-sidebar')!)
    expect(sidebar).toHaveAttribute('data-rail', 'collapsed')
    // Folded, every place keeps its name for assistive technology.
    const nav = within(sidebar).getByRole('navigation', { name: 'Admin Portal' })
    expect(within(nav).getByRole('button', { name: 'Finance' })).toBeInTheDocument()

    // Folded, the head shows the mark (the book); opened, the full wordmark.
    expect(sidebar.querySelector('.side__brand .brand-mark')).not.toBeNull()
    expect(sidebar.querySelector('.side__brand .brand-logo')).toBeNull()

    await userEvent.click(within(sidebar).getByRole('button', { name: 'Expand sidebar' }))
    expect(sidebar).toHaveAttribute('data-rail', 'expanded')
    expect(sidebar.querySelector('.side__brand .brand-mark')).toBeNull()
    expect(sidebar.querySelector('.side__brand .brand-logo')).not.toBeNull()
    expect(sidebar.closest('.shell')).toHaveClass('shell--rail-open')
    expect(localStorage.getItem('jawwid.sidebar.expanded')).toBe('1')
    unmount()

    // A new visit opens as it was left, and folding again is remembered too.
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories' })
    const again = await waitFor(() => document.getElementById('app-sidebar')!)
    expect(again).toHaveAttribute('data-rail', 'expanded')
    await userEvent.click(within(again).getByRole('button', { name: 'Collapse sidebar' }))
    expect(again).toHaveAttribute('data-rail', 'collapsed')
    expect(localStorage.getItem('jawwid.sidebar.expanded')).toBe('0')
  })

  it('marks the page\'s own entry on a teachers page the super admin reaches under its operator name', async () => {
    localStorage.setItem('jawwid.sidebar.expanded', '1')
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/teachers/files' })
    const nav = await screen.findByRole('navigation', { name: 'Admin Portal' })
    // People is the place; under it, Teachers (which links to /admin/teachers) is the page.
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'People & Organization' })).toHaveAttribute('aria-current', 'true'))
    const sub = within(nav).getByRole('list', { name: 'People & Organization' })
    expect(within(sub).getByRole('link', { name: 'Teachers' })).toHaveAttribute('aria-current', 'page')
    expect(within(sub).getAllByRole('link').filter((l) => l.getAttribute('aria-current'))).toHaveLength(1)
  })

  it('names a folded icon in a tooltip on hover', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories' })
    const nav = await screen.findByRole('navigation', { name: 'Admin Portal' })
    await userEvent.hover(within(nav).getByRole('button', { name: 'Finance' }))
    expect(document.querySelector('.side__tip')).toHaveTextContent('Finance')
    await userEvent.unhover(within(nav).getByRole('button', { name: 'Finance' }))
    await userEvent.hover(document.querySelector('.shell__content')!)
    expect(document.querySelector('.side__tip')).toBeNull()
  })
})

describe('The retired Inbox', () => {
  // The legacy Inbox and everything it read (/inbox, /inbox/away-summary,
  // /inbox/shift-banner, /me/duty, /config, /staff, /families/:id) answer 404
  // for every persona: conversations live in Chat (/chat).
  it('no role can open it, and no role is shown a link to /inbox (menus opened); operators\' Conversations goes to /chat', async () => {
    for (const role of [...OPERATOR_ROLES, 'super_admin'] as StaffRole[]) {
      expect(visibleAreas(role), role).not.toContain('inbox')
    }
    for (const role of ['manager', 'admin', 'coverage', 'finance'] as StaffRole[]) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(<AppRoutes />, { staff: staff(role), route: '/' })
      const nav = await screen.findByRole('navigation', { name: 'Jawwid Operations' })
      for (const b of within(nav).queryAllByRole('button')) await userEvent.click(b)
      const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
      expect(hrefs.filter((h) => h?.startsWith('/inbox')), role).toEqual([])
      if (role !== 'finance') {
        expect(within(nav).getByRole('link', { name: 'Conversations' }), role).toHaveAttribute('href', '/chat')
      }
      unmount()
    }
  })

  it('is not a route: /inbox and /inbox/:familyId fall to the unknown-path handling, like any other', async () => {
    for (const route of ['/inbox', '/inbox/fam_1']) {
      for (const [role, home] of [['admin', '/chat'], ['manager', '/chat']] as const) {
        vi.stubGlobal('fetch', routeFetch({}))
        const { unmount } = renderWithProviders(
          <>
            <AppRoutes />
            <Where />
          </>,
          { staff: staff(role), route },
        )
        await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(home))
        unmount()
      }
    }
  })

  it('the shell no longer asks for duty, shift banners, config or staff', async () => {
    for (const role of ['manager', 'admin', 'coverage'] as StaffRole[]) {
      const fetchMock = routeFetch({})
      vi.stubGlobal('fetch', fetchMock)
      const { unmount } = renderWithProviders(<AppRoutes />, { staff: staff(role), route: '/tasks' })
      await screen.findByRole('navigation', { name: 'Jawwid Operations' })
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      const paths = fetchMock.mock.calls.map(([url]) => String(url).replace(/^.*\/api\/v1/, '').split('?')[0])
      expect(paths.filter((p) => /^\/(inbox|me\/duty|config|staff)(\/|$)/.test(p!)), role).toEqual([])
      unmount()
    }
  })

  it("is no longer where the Dashboard's cases send the manager", async () => {
    vi.stubGlobal('fetch', routeFetch(DASHBOARD_ROUTES))
    renderWithProviders(<AppRoutes />, { staff: dashboardManager, route: '/dashboard' })
    // PD-44: an escalation is counted and opens the Cases page, never the retired Inbox.
    expect(await screen.findByRole('link', { name: /Open cases in the department/ })).toHaveAttribute('href', '/cases?tab=department')
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href') ?? '')
    expect(hrefs.filter((h) => h.startsWith('/inbox'))).toEqual([])
  })
})

describe('The drawer, below desktop width', () => {
  it('lists every destination open, in Arabic and right to left', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations', locale: 'ar' })
    const nav = await screen.findByRole('navigation', { name: 'بوابة الإدارة' })
    expect(document.documentElement.dir).toBe('rtl')
    const conversations = within(nav).getByRole('group', { name: 'المحادثات' })
    expect(within(conversations).getByRole('link', { name: 'كل المحادثات' })).toHaveAttribute('aria-current', 'page')
    expect(within(conversations).getByRole('link', { name: 'الدردشة' })).toHaveAttribute('href', '/chat')
    expect(within(nav).getByRole('group', { name: 'الأشخاص والهيكل التنظيمي' })).toBeInTheDocument()
    const dashboard = within(nav).getByRole('group', { name: 'لوحة المتابعة' })
    expect(within(dashboard).getByRole('link', { name: 'لوحة المتابعة' })).toBeInTheDocument()
    // A destination with one page is that page: a direct link, not a menu.
    expect(within(nav).getByRole('link', { name: 'المواد التعليمية' })).toHaveAttribute('href', '/materials')
    expect(within(nav).getByRole('link', { name: 'الشهادات' })).toHaveAttribute('href', '/certificates')
    expect(within(nav).queryByRole('link', { name: 'التصعيدات' })).not.toBeInTheDocument()
    const people = within(nav).getByRole('group', { name: 'الأشخاص والهيكل التنظيمي' })
    const sales = within(nav).getByRole('group', { name: 'المبيعات' })
    expect(within(sales).getByRole('link', { name: 'الحصص التجريبية' })).toHaveAttribute('href', '/trials')
    expect(within(sales).getByRole('link', { name: 'الطلاب الجدد' })).toHaveAttribute('href', '/trials/new-students')
    expect(within(people).getByRole('link', { name: 'مراجعة مؤهلات المعلمين' })).toHaveAttribute('href', '/teacher-profiles')
    // PD-52: its own heading under People.
    expect(within(people).getByRole('link', { name: 'الحضور والتأخير والأعذار والشكاوى' })).toHaveAttribute('href', '/admin/teacher-attendance')
    expect(within(people).getByRole('link', { name: 'المنح والشهادات الطيبة' })).toHaveAttribute('href', '/admin/teacher-grants')
    expect(within(nav).getAllByRole('link')).toHaveLength(39)
  })

  it('opens from the menu button and closes with Escape, giving focus back', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations' })
    expect(document.documentElement.dir).toBe('ltr')
    const open = await screen.findByRole('button', { name: 'Open navigation' })
    await userEvent.click(open)
    expect(open).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    expect(open).toHaveAttribute('aria-expanded', 'false')
    expect(open).toHaveFocus()
  })
})

describe('Conversation tools live in the conversation workspace', () => {
  const conversation = (id: string, type: string, name: string) => ({
    id, type, state: 'open', title: null, familyId: 'f', familyName: name, liveMembers: 2,
    lastActivityAt: new Date().toISOString(), createdAt: new Date().toISOString(), archivedAt: null,
  })
  const CONVERSATIONS = {
    truncated: false,
    conversations: [
      conversation('c1', 'direct', 'Direct one'),
      conversation('c2', 'direct', 'Direct two'),
      conversation('c3', 'student_group', 'Student group one'),
      conversation('c4', 'class_group', 'Class group one'),
      conversation('c5', 'official', 'Announcements'),
    ],
  }
  const names = () => [...document.querySelectorAll('.conv-row__name')].map((n) => n.textContent)

  it('offers All, Direct, Groups and Official in the inbox, and no unread or favourites view', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(
      <>
        <AppRoutes />
        <Where />
      </>,
      { staff: superAdmin, route: '/admin/conversations' },
    )
    await screen.findByText('Direct one')
    const list = document.getElementById('conversation-list')!
    const views = within(list).getByRole('group', { name: 'Conversation type' })
    expect(within(views).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All5', 'Direct2', 'Groups2', 'Official1',
    ])
    await userEvent.click(within(views).getByRole('button', { name: /Groups/ }))
    expect(names()).toEqual(['Student group one', 'Class group one'])
    expect(screen.getByTestId('where')).toHaveTextContent('type=groups')
    // Neither exists in the admin API, so neither is offered.
    expect(screen.queryByRole('button', { name: /unread|favou?rite/i })).not.toBeInTheDocument()
    // And the navigation carries none of these filters.
    expect(within(screen.getByRole('navigation')).queryByRole('button', { name: /Groups/ })).not.toBeInTheDocument()
  })

  it('still honours an older link to a single group type', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations?type=student_group' })
    await screen.findByText('Student group one')
    expect(screen.getByRole('button', { name: /Student group/, pressed: true })).toBeInTheDocument()
    expect(names()).toEqual(['Student group one'])
  })
})
