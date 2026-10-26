import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { ConversationList } from '@/features/chat/ConversationList'
import { chatCopyFor, systemText } from '@/features/chat/copy'
import type { ChatConversation } from '@/features/chat/chatApi'
import type { Cover, CoverPreview, Department } from './api'
import { MyCoverBanner } from './CoverBanner'
import { OrganizationPage } from './OrganizationPage'

/**
 * PD-33 "Hand over to backup" in Admin Web, with `fetch` answered at the
 * network boundary: the supervisor's own "I'm away" (pre-filled linked backup,
 * a blocked backup disabled with its reason, the confirm summary, the request
 * sent), the away and covering banners, the Organization page's team column,
 * and the cover line / chip in the chat list. What the server allows and moves
 * is proven in supervisor-cover-pd033*.spec.ts. Synthetic people only.
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

const UNTIL = '2026-11-03T21:59:00.000Z'

const cover = (over: Partial<Cover> = {}): Cover => ({
  id: 'cov-1',
  supervisor: { id: 'sup-1', name: 'Supervisor Noor' },
  backup: { id: 'bk-1', name: 'Backup Amira' },
  startsAt: '2026-10-27T08:00:00.000Z',
  endsAt: UNTIL,
  endedAt: null,
  endKind: null,
  note: null,
  status: 'active',
  canExtend: true,
  canEnd: true,
  ...over,
})

const preview: CoverPreview = {
  supervisor: { id: 'sup-1', name: 'Supervisor Noor' },
  backup: { id: 'bk-1', name: 'Backup Amira' },
  eligibleBackups: [
    { id: 'bk-1', name: 'Backup Amira', linked: true, covering: 0, blocked: null, blockedReason: null },
    { id: 'bk-2', name: 'Backup Dalia', linked: false, covering: 2, blocked: 'at_limit', blockedReason: 'Backup Dalia already covers 2 supervisors' },
    { id: 'bk-3', name: 'Backup Hala', linked: false, covering: 0, blocked: 'not_linked', blockedReason: 'not linked' },
  ],
  maxDays: 30,
  openCover: null,
  counts: { families: 12, groups: 9, directs: 11, openItems: { approvals: 1, instalments: 2, newStudents: 1, total: 4 } },
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
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('"I\'m away": the supervisor hands over in one step', () => {
  it('pre-fills the linked backup, disables a blocked one, summarizes, and sends one request', async () => {
    const staff = makeStaff({ id: 'sup-1', name: 'Supervisor Noor', role: 'admin' })
    on('GET', /\/me\/cover$/, () => json({ canHandOver: true, away: null, covering: [] }))
    on('GET', /\/org\/covers\/preview\?supervisorId=sup-1/, () => json(preview))
    on('POST', /\/org\/covers$/, () => json(cover(), 201))
    renderWithProviders(<MyCoverBanner />, { staff })

    await userEvent.click(await screen.findByRole('button', { name: "I'm away" }))
    const dialog = await screen.findByRole('dialog', { name: 'Hand over Supervisor Noor to a backup' })
    const select = await within(dialog).findByLabelText('Backup')
    expect((select as HTMLSelectElement).value).toBe('bk-1')
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => [o.textContent, o.disabled])).toEqual([
      ['Backup Amira · linked backup', false],
      ['Backup Dalia — already covers 2 supervisors', true],
      // "I'm away" offers only a backup a manager linked (PD-8 canConfigureBackup).
      ['Backup Hala — not linked to you — ask your manager', true],
    ])
    await userEvent.click(within(dialog).getByRole('button', { name: '1 week' }))
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), 'family matter')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review' }))

    const confirm = await screen.findByRole('dialog', { name: 'Confirm the hand-over' })
    expect(within(confirm).getByText(/^12 families, 9 groups and 4 open items move to Backup Amira until /)).toBeInTheDocument()
    expect(within(confirm).getByText(/Parent chats: 11 · Awaiting approval: 1 · Open instalments: 2 · New students: 1/)).toBeInTheDocument()
    expect(sent('POST', /\/org\/covers$/)).toEqual([])

    await userEvent.click(within(confirm).getByRole('button', { name: 'Hand over' }))
    await waitFor(() => expect(sent('POST', /\/org\/covers$/)).toHaveLength(1))
    const body = sent('POST', /\/org\/covers$/)[0]!
    expect(body).toMatchObject({ supervisorId: 'sup-1', backupId: 'bk-1', note: 'family matter' })
    expect(body).not.toHaveProperty('from')
    // "1 week" = the end of that academy day.
    const days = (new Date(String(body.until)).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6)
    expect(days).toBeLessThan(8.1)
    expect(await screen.findByText(/^Handed over\. Backup Amira is covering until /)).toBeInTheDocument()
  })

  it('a missing end date keeps the form open', async () => {
    const staff = makeStaff({ id: 'sup-1', name: 'Supervisor Noor', role: 'admin' })
    on('GET', /\/me\/cover$/, () => json({ canHandOver: true, away: null, covering: [] }))
    on('GET', /\/org\/covers\/preview/, () => json(preview))
    renderWithProviders(<MyCoverBanner />, { staff })
    await userEvent.click(await screen.findByRole('button', { name: "I'm away" }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByLabelText('Backup')
    await userEvent.clear(within(dialog).getByLabelText('Until (at most 30 days)'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review' }))
    expect(within(dialog).getByText('Choose an end within 30 days.')).toBeInTheDocument()
  })
})

describe('the banners on the supervisor\'s home', () => {
  it('while away: who covers until when, Extend and End cover now', async () => {
    const staff = makeStaff({ id: 'sup-1', name: 'Supervisor Noor', role: 'admin' })
    on('GET', /\/me\/cover$/, () => json({ canHandOver: true, away: cover(), covering: [] }))
    on('POST', /\/org\/covers\/cov-1\/end$/, () => json(cover({ status: 'ended', endKind: 'ended_early' }), 201))
    renderWithProviders(<MyCoverBanner />, { staff })
    expect(await screen.findByText(/^You're away until .*Backup Amira is covering your families\.$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "I'm away" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'End cover now' }))
    await waitFor(() => expect(sent('POST', /\/org\/covers\/cov-1\/end$/)).toHaveLength(1))
  })

  it('for the backup: whom they cover; they may end it but not extend it', async () => {
    const staff = makeStaff({ id: 'bk-1', name: 'Backup Amira', role: 'coverage' })
    on('GET', /\/me\/cover$/, () => json({ canHandOver: false, away: null, covering: [cover({ canExtend: false })] }))
    renderWithProviders(<MyCoverBanner />, { staff })
    expect(await screen.findByText(/^You're covering Supervisor Noor's families until /)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End cover now' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Extend' })).not.toBeInTheDocument()
  })

  it('nothing for a manager or the super admin', async () => {
    renderWithProviders(<MyCoverBanner />, { staff: makeStaff({ id: 'mgr', role: 'manager' }) })
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock.mock.calls.some(([u]) => /\/me\/cover$/.test(String(u)))).toBe(false)
  })
})

describe('the Organization page', () => {
  const ops: Department = {
    id: 'd-ops',
    kind: 'operations',
    displayName: 'Operations',
    manager: { id: 'mgr-1', name: 'Ops Manager', role: 'manager', isActive: true },
    backups: [],
    members: [
      { id: 'sup-1', name: 'Supervisor Noor', role: 'admin', isActive: true, position: 'supervisor', learnerCount: 12 },
      { id: 'sup-2', name: 'Supervisor Two', role: 'admin', isActive: true, position: 'supervisor', learnerCount: 8 },
      { id: 'bk-1', name: 'Backup Amira', role: 'coverage', isActive: true, position: 'backup_supervisor', learnerCount: 0 },
    ],
  }

  it('shows who is away and who covers, and offers "Hand over to backup" for the others', async () => {
    on('GET', /\/org\/structure$/, () => json({ departments: [ops] }))
    on('GET', /\/org\/learners/, () => json({ learners: [] }))
    on('GET', /\/org\/covers\?active=true$/, () => json({ covers: [cover()] }))
    on('GET', /\/org\/covers\/preview\?supervisorId=sup-2/, () => json({ ...preview, supervisor: { id: 'sup-2', name: 'Supervisor Two' } }))
    renderWithProviders(<OrganizationPage />, { staff: makeStaff({ id: 'mgr-1', role: 'manager' }) })
    await userEvent.click(await screen.findByRole('tab', { name: 'Departments & backups' }))

    const noor = (await screen.findByText('Supervisor Noor')).closest('tr')!
    expect(within(noor).getByText(/^Away until /)).toBeInTheDocument()
    expect(within(noor).getByText('Backup Amira covering')).toBeInTheDocument()
    expect(within(noor).getByRole('button', { name: 'Extend' })).toBeInTheDocument()
    const amira = screen.getAllByText('Backup Amira').map((n) => n.closest('tr')).find((r) => r && within(r).queryByText(/^Covering Supervisor Noor until /))
    expect(amira).toBeTruthy()

    const two = screen.getByText('Supervisor Two').closest('tr')!
    await userEvent.click(within(two).getByRole('button', { name: 'Hand over to backup — Supervisor Two' }))
    expect(await screen.findByRole('dialog', { name: 'Hand over Supervisor Two to a backup' })).toBeInTheDocument()
  })
})

describe('the chat list and the cover line', () => {
  const conv = {
    id: 'g-1',
    type: 'student_group',
    familyId: 'f-1',
    learnerId: 'k-1',
    title: 'Child Alpha',
    state: 'open',
    needsReply: false,
    lastSeq: '3',
    lastActivityAt: '2026-10-26T10:00:00Z',
    archivedAt: null,
    cover: { supervisorId: 'sup-1', supervisorName: 'Supervisor Noor', coverId: 'bk-1', coverName: 'Backup Amira', until: UNTIL },
  } as unknown as ChatConversation

  it('the backup sees "Covering for" on the covered chats', async () => {
    renderWithProviders(<ConversationList conversations={[conv]} selectedId={null} onSelect={() => undefined} onOpenMessage={() => undefined} />, {
      staff: makeStaff({ id: 'bk-1', role: 'coverage' }),
    })
    expect(await screen.findByText('Covering')).toBeInTheDocument()
    expect(screen.getByLabelText('Covering for Supervisor Noor')).toBeInTheDocument()
  })

  it('the system lines read in both languages, with the end day', () => {
    const body = JSON.stringify({ kind: 'cover.started', supervisor: 'Supervisor Noor', cover: 'Backup Amira', until: UNTIL })
    expect(systemText(body, chatCopyFor('en'))).toBe('Backup Amira is covering for Supervisor Noor until 3 Nov')
    expect(systemText(body, chatCopyFor('ar'))).toContain('التغطية: Backup Amira بدلًا من Supervisor Noor حتى')
    expect(systemText(JSON.stringify({ kind: 'cover.ended', supervisor: 'Supervisor Noor', cover: 'Backup Amira' }), chatCopyFor('en')))
      .toBe('Supervisor Noor is back; the cover has ended')
    expect(chatCopyFor('en').coverLine(conv.cover!)).toBe('Backup Amira is covering for Supervisor Noor until 3 Nov')
    // A list preview carries the kind only: never "is covering for until".
    expect(chatCopyFor('en').system['cover.started']!({})).toBe('A backup supervisor is covering')
    expect(chatCopyFor('ar').system['cover.ended']!({})).toBe('انتهت التغطية')
  })
})
