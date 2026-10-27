import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import type { NeedsActionItem } from '@/core/api/endpoints'
import type { StaffRole } from '@/shared/types/domain'
import { makeStaff, renderWithProviders } from '@/test/utils'

/**
 * The Dashboard's "Activate backup" on an auto-detected absence. The API has
 * no /absences/:id/activate-backup, so the button takes the manager to the
 * Organization page, where backups are activated and covers handed over
 * (PD-8, PD-33). Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ABSENCE: NeedsActionItem = {
  kind: 'auto_detected_absence',
  family_id: null,
  family_name: null,
  staff_id: 'sup-1',
  staff_name: 'Supervisor One',
  absence_id: 'abs-1',
  description: 'Supervisor One has not signed in today',
  at: '2026-10-27T08:00:00Z',
}

const ROUTES: Record<string, unknown> = {
  '/dashboard/header': { unattended_count: 0, open_escalations: 0 },
  '/dashboard/team-now': [],
  '/dashboard/needs-action': [ABSENCE],
  '/org/structure': { departments: [] },
  '/org/learners': { learners: [] },
}

let fetchMock: ReturnType<typeof vi.fn>

function Where() {
  const { pathname } = useLocation()
  return <output data-testid="where">{pathname}</output>
}

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input).replace(/^.*\/api\/v1/, '').split('?')[0]!
    if ((init.method ?? 'GET') === 'GET' && path in ROUTES) return json(ROUTES[path])
    return json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the Dashboard\'s Activate backup', () => {
  for (const [role, organization] of [['manager', '/organization'], ['super_admin', '/admin/teams']] as [StaffRole, string][]) {
    it(`takes the ${role} to the Organization page (${organization}) and posts nothing`, async () => {
      renderWithProviders(
        <>
          <AppRoutes />
          <Where />
        </>,
        { staff: makeStaff({ id: `staff_${role}`, role }), route: '/dashboard' },
      )
      await userEvent.click(await screen.findByRole('button', { name: 'Activate backup' }))
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(organization))
      expect(await screen.findByRole('heading', { level: 1, name: 'Organization' })).toBeInTheDocument()
      expect(fetchMock.mock.calls.some(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') !== 'GET')).toBe(false)
    })
  }
})
