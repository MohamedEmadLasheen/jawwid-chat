import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { listTime, dayLabel } from './copy'

/**
 * States the audit of 2026-10-13 found misleading: a failed request must read
 * as a failure, never as "all clear", and a link to a conversation outside the
 * loaded list must say so rather than talk about sections.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Routes each API path to a body, or to a status code when the value is a number. */
function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/v1/, '').split('?')[0]!
    if (path in routes) {
      const r = routes[path]
      return typeof r === 'number'
        ? jsonResponse({ error: { code: 'SERVER.ERROR', message: 'server error' } }, r)
        : jsonResponse(r)
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404)
  })
}

const NOW = new Date().toISOString()
const superAdmin = makeStaff({ id: 'owner_o', name: 'Owner O', role: 'super_admin' })
const OVERVIEW = {
  organization: { id: 'org', slug: 'qa', displayName: 'QA Academy' },
  accounts: {},
  staffByRole: { super_admin: 1 },
  teachers: 0,
  families: 0,
  contacts: 0,
  conversationsByType: {},
  messages: 0,
  storiesByState: {},
  generatedAt: NOW,
}

beforeEach(() => {
  localStorage.clear()
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Dashboard: a failed conversations request', () => {
  it('is shown as an error in Needs attention, never as "nothing needs attention"', async () => {
    // 503 is not retried forever: the query client retries 5xx twice, so give it time.
    vi.stubGlobal('fetch', routeFetch({ '/admin/overview': OVERVIEW, '/admin/conversations': 503 }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/dashboard' })

    const attention = await screen.findByRole('region', { name: 'Needs attention' })
    expect(await within(attention).findByRole('alert', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(within(attention).queryByText('Nothing needs attention right now.')).not.toBeInTheDocument()
  }, 10000)
})

describe('Conversations: a link to a conversation that is not loaded', () => {
  it('says the conversation is not in the loaded list, not that a section is missing', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/admin/conversations': {
          truncated: true,
          conversations: [
            {
              id: '11111111-1111-4111-8111-111111111111', type: 'direct', state: 'open', title: null,
              familyId: 'f1', familyName: 'Family One', liveMembers: 2, lastActivityAt: NOW, createdAt: NOW, archivedAt: null,
            },
          ],
        },
      }),
    )
    renderWithProviders(<AppRoutes />, {
      staff: superAdmin,
      route: '/admin/conversations?c=99999999-9999-4999-8999-999999999999',
    })
    expect(await screen.findByText('This conversation isn’t in the loaded list.')).toBeInTheDocument()
    expect(screen.getByText(/200 most recently active/)).toBeInTheDocument()
    expect(screen.queryByText('There is no such section.')).not.toBeInTheDocument()
  })
})

describe('List timestamps', () => {
  const now = new Date(2026, 9, 13, 15, 30)

  it('formats today, yesterday, this week and older dates, per locale', () => {
    expect(listTime(new Date(2026, 9, 13, 9, 5).toISOString(), 'en', now)).toMatch(/09:05/)
    expect(listTime(new Date(2026, 9, 12, 9, 5).toISOString(), 'en', now)).toBe('Yesterday')
    expect(listTime(new Date(2026, 9, 12, 9, 5).toISOString(), 'ar', now)).toBe('أمس')
    expect(listTime(new Date(2026, 9, 9, 9, 5).toISOString(), 'en', now)).toBe('Friday')
    expect(listTime(new Date(2026, 8, 1, 9, 5).toISOString(), 'en', now)).toBe('1 Sept')
    expect(listTime(new Date(2025, 8, 1, 9, 5).toISOString(), 'en', now)).toBe('1 Sept 2025')
    expect(dayLabel(new Date(2026, 9, 13, 1, 0).toISOString(), 'ar', now)).toBe('اليوم')
  })

  it('does not leak one locale’s formatting into the other', () => {
    const iso = new Date(2026, 9, 9, 9, 5).toISOString()
    const en = listTime(iso, 'en', now)
    const ar = listTime(iso, 'ar', now)
    expect(en).toBe('Friday')
    expect(ar).not.toBe(en)
    expect(listTime(iso, 'en', now)).toBe(en)
  })
})
