import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { TeacherFile } from './api'

/**
 * PD-43 teacher history on the Teacher File (GET /teachers/:id/history): the
 * teacher's and their login's lifecycle, newest first, each in words with who
 * and why. Who may read it is the server's (the Teacher File's own rule;
 * apps/api test/integration/pd043-teacher-history-http.spec.ts). Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: Array<[RegExp, string, Handler]>
function on(method: string, pattern: RegExp, handler: Handler) {
  routes.unshift([pattern, method, handler])
}

const file: TeacherFile = {
  access: { canEditPersonal: true, canWriteSupervision: true },
  teacher: { id: 't-1', name: 'Teacher One', isActive: true, leftAt: null },
  personal: { fullName: 'Teacher One', phone: null, email: null, joinedOn: null, updatedAt: null, updatedBy: null },
  assignedStudents: [],
  supervision: { complaints: [], monthlyComments: [], daysOff: [] },
}
const manager = makeStaff({ id: 'm-1', name: 'Teachers Manager', role: 'manager' })
const person = (id: string, name: string) => ({ id, name })

beforeEach(() => {
  routes = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const method = (init.method ?? 'GET').toUpperCase()
      for (const [pattern, m, handler] of routes) {
        if (m === method && pattern.test(url)) return handler(url, init)
      }
      return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
    }),
  )
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/teacher-files\/t-1$/, () => json(file))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Teacher history', () => {
  it('each event in words, newest first, with who and why', async () => {
    on('GET', /\/teachers\/t-1\/history$/, () =>
      json({
        teacherId: 't-1',
        events: [
          { at: '2026-10-28T12:00:00Z', action: 'teacher.reactivated', actor: person('o-1', 'QA Owner'), reason: 'Rejoined', detail: {} },
          { at: '2026-10-27T12:00:00Z', action: 'teacher.offboarded', actor: person('m-1', 'Teachers Manager'), reason: 'Left the academy', detail: {} },
          {
            at: '2026-10-26T12:00:00Z',
            action: 'teacher_supervisor.assigned',
            actor: person('m-1', 'Teachers Manager'),
            reason: 'Balance the load',
            detail: { from: person('s-1', 'Supervisor One'), to: person('s-2', 'Supervisor Two') },
          },
          { at: '2026-10-25T12:00:00Z', action: 'account.activated', actor: null, reason: null, detail: {} },
          { at: '2026-10-24T12:00:00Z', action: 'teacher.created', actor: person('m-1', 'Teachers Manager'), reason: 'teacher added', detail: {} },
        ],
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    const card = await screen.findByRole('region', { name: 'Sign-in and status history' })
    const items = await within(card).findAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[0]).toHaveTextContent('Reactivated')
    expect(items[0]).toHaveTextContent('QA Owner')
    expect(items[0]).toHaveTextContent('Rejoined')
    expect(items[1]).toHaveTextContent('Offboarded')
    expect(items[2]).toHaveTextContent('Supervisor changed: Supervisor One → Supervisor Two')
    expect(items[3]).toHaveTextContent('Signed in for the first time')
    expect(items[3]).toHaveTextContent('By the teacher')
    expect(items[4]).toHaveTextContent('Added')
  })

  it('nothing recorded: said, not left blank', async () => {
    on('GET', /\/teachers\/t-1\/history$/, () => json({ teacherId: 't-1', events: [] }))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    const card = await screen.findByRole('region', { name: 'Sign-in and status history' })
    expect(await within(card).findByText('Nothing recorded yet.')).toBeInTheDocument()
  })
})
