import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { EvaluationsSection, type TeacherRecords } from './Evaluations'
import { chooseOption } from '@/test/select'

/**
 * PD-35: evaluations and improvement plans on the Teacher File, with `fetch`
 * answered at the network boundary. Who may write and to which teachers is the
 * server's (teacher-supervisor-pd035.spec.ts). Synthetic people only.
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

const RECORDS: TeacherRecords = {
  canWrite: true,
  criteria: [
    { id: 'c-1', labelEn: 'Punctuality', labelAr: 'الالتزام بالمواعيد', position: 1, isActive: true },
    { id: 'c-2', labelEn: 'Report quality', labelAr: 'جودة التقارير', position: 2, isActive: true },
  ],
  evaluations: [
    {
      id: 'e-1', periodFrom: '2026-10-01', periodTo: '2026-10-26',
      scores: [{ criterionId: 'c-1', labelEn: 'Punctuality', labelAr: 'الالتزام بالمواعيد', score: 4 }],
      notes: 'internal only', recommendations: 'Send reports the same day', author: { id: 's-1', name: 'Tsup One' },
      createdAt: '2026-10-26T09:00:00Z', supersedesId: null, superseded: false, sharedAt: null,
    },
  ],
  plans: [],
}

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
  on('GET', /\/teachers\/t-1\/evaluations$/, () => json(RECORDS))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('evaluations on the Teacher File', () => {
  it('shows an evaluation, unshared until a supervisor shares it', async () => {
    on('POST', /\/evaluations\/e-1\/share$/, () => json({ ...RECORDS, evaluations: [{ ...RECORDS.evaluations[0]!, sharedAt: '2026-10-26T10:00:00Z' }] }))
    renderWithProviders(<EvaluationsSection teacherId="t-1" canWrite canEditCriteria={false} />, { staff: makeStaff({ role: 'admin' }) })
    expect(await screen.findByText('Send reports the same day')).toBeInTheDocument()
    expect(screen.getByText('4/5')).toBeInTheDocument()
    expect(screen.getByText('Not shared')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Share with teacher' }))
    await waitFor(() => expect(sent('POST', /\/evaluations\/e-1\/share$/)).toHaveLength(1))
    expect(await screen.findByText('Shared')).toBeInTheDocument()
  })

  it('records a new evaluation with only the scored criteria', async () => {
    on('POST', /\/teachers\/t-1\/evaluations$/, () => json(RECORDS))
    renderWithProviders(<EvaluationsSection teacherId="t-1" canWrite canEditCriteria={false} />, { staff: makeStaff({ role: 'admin' }) })
    await userEvent.click(await screen.findByRole('button', { name: 'New evaluation' }))
    const dialog = await screen.findByRole('dialog', { name: 'New evaluation' })
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Report quality' }), '3')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Recommendations' }), 'Add the surah range')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/teachers\/t-1\/evaluations$/)).toHaveLength(1))
    expect(sent('POST', /\/teachers\/t-1\/evaluations$/)[0]).toMatchObject({ scores: { 'c-2': 3 }, recommendations: 'Add the surah range' })
  })

  it('offers no writing to a reader', async () => {
    renderWithProviders(<EvaluationsSection teacherId="t-1" canWrite={false} canEditCriteria={false} />, { staff: makeStaff({ role: 'admin' }) })
    expect(await screen.findByText('Send reports the same day')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New evaluation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share with teacher' })).not.toBeInTheDocument()
  })
})
