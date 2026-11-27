import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { StaffSummary, StaffWorkload } from './api'
import { TeamPage } from './TeamPage'

/**
 * The Team page, with `fetch` answered at the network boundary. It asks the
 * server for nothing new: the viewer's own profile says what they may list,
 * and the page then reads the team or the directory that answer names. Who
 * may read either is proven server-side (apps/api staff-profiles.spec.ts).
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ZERO: StaffWorkload = {
  assignedFamilies: 0,
  studentsInAssignedFamilies: 0,
  parentContacts: 0,
  teachersOfAssignedStudents: 0,
  openConversations: 0,
  awaitingReply: 0,
  pendingApprovals: 0,
  directReports: 0,
}

function person(over: Partial<StaffSummary> = {}): StaffSummary {
  return {
    staffId: 'admin_a',
    displayName: 'Admin A',
    role: 'admin',
    jobTitle: null,
    avatarUrl: null,
    isActive: true,
    account: { hasLogin: true, status: 'active' },
    lastActivityAt: null,
    profileUpdatedAt: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    reportingManager: { staffId: 'manager_c', displayName: 'Manager C', role: 'manager' },
    responsibilities: [],
    workload: { ...ZERO, assignedFamilies: 2 },
    completeness: { complete: 5, total: 5, missing: [] },
    access: { relation: 'team', canEditProfessional: true, canManageResponsibilities: true, canManageReportingLine: false },
    ...over,
  }
}

const me = (viewer: { team: boolean; organizationOverview: boolean }) => ({ staffId: 'me', viewer })

/** One of the masthead's key numbers, by its label. */
const figure = (label: string) => screen.getByText(label, { selector: '.figure__label' }).closest('.figure') as HTMLElement

let asked: string[]
function serve(routes: Record<string, unknown>) {
  asked = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://x').pathname.replace(/^.*\/staff-profiles/, '/staff-profiles')
      asked.push(path)
      return path in routes ? json(routes[path]) : json({ error: { code: 'unrouted', message: path } }, 404)
    }),
  )
}

beforeEach(() => {
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the Team page', () => {
  it('lists a manager\'s own team, each person linking to their profile', async () => {
    serve({
      '/staff-profiles/me': me({ team: true, organizationOverview: false }),
      '/staff-profiles/team': {
        manager: { staffId: 'manager_c', displayName: 'Manager C', role: 'manager', jobTitle: null, avatarUrl: null },
        members: [person(), person({ staffId: 'admin_x', displayName: 'Admin X' })],
        totals: { ...ZERO, assignedFamilies: 4 },
        distinctTeachers: 3,
        generatedAt: '2026-10-13T10:00:00.000Z',
      },
    })
    renderWithProviders(<TeamPage />, { staff: makeStaff({ id: 'manager_c', name: 'Manager C', role: 'manager' }) })

    expect(await screen.findByRole('heading', { level: 1, name: 'Team' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Admin A' })).toHaveAttribute('href', '/profile/admin_a')
    expect(screen.getByRole('link', { name: 'Admin X' })).toHaveAttribute('href', '/profile/admin_x')
    // The team's sums are the masthead's figures; the distinct teachers are the note under the students.
    expect(within(figure('Families')).getByText('4')).toBeInTheDocument()
    expect(within(figure('Students')).getByText('Teachers: 3')).toBeInTheDocument()
    expect(screen.getByText('2 people')).toBeInTheDocument()
    // One row a person: what they carry, and one way in.
    const row = screen.getByRole('link', { name: 'Admin A' }).closest('tr')!
    expect(within(row).getByText('2')).toBeInTheDocument()
    expect(within(row).getByText('You can edit')).toBeInTheDocument()
    // The whole directory is the super admin's: a manager's page never asks for it.
    expect(asked).not.toContain('/staff-profiles/organization')
  })

  it('lists the whole directory for whoever the server says sees the organization', async () => {
    serve({
      '/staff-profiles/me': me({ team: false, organizationOverview: true }),
      '/staff-profiles/organization': { directory: [person(), person({ staffId: 'manager_c', displayName: 'Manager C', role: 'manager', reportingManager: null })], directoryTruncated: true },
    })
    renderWithProviders(<TeamPage />, { staff: makeStaff({ id: 'owner', name: 'Owner', role: 'super_admin' }) })

    expect(await screen.findByRole('link', { name: 'Manager C' })).toHaveAttribute('href', '/profile/manager_c')
    expect(screen.getByRole('link', { name: 'Admin A' })).toBeInTheDocument()
    expect(screen.getByText('Showing the first 500 staff accounts.')).toBeInTheDocument()
    expect(asked).not.toContain('/staff-profiles/team')
    // The directory is set out under each reporting manager; whoever has no manager comes last.
    const groups = screen.getAllByRole('rowgroup').slice(1)
    expect(groups).toHaveLength(2)
    expect(within(groups[0]!).getByRole('rowheader')).toHaveTextContent('Reports toManager C1')
    expect(within(groups[0]!).getByRole('link', { name: 'Admin A' })).toBeInTheDocument()
    expect(within(groups[1]!).getByRole('rowheader')).toHaveTextContent('No manager1')
    expect(within(groups[1]!).getByRole('link', { name: 'Manager C' })).toBeInTheDocument()
    expect(within(figure('Staff accounts')).getByText('2')).toBeInTheDocument()
    expect(within(figure('No manager')).getByText('1')).toBeInTheDocument()
  })

  it('says plainly when the viewer may list nobody, and asks for no list', async () => {
    serve({ '/staff-profiles/me': me({ team: false, organizationOverview: false }) })
    renderWithProviders(<TeamPage />, { staff: makeStaff({ id: 'admin_a', name: 'Admin A', role: 'admin' }) })

    expect(await screen.findByText(/The team list opens for managers and the super admin/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Admin A' })).not.toBeInTheDocument()
    expect(asked).toEqual(['/staff-profiles/me'])
  })
})
