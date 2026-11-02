import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { chooseOption, optionsOf } from '@/test/select'
import { makeStaff, renderWithProviders } from '@/test/utils'

/**
 * PD-39 §10 1b-1d, 4a-4b: the staff board viewer, through the real routes and
 * API client with `fetch` answered at the network boundary. What these prove
 * is the page's side: it is offered only to an account holding a whiteboard
 * key, it draws the teacher's page read-only and asks for nothing else, the
 * access history is read only on request, and the one write -- copying a
 * departed teacher's board -- sends exactly the chosen teacher. Who may read
 * which teacher, and the logging, are the server's (apps/api test/integration/
 * whiteboards-pd039*.spec.ts). Synthetic people and SYNTHETIC verse text only.
 */
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../../../test/fixtures/whiteboards/page-every-kind.json'), 'utf8'))

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
type Handler = (url: string, init: RequestInit) => Response
let routes: Array<[RegExp, string, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
let drawn: string[]
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([pattern, method, handler])
const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)

const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const T3 = '33333333-3333-4333-8333-333333333333'
const BOARD = 'b0000000-0000-4000-8000-000000000001'

const summary = (over: Record<string, unknown> = {}) => ({
  id: BOARD,
  title: 'Al-Fatihah review',
  lessonId: null,
  state: 'active',
  revision: 4,
  pageCount: 1,
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-28T09:00:00.000Z',
  trashedAt: null,
  purgeAfter: null,
  retainedUntil: null,
  ...over,
})
const detail = (over: Record<string, unknown> = {}) => ({ ...summary(over), teacherId: T1, canEdit: false, pages: [fixture.page] })

beforeEach(() => {
  routes = []
  drawn = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [pattern, m, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  // jsdom has no canvas: a 2D context that only remembers the words drawn.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      new Proxy({} as Record<string, unknown>, {
        get(target, prop: string) {
          if (prop in target) return target[prop]
          if (prop === 'measureText') return (t: string) => ({ width: t.length * 10 })
          if (prop === 'fillText') return (t: string) => drawn.push(t)
          return () => {}
        },
        set(target, prop: string, value) {
          target[prop] = value
          return true
        },
      }) as unknown as CanvasRenderingContext2D,
  )
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: true }))
  // The pickers' source is under a whiteboard key (review of #327), not the supervision directory.
  on('GET', /\/teacher-boards\/teachers$/, () =>
    json({
      teachers: [
        { id: T1, name: 'Teacher One', isActive: false },
        { id: T2, name: 'Teacher Two', isActive: true },
        { id: T3, name: 'Teacher Three', isActive: true },
      ],
      copyTargets: [
        { id: T2, name: 'Teacher Two' },
        { id: T3, name: 'Teacher Three' },
      ],
    }),
  )
  on('GET', /\/teacher-boards\?teacherId=/, () => json([summary({ state: 'retained', retainedUntil: '2027-10-01T00:00:00.000Z' })]))
  on('GET', new RegExp(`/teacher-boards/${BOARD}$`), () => json(detail()))
  on('GET', /\/quran\/ayahs\?surah=1&from=1&to=7$/, () => json(fixture.ayahs))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  tokenStore.clear()
})

// Whiteboard keys only: a PD-40 role with no supervision key still gets its pickers (review of #327).
const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin', permissions: ['whiteboards.view'] })
const manager = makeStaff({ id: 'm-1', name: 'Manager One', role: 'manager', permissions: ['whiteboards.view', 'whiteboards.retention'] })
const noKey = makeStaff({ id: 'x-1', name: 'Staff One', role: 'admin', permissions: ['teacher_supervision.view'] })

const writes = () => fetchMock.mock.calls.filter(([, i]) => ((i as RequestInit)?.method ?? 'GET') !== 'GET')

describe('PD-39 staff board viewer', () => {
  it("lists a teacher's boards, a departed teacher's with the date they are deleted for good", async () => {
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/boards' })
    const nav = await screen.findByRole('navigation', { name: 'Teachers' })
    expect(within(nav).getByRole('link', { name: 'Boards' })).toHaveAttribute('aria-current', 'page')
    // No board is listed before a teacher is chosen: a listing is logged. (The
    // teacher names come first, from /teacher-boards/teachers, which logs nothing.)
    expect(calls('GET', /\/teacher-boards\?/)).toHaveLength(0)
    expect(calls('GET', /\/teacher-boards\/teachers$/)).toHaveLength(1)
    const picker = await screen.findByRole('combobox', { name: 'Teacher' })
    await waitFor(() => expect(picker).toBeEnabled())
    expect((await optionsOf(userEvent, picker)).map((o) => o.label)).toContain('Teacher One (left)')
    await chooseOption(userEvent, picker, T1)
    expect(await screen.findByRole('link', { name: 'Al-Fatihah review' })).toHaveAttribute('href', `/teachers/boards/${BOARD}`)
    expect(screen.getByText(/Kept until/)).toBeInTheDocument()
    expect(calls('GET', new RegExp(`/teacher-boards\\?teacherId=${T1}$`))).toHaveLength(1)
    expect(writes()).toHaveLength(0)
  })

  it("says plainly when the server does not let this account see a teacher's boards", async () => {
    on('GET', /\/teacher-boards\?teacherId=/, () => json({ error: { code: 'COMM.WHITEBOARD_NOT_FOUND', message: 'no such board' } }, 404))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: `/teachers/boards?teacher=${T2}` })
    expect(await screen.findByText("You can't see this teacher's boards")).toBeInTheDocument()
  })

  it('is not offered to an account without a whiteboard key', async () => {
    renderWithProviders(<AppRoutes />, { staff: noKey, route: '/teachers/boards' })
    expect(await screen.findByText("You don't have permission to access this.")).toBeInTheDocument()
    renderWithProviders(<AppRoutes />, { staff: noKey, route: '/teachers/supervision' })
    const nav = await screen.findByRole('navigation', { name: 'Teachers' })
    expect(within(nav).queryByRole('link', { name: 'Boards' })).not.toBeInTheDocument()
    expect(calls('GET', /\/teacher-boards/)).toHaveLength(0)
  })

  it('draws the page read-only, the verse in its verified text, and offers no way to change the board', async () => {
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: `/teachers/boards/${BOARD}` })
    expect(await screen.findByRole('heading', { name: /Al-Fatihah review/ })).toBeInTheDocument()
    expect(screen.getByText('Read only')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Page 1 of the board «Al-Fatihah review»' })).toBeInTheDocument()
    await waitFor(() => expect(drawn).toContain('SYNTHETIC-BASMALA'))
    expect(drawn).toContain('ممتاز')
    expect(screen.getByText('Quran text: Synthetic test data')).toBeInTheDocument()
    // What the canvas shows, as text for a screen reader; a verse by its reference.
    const said = screen.getByRole('list', { name: 'Text on this page' })
    expect(within(said).getByText('Quran: surah 1, ayat 1 to 7')).toBeInTheDocument()
    expect(within(said).getByText('ممتاز')).toBeInTheDocument()
    // A supervisor reads; the history and the copy are the Teachers Manager's.
    expect(screen.queryByRole('button', { name: /Copy|Edit|Delete|Restore|Save/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Access history')).not.toBeInTheDocument()
    expect(calls('GET', new RegExp(`/teacher-boards/${BOARD}$`))).toHaveLength(1)
    expect(writes()).toHaveLength(0)
  })

  it('shows "unavailable" in place of a verse whose text cannot be checked, never another text', async () => {
    on('GET', /\/quran\/ayahs/, () => json({ error: { code: 'COMM.QURAN_UNAVAILABLE', message: 'unavailable' } }, 503))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: `/teachers/boards/${BOARD}` })
    await waitFor(() => expect(drawn).toContain('Verse text unavailable'))
    expect(drawn.some((t) => t.includes('SYNTHETIC'))).toBe(false)
  })

  it('reads the access history only when asked, and names who looked and as what', async () => {
    on('GET', new RegExp(`/teacher-boards/${BOARD}/access-log$`), () =>
      json([
        { viewerId: 's-1', viewerKind: 'staff', viewerName: 'Supervisor One', basis: 'supervisor', action: 'open', detail: null, at: '2026-10-28T10:00:00.000Z' },
        { viewerId: 'o-1', viewerKind: 'support_session', viewerName: 'Operator One', basis: 'support_session', action: 'open', detail: null, at: '2026-10-28T11:00:00.000Z' },
        { viewerId: null, viewerKind: 'system', viewerName: null, basis: 'system', action: 'retain', detail: null, at: '2026-10-28T12:00:00.000Z' },
      ]),
    )
    renderWithProviders(<AppRoutes />, { staff: manager, route: `/teachers/boards/${BOARD}` })
    await userEvent.click(await screen.findByRole('button', { name: 'Show access history' }))
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Supervisor One')).toBeInTheDocument()
    expect(within(table).getByText('Support session by Operator One')).toBeInTheDocument()
    expect(within(table).getByText('Kept: the teacher left')).toBeInTheDocument()
    expect(calls('GET', /\/access-log$/)).toHaveLength(1)
  })

  it("copies a departed teacher's board to exactly the active teacher chosen; the original is untouched", async () => {
    on('GET', new RegExp(`/teacher-boards/${BOARD}$`), () => json(detail({ state: 'retained', retainedUntil: '2027-10-01T00:00:00.000Z' })))
    on('POST', new RegExp(`/teacher-boards/${BOARD}/copy$`), () => json(summary({ id: 'b-copy' }), 201))
    renderWithProviders(<AppRoutes />, { staff: manager, route: `/teachers/boards/${BOARD}` })
    expect(await screen.findByText(/deleted for good on/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Copy to a teacher' }))
    const dialog = await screen.findByRole('dialog')
    const to = within(dialog).getByRole('combobox', { name: 'Copy to' })
    // Only active teachers, never the departed owner.
    await waitFor(async () => expect((await optionsOf(userEvent, to)).map((o) => o.label)).toEqual(['Choose a teacher', 'Teacher Two', 'Teacher Three']))
    await chooseOption(userEvent, to, T3)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(await within(dialog).findByText('Copied. Teacher Three now has «Al-Fatihah review» among their boards.')).toBeInTheDocument()
    expect(writes()).toHaveLength(1)
    expect(JSON.parse(String((calls('POST', /\/copy$/)[0]![1] as RequestInit).body))).toEqual({ teacherId: T3 })
    // A key per intended copy: a retry answers the same copy (the server keeps it in the log).
    expect(new Headers((calls('POST', /\/copy$/)[0]![1] as RequestInit).headers).get('Idempotency-Key')).toMatch(/.+/)
  })

  it('the super admin reaches the same pages from Admin > Teachers', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'sa-1', name: 'Owner One', role: 'super_admin' }), route: `/admin/teachers/boards?teacher=${T1}` })
    expect(await screen.findByRole('link', { name: 'Al-Fatihah review' })).toHaveAttribute('href', `/admin/teachers/boards/${BOARD}`)
    expect(screen.getByRole('link', { name: 'Boards' })).toBeInTheDocument()
  })
})
