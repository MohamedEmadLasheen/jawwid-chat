import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { NewStudentDto, TrialDto } from './api'

/**
 * PD-11 T4's Admin Web pages through the real routes and API client, with
 * `fetch` answered at the network boundary: who is offered which control, the
 * exact request each sends, and that "subscribed" never reads as "confirmed".
 * What the server allows is proven in lessons-trials.spec.ts. Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response
let routes: Array<[string, RegExp, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([method, pattern, handler])
const sent = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls
    .filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
    .map(([, i]) => JSON.parse(String((i as RequestInit).body ?? '{}')) as Record<string, unknown>)

const trial = (id: string, over: Partial<TrialDto> = {}): TrialDto => ({
  id,
  prospect: { id: 'p-1', displayName: 'Prospect Alpha', level: 'beginner' },
  teacher: { id: 't-1', name: 'Teacher One' },
  startsAt: '2026-10-17T15:00:00Z',
  endsAt: '2026-10-17T15:30:00Z',
  durationMinutes: 30,
  attendance: 'attended',
  report: { covered: 'letters 1-5', rating: 4, note: null },
  conversion: 'pending',
  ...over,
})

const TRIALS: TrialDto[] = [
  trial('tr-pending'),
  trial('tr-awaiting', { prospect: { id: 'p-2', displayName: 'Prospect Beta', level: null }, attendance: 'awaiting', report: null, conversion: null }),
  trial('tr-sub', {
    prospect: { id: 'p-3', displayName: 'Prospect Gamma', level: null },
    conversion: 'awaiting_core',
    conversionDetail: { reason: null, note: null, recordedAt: '2026-10-18T10:00:00Z', confirmedAt: null },
  }),
]

const SLOTS = ['2026-11-02T15:00:00Z', '2026-11-02T15:30:00Z']

function access(a: { lessonManager?: boolean; sales?: boolean; operations?: boolean }) {
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: false, operations: false, ...a }))
}

const staff = makeStaff({ role: 'admin' })

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [m, pattern, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/trials(\?.*)?$/, () => json({ trials: TRIALS }))
  on('GET', /\/trials\/prospects$/, () =>
    json({ prospects: [{ id: 'p-9', displayName: 'Prospect Delta', level: null, note: null, learnerId: null, createdAt: '2026-10-19T09:00:00Z' }] }),
  )
  on('GET', /\/trials\/teachers$/, () => json({ teachers: [{ id: 't-1', name: 'Teacher One' }, { id: 't-2', name: 'Teacher Two' }] }))
  on('GET', /\/trials\/slots\?/, () => json({ teacherId: 't-2', durationMinutes: 30, slots: SLOTS }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Trial lessons, as Sales', () => {
  it('lists trials with both facts apart, and "subscribed" reads as awaiting Core', async () => {
    access({ sales: true })
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const row = (await screen.findByText('Prospect Gamma')).closest('tr')!
    expect(within(row).getByText('Attended')).toBeInTheDocument()
    expect(within(row).getByText('Subscribed — awaiting Core')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record a prospect' })).toBeInTheDocument()
    // Sales sees both of the area's tabs.
    const tabs = screen.getByRole('navigation', { name: 'Trials' })
    expect(within(tabs).getAllByRole('link').map((l) => l.textContent)).toEqual(['Trial lessons', 'New students'])
  })

  it('records "did not subscribe" with its reason', async () => {
    access({ sales: true })
    on('POST', /\/trials\/tr-pending\/outcome$/, () => json(trial('tr-pending', { conversion: 'not_subscribed' }), 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const row = (await screen.findByText('Prospect Alpha')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Record decision' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText('Result'), 'not_subscribed')
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason (if not subscribed)'), 'schedule')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/trials\/tr-pending\/outcome$/)).toEqual([{ result: 'not_subscribed', reason: 'schedule' }]))
  })

  it('books only a time the server offered', async () => {
    access({ sales: true })
    on('POST', /\/trials$/, () => json(trial('tr-new', { attendance: 'upcoming', conversion: null }), 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    await userEvent.click(await screen.findByRole('button', { name: 'Book a trial' }))
    const dialog = await screen.findByRole('dialog')
    const book = within(dialog).getByRole('button', { name: 'Book' })
    expect(book).toBeDisabled()
    await waitFor(() => expect(within(within(dialog).getByLabelText('Prospect')).getAllByRole('option')).toHaveLength(2))
    await userEvent.selectOptions(within(dialog).getByLabelText('Prospect'), 'p-9')
    await waitFor(() => expect(within(within(dialog).getByLabelText('Teacher')).getAllByRole('option')).toHaveLength(3))
    await userEvent.selectOptions(within(dialog).getByLabelText('Teacher'), 't-2')
    const time = await within(dialog).findByLabelText('Free time')
    expect(within(time).getAllByRole('option')).toHaveLength(SLOTS.length + 1)
    await userEvent.selectOptions(time, SLOTS[1]!)
    await userEvent.click(book)
    await waitFor(() =>
      expect(sent('POST', /\/trials$/)).toEqual([{ prospectId: 'p-9', teacherId: 't-2', startsAt: SLOTS[1], durationMinutes: 30 }]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('The trial group', () => {
  it('opens the teacher\'s trial group in Chat', async () => {
    access({ sales: true })
    on('POST', /\/trials\/teachers\/t-1\/group$/, () => json({ conversationId: 'conv-trial-1' }, 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const row = (await screen.findByText('Prospect Alpha')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Trial group' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => /\/conversations\/conv-trial-1/.test(String(u)))).toBe(true))
  })
})

describe('Trial lessons, as the Teachers department', () => {
  it('records an absence the teacher did not; never the subscription decision or a prospect', async () => {
    access({ lessonManager: true })
    on('POST', /\/trials\/tr-awaiting\/attendance$/, () => json(trial('tr-awaiting', { attendance: 'no_show' }), 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const row = (await screen.findByText('Prospect Beta')).closest('tr')!
    expect(screen.queryByRole('button', { name: 'Record a prospect' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Prospect absent' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/trials\/tr-awaiting\/attendance$/)).toEqual([{ attended: false }]))
  })
})

describe('New students, as Operations', () => {
  it('shows who is ready to set up, apart from what Core has not confirmed', async () => {
    access({ operations: true })
    const item = (id: string, name: string, confirmedAt: string | null): NewStudentDto => ({
      lessonId: id, prospect: { id: `p-${id}`, displayName: name }, learnerId: confirmedAt ? `k-${id}` : null,
      teacher: { id: 't-1', name: 'Teacher One' }, trialAt: '2026-10-10T15:00:00Z', recordedAt: '2026-10-11T10:00:00Z', confirmedAt,
    })
    on('GET', /\/trials\/new-students$/, () =>
      json({ readyForSetup: [item('a', 'Prospect Ready', '2026-10-12T10:00:00Z')], awaitingCore: [item('b', 'Prospect Waiting', null)] }),
    )
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    const ready = await screen.findByRole('region', { name: /Ready to set up/ })
    expect(within(ready).getByText('Prospect Ready')).toBeInTheDocument()
    expect(within(ready).queryByText('Prospect Waiting')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: /Awaiting Core/ })).getByText('Prospect Waiting')).toBeInTheDocument()
    // Operations alone has one page: no tab strip.
    expect(screen.queryByRole('navigation', { name: 'Trials' })).not.toBeInTheDocument()
  })
})
