import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { chooseOption } from '@/test/select'
import type { TeacherRecordsAccess, TeacherSummary, Testimonial } from './api'

/**
 * PD-52 PR-4, the Grants & Testimonials page (page B), through the real routes
 * and API client with `fetch` answered at the network boundary: the parents'
 * praise and the staff's testimonials in one list, recording one (with its
 * student), correcting one, replying to praise, and one teacher's strip. What
 * the server does with it is proven in apps/api
 * test/integration/pd052-teacher-records.spec.ts. Synthetic people only.
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

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })
const ALL: TeacherRecordsAccess = {
  basis: 'teachers',
  attendance: { view: true, record: true, decide: true },
  grants: { view: true, record: true },
  leaveBalance: true,
  amounts: false,
  opensFile: true,
}

function testimonial(over: Partial<Testimonial> = {}): Testimonial {
  return {
    id: 'ts-1',
    origin: 'staff',
    teacher: { id: 't-1', name: 'Teacher One' },
    body: 'The parents thanked her on the phone.',
    createdAt: '2026-10-30T09:00:00Z',
    source: 'parent_call',
    child: { id: 'k-1', name: 'Child One' },
    familyId: 'f-1',
    prospect: null,
    author: { id: 's-1', name: 'Supervisor One' },
    parent: null,
    status: null,
    response: null,
    voided: null,
    ...over,
  }
}
const praise = testimonial({
  id: 'pf-1',
  origin: 'parent',
  body: 'She is wonderful with my son.',
  source: 'parent_app',
  author: null,
  parent: { id: 'p-1', name: 'Parent Alpha' },
  status: 'received',
})

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
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: true, sales: false, operations: false, calendar: true, supervisionPage: true }))
  on('GET', /\/teacher-records\/access$/, () => json(ALL))
  on('GET', /\/teacher-supervision\/directory$/, () =>
    json({
      basis: 'teachers',
      access: { canWriteSupervision: true, canViewFinance: false },
      teachers: [{ id: 't-1', name: 'Teacher One', isActive: true, away: null }],
      supervisors: [],
    }),
  )
  on('GET', /\/teacher-files\/rewards/, () =>
    json({ canViewAmounts: false, rewards: [{ id: 'r-1', teacher: { id: 't-1', name: 'Teacher One' }, reason: 'Covered three extra lessons', recordedAt: '2026-10-20T09:00:00Z', recordedBy: { id: 's-1', name: 'Supervisor One' } }] }),
  )
  on('GET', /\/teacher-records\/testimonials/, () => json({ canRecord: true, testimonials: [testimonial(), praise] }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('PD-52 page B: grants', () => {
  it('lists the grants (no amount for a supervisor) and records one when allowed', async () => {
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-grants' })
    expect(await screen.findByRole('heading', { name: 'Grants & testimonials' })).toBeInTheDocument()
    expect(await screen.findByText('Covered three extra lessons')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record a reward' })).toBeInTheDocument()
  })

  it('offers no Record button without grants.record, and says so without grants.view', async () => {
    on('GET', /\/teacher-records\/access$/, () => json({ ...ALL, grants: { view: true, record: false } }))
    const first = renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-grants' })
    expect(await screen.findByText('Covered three extra lessons')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record a reward' })).not.toBeInTheDocument()
    first.unmount()
    on('GET', /\/teacher-records\/access$/, () => json({ ...ALL, grants: { view: false, record: false } }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-grants' })
    expect(await screen.findByText('This page is not part of your work.')).toBeInTheDocument()
  })
})

describe('PD-52 page B: testimonials', () => {
  it('shows the parents\' praise beside the staff\'s testimonials, and filters by where they came from', async () => {
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-grants?section=testimonials' })
    const staff = (await screen.findByText('The parents thanked her on the phone.')).closest('li')!
    expect(within(staff).getByText('Recorded by staff')).toBeInTheDocument()
    expect(within(staff).getByText('Parent’s call')).toBeInTheDocument()
    expect(within(staff).getByText('About Child One')).toBeInTheDocument()
    expect(within(staff).getByText('Recorded by Supervisor One')).toBeInTheDocument()
    const parent = screen.getByText('She is wonderful with my son.').closest('li')!
    expect(within(parent).getByText('Parent (app)')).toBeInTheDocument()
    expect(within(parent).getByText('From Parent Alpha')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'From parents' }))
    expect(screen.queryByText('The parents thanked her on the phone.')).not.toBeInTheDocument()
    expect(screen.getByText('She is wonderful with my son.')).toBeInTheDocument()
  })

  it('records a testimonial with its source and, chosen from the teacher\'s students, the child it is about', async () => {
    on('GET', /\/teacher-records\/teachers\/t-1\/students$/, () => json({ students: [{ id: 'k-1', name: 'Child One', familyId: 'f-1' }] }))
    on('POST', /\/teachers\/t-1\/testimonials$/, () => json({ id: 'ts-9', kind: 'testimonial', createdAt: '2026-11-02T09:00:00Z' }, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-grants?section=testimonials' })
    await userEvent.click(await screen.findByRole('button', { name: 'Record a testimonial' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a testimonial' }))
    expect(calls('POST', /\/testimonials$/)).toHaveLength(0)
    expect(within(dialog).getAllByText('Required.')).toHaveLength(3)

    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Teacher' }), 't-1')
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'How it reached us' }), 'parent_message')
    await waitFor(() => expect(calls('GET', /\/teachers\/t-1\/students$/).length).toBeGreaterThan(0))
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Student (optional)' }), 'learner:k-1')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'What was said' }), 'Very patient with him.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a testimonial' }))
    await waitFor(() => expect(calls('POST', /\/teachers\/t-1\/testimonials$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/teachers\/t-1\/testimonials$/)[0])).toEqual({ body: 'Very patient with him.', source: 'parent_message', learnerId: 'k-1' })
  })

  it('corrects a staff testimonial with a reason (hidden, never deleted), and shows corrected ones on request', async () => {
    on('POST', /\/teacher-records\/entries\/ts-1\/void$/, () => json({ id: 'v-1', voids: 'ts-1' }, 201))
    on('GET', /\/teacher-records\/testimonials\?voided=include$/, () =>
      json({ canRecord: true, testimonials: [testimonial({ voided: { id: 'v-1', body: 'Wrong teacher.', createdAt: '2026-11-02T09:00:00Z', author: null } })] }),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-grants?section=testimonials' })
    const row = (await screen.findByText('The parents thanked her on the phone.')).closest('li')!
    // Praise is the parent's: it is answered, not corrected.
    const parent = screen.getByText('She is wonderful with my son.').closest('li')!
    expect(within(parent).queryByRole('button', { name: 'Correct' })).not.toBeInTheDocument()

    await userEvent.click(within(row).getByRole('button', { name: 'Correct' }))
    const dialog = await screen.findByRole('dialog', { name: 'Correct an entry made by mistake' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Correct' }))
    expect(calls('POST', /\/void$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Wrong teacher.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Correct' }))
    await waitFor(() => expect(calls('POST', /\/entries\/ts-1\/void$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/entries\/ts-1\/void$/)[0])).toEqual({ reason: 'Wrong teacher.' })

    await userEvent.click(screen.getByRole('checkbox', { name: 'Show corrected ones' }))
    expect(await screen.findByText('Corrected: Wrong teacher.')).toBeInTheDocument()
  })

  it('takes the parent\'s praise and replies to the parent', async () => {
    on('POST', /\/parent-feedback\/pf-1\/take$/, () => json({}))
    on('POST', /\/parent-feedback\/pf-1\/reply$/, () => json({}))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-grants?section=testimonials' })
    const row = (await screen.findByText('She is wonderful with my son.')).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'I’m on it' }))
    await waitFor(() => expect(calls('POST', /\/pf-1\/take$/)).toHaveLength(1))
    await userEvent.click(within(row).getByRole('button', { name: 'Reply to the parent' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reply to Parent Alpha' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Your reply' }), 'Thank you!')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(calls('POST', /\/pf-1\/reply$/)).toHaveLength(1))
  })

  it('without grants.record: no Record, Correct, Take or Reply', async () => {
    on('GET', /\/teacher-records\/access$/, () => json({ ...ALL, grants: { view: true, record: false } }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-grants?section=testimonials' })
    await screen.findByText('She is wonderful with my son.')
    for (const name of ['Record a testimonial', 'Correct', 'I’m on it', 'Reply to the parent']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })
})

describe('PD-52: one teacher\'s strip', () => {
  const summary: TeacherSummary = {
    teacher: { id: 't-1', name: 'Teacher One', isActive: true },
    away: null,
    ladder: { month: '2026-11', counted: 2, nextStep: 'deduction_1' },
    openComplaints: 1,
    year: '2026',
    grants: 3,
    testimonials: 4,
    opensFile: true,
  }

  it('shows the teacher\'s counts and the File link when a teacher is chosen, on both pages', async () => {
    on('GET', /\/teacher-records\/teachers\/t-1\/summary$/, () => json(summary))
    on('GET', /\/teacher-records\/testimonials\?teacher=t-1$/, () => json({ canRecord: true, testimonials: [] }))
    const b = renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-grants?section=testimonials&teacher=t-1' })
    const strip = await screen.findByRole('region', { name: 'Teacher One' })
    expect(within(strip).getByText('This month: 2 counted, next step First deduction')).toBeInTheDocument()
    expect(within(strip).getByText('1 open complaints')).toBeInTheDocument()
    expect(within(strip).getByText('3 grants in 2026')).toBeInTheDocument()
    expect(within(strip).getByText('4 testimonials in 2026')).toBeInTheDocument()
    expect(within(strip).getByRole('link', { name: 'Open the Teacher File' })).toHaveAttribute('href', '/teachers/files/t-1')
    b.unmount()

    on('GET', /\/teacher-leave-overview$/, () => json({ year: 2026, teachers: [] }))
    on('GET', /\/teacher-leave-requests\?state=requested$/, () => json({ requests: [] }))
    on('GET', /\/teacher-records\/teachers\/t-1\/summary$/, () => json({ ...summary, opensFile: false }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-attendance?teacher=t-1' })
    const a = await screen.findByRole('region', { name: 'Teacher One' })
    expect(within(a).queryByRole('link', { name: 'Open the Teacher File' })).not.toBeInTheDocument()
  })

  it('leaves out the sections the server returns null (a grants-only reader: no ladder, leave or complaints)', async () => {
    on('GET', /\/teacher-records\/teachers\/t-1\/summary$/, () => json({ ...summary, ladder: null, away: null, openComplaints: null }))
    on('GET', /\/teacher-records\/testimonials\?teacher=t-1$/, () => json({ canRecord: true, testimonials: [] }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-grants?section=testimonials&teacher=t-1' })
    const strip = await screen.findByRole('region', { name: 'Teacher One' })
    expect(within(strip).getByText('4 testimonials in 2026')).toBeInTheDocument()
    expect(within(strip).queryByText(/This month/)).not.toBeInTheDocument()
    expect(within(strip).queryByText(/open complaints/)).not.toBeInTheDocument()
    expect(within(strip).queryByText('Available')).not.toBeInTheDocument()
  })

  it('reads in Arabic', async () => {
    on('GET', /\/teacher-records\/teachers\/t-1\/summary$/, () => json(summary))
    on('GET', /\/teacher-records\/testimonials\?teacher=t-1$/, () => json({ canRecord: true, testimonials: [praise] }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-grants?section=testimonials&teacher=t-1', locale: 'ar' })
    expect(await screen.findByRole('heading', { name: 'المنح والشهادات الطيبة' })).toBeInTheDocument()
    expect(await screen.findByText('المنح في 2026: ٣')).toBeInTheDocument()
    expect(screen.getByText('ولي الأمر (التطبيق)')).toBeInTheDocument()
  })
})
