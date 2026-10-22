import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { Violation } from './api'

/**
 * PD-12 S2 discipline, now the Supervision page's Absences and Lateness
 * sections (PD-24), through the real routes and the real API client,
 * with `fetch` answered at the network boundary. These prove the page's side:
 * the server's step and suggestion are shown, the suggestion is what is sent by
 * default, another choice asks for a reason first, and a suspension over open
 * lessons is confirmed before it is sent again. Who may do what, and what each
 * decision does, is proven server-side (apps/api test/integration/pd012-s2.spec.ts).
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: Array<[RegExp, string, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
function on(method: string, pattern: RegExp, handler: Handler) {
  routes.unshift([pattern, method, handler])
}
const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
const bodyOf = (call: unknown[] | undefined) => {
  if (!call) throw new Error('the request was not sent')
  return JSON.parse(String((call[1] as RequestInit).body))
}

function violation(over: Partial<Violation> = {}): Violation {
  return {
    id: 'v-1',
    kind: 'teacher_no_show',
    teacher: { id: 't-1', name: 'Teacher One' },
    lesson: { id: 'l-1', startsAt: '2026-10-15T08:00:00Z', learnerName: 'Child Alpha', note: 'did not join' },
    occurredAt: '2026-10-15T08:00:00Z',
    month: '2026-10',
    lateMinutes: null,
    note: null,
    recordedBy: null,
    step: 2,
    suggestedDecision: 'deduction_1',
    decision: null,
    decisionNote: null,
    decidedBy: null,
    decidedAt: null,
    suspension: null,
    ...over,
  }
}

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [pattern, m, handler] of routes) {
      if (m === method && pattern.test(url)) return handler(url, init)
    }
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('discipline on the Supervision page', () => {
  it('lists what waits for a decision with the server\'s step and suggestion, and sends the suggestion by default', async () => {
    on('GET', /\/discipline\/violations\?state=open&kind=absences$/, () => json({ violations: [violation()] }))
    on('POST', /\/discipline\/violations\/v-1\/decide$/, () =>
      json({ violation: violation({ decision: 'deduction_1' }), cancelledLessons: 0, notCancelled: [] }),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/discipline' })
    const row = (await screen.findByText('Absent from the lesson')).closest('tr')!
    expect(within(row).getByText('Step 2')).toBeInTheDocument()
    expect(within(row).getByText('Suggested: First deduction')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Decide' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /First deduction/ })).toBeChecked()
    expect(within(dialog).getByText(/deducted in payroll for that month at once/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls('POST', /\/decide$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/decide$/)[0])).toEqual({ decision: 'deduction_1' })
  })

  it('choosing another step or excusing asks for a reason before anything is sent', async () => {
    on('GET', /\/discipline\/violations\?state=open&kind=absences$/, () => json({ violations: [violation()] }))
    on('POST', /\/discipline\/violations\/v-1\/decide$/, () =>
      json({ violation: violation({ decision: 'excused' }), cancelledLessons: 0, notCancelled: [] }),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/discipline' })
    await userEvent.click(await screen.findByRole('button', { name: 'Decide' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: /Excused/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    expect(within(dialog).getByText('Say why.')).toBeInTheDocument()
    expect(calls('POST', /\/decide$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'internet outage, proven')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls('POST', /\/decide$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/decide$/)[0])).toEqual({ decision: 'excused', note: 'internet outage, proven' })
  })

  it('a suspension over open lessons is confirmed, then sent again with the confirmation', async () => {
    on('GET', /\/discipline\/violations\?state=open&kind=absences$/, () =>
      json({ violations: [violation({ step: 4, suggestedDecision: 'temporary_suspension' })] }),
    )
    let first = true
    on('POST', /\/discipline\/violations\/v-1\/decide$/, () => {
      if (first) {
        first = false
        return json({ error: { code: 'COMM.DISCIPLINE_LESSONS_COLLIDE', message: '2 open lessons' } }, 409)
      }
      return json({ violation: violation({ decision: 'temporary_suspension' }), cancelledLessons: 2, notCancelled: [] })
    })
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/discipline' })
    await userEvent.click(await screen.findByRole('button', { name: 'Decide' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    const confirm = await within(dialog).findByRole('checkbox', { name: 'Cancel those lessons' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    expect(calls('POST', /\/decide$/)).toHaveLength(1)
    await userEvent.click(confirm)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls('POST', /\/decide$/)).toHaveLength(2))
    const sent = bodyOf(calls('POST', /\/decide$/)[1])
    expect(sent).toMatchObject({ decision: 'temporary_suspension', cancelCollidingLessons: true })
    expect(sent.startsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('records lateness on a held lesson of the chosen teacher', async () => {
    on('GET', /\/discipline\/violations\?state=open&kind=late$/, () => json({ violations: [] }))
    on('GET', /\/lessons\/roster$/, () => json({ teachers: [{ id: 't-1', name: 'Teacher One', isActive: true, timezone: null }], learners: [] }))
    on('GET', /\/lessons\?/, () =>
      json({
        lessons: [
          { id: 'l-7', learner: { id: 'c-1', name: 'Child Alpha' }, teacher: { id: 't-1', name: 'Teacher One' }, kind: 'regular', makeupFor: null, startsAt: '2026-10-18T16:00:00Z', endsAt: '2026-10-18T16:30:00Z', durationMinutes: 30, phase: 'closed', outcome: 'held', outcomeNote: null },
          { id: 'l-8', learner: { id: 'c-1', name: 'Child Alpha' }, teacher: { id: 't-1', name: 'Teacher One' }, kind: 'regular', makeupFor: null, startsAt: '2026-10-19T16:00:00Z', endsAt: '2026-10-19T16:30:00Z', durationMinutes: 30, phase: 'closed', outcome: 'student_no_show', outcomeNote: null },
        ],
      }),
    )
    on('POST', /\/lessons\/l-7\/lateness$/, () => json({ violation: violation({ kind: 'late', lateMinutes: 15 }) }, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=lateness' })
    await userEvent.click(await screen.findByRole('button', { name: 'Record lateness' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Teacher' }), 't-1')
    const lessonSelect = await within(dialog).findByRole('combobox', { name: 'Lesson' })
    // Only held lessons are offered.
    expect(within(lessonSelect).getAllByRole('option')).toHaveLength(2)
    await userEvent.selectOptions(lessonSelect, 'l-7')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Minutes late' }), '15')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls('POST', /\/lateness$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/lateness$/)[0])).toEqual({ minutes: 15 })
  })
})
