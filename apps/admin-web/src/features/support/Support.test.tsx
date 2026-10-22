import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { AccountSummary } from '@/features/accounts/api'
import type { SupportToken } from './api'

/**
 * PD-20 support sessions on the page side, with `fetch` answered at the
 * network boundary. Held here: opening needs a reason; the support token is
 * used for the person's routes and NEVER replaces the administrator's own;
 * the banner says whose account this is; what is sent is labelled; Exit ends
 * it on the server and returns to Accounts; a reload asks for a fresh token.
 * What a support session may do is proven server-side
 * (apps/api pd020-impersonation-http.spec.ts).
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
const callsTo = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
const authOf = (call: unknown[] | undefined) => new Headers((call?.[1] as RequestInit)?.headers).get('Authorization')

const parent: AccountSummary = {
  accountId: 'acc-p',
  kind: 'family',
  name: 'Parent Alpha',
  staffRole: null,
  familyName: 'Family Alpha',
  children: ['Child One'],
  status: 'active',
  hasLogin: true,
  lockedUntil: null,
  lastLoginAt: null,
  allowed: { resetPassword: true, suspend: true, reactivate: false, impersonate: true },
}

const token = (over: Partial<SupportToken['session']> = {}, accessToken = 'support-token-1'): SupportToken => ({
  accessToken,
  expiresInSeconds: 900,
  session: {
    id: 'imp-1',
    target: { accountId: 'acc-p', kind: 'family', name: 'Parent Alpha', actorId: 'contact-1' },
    staff: { id: 's-1', name: 'Supervisor One' },
    reason: 'cannot find the card',
    startedAt: '2026-10-22T10:00:00.000Z',
    expiresAt: '2026-10-22T10:15:00.000Z',
    endsAtLatest: '2026-10-22T11:00:00.000Z',
    endedAt: null,
    endedReason: null,
    actions: 0,
    ...over,
  },
})

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
  tokenStore.set({ accessToken: 'staff-access', refreshToken: 'staff-refresh' })
  on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [parent], truncated: false }))
  on('GET', /\/admin\/impersonations(\?|$)/, () => json({ sessions: [] }))
  on('GET', /\/conversations$/, () =>
    json({ conversations: [{ id: 'c-1', type: 'direct', familyId: 'f', learnerId: null, title: 'Supervisor One', state: 'open', needsReply: false, lastSeq: '2', lastActivityAt: '2026-10-22T09:00:00Z', archivedAt: null }] }),
  )
  on('GET', /\/conversations\/c-1\/messages/, () =>
    json({
      messages: [
        { id: 'm-1', conversationId: 'c-1', seq: '1', authorKind: 'contact', authorId: 'contact-1', authorDisplayName: 'Parent Alpha', type: 'text', body: 'Hello', visibility: 'customer', moderation: 'published', clientMessageId: null, deletedForAll: false, createdAt: '2026-10-22T09:00:00Z', attachments: [], sentBySupport: false },
        { id: 'm-2', conversationId: 'c-1', seq: '2', authorKind: 'contact', authorId: 'contact-1', authorDisplayName: 'Parent Alpha', type: 'text', body: 'Earlier support note', visibility: 'customer', moderation: 'published', clientMessageId: null, deletedForAll: false, createdAt: '2026-10-22T09:30:00Z', attachments: [], sentBySupport: true },
      ],
      nextBefore: null,
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('PD-20: support sessions in Admin Web', () => {
  it('opens with a reason, acts on the support token only, labels what is sent, and exits back to Accounts', async () => {
    on('POST', /\/admin\/impersonations$/, () => json(token(), 201))
    on('POST', /\/conversations\/c-1\/messages$/, () => json({ id: 'm-3', sentBySupport: true }, 201))
    on('POST', /\/admin\/impersonations\/imp-1\/end$/, () => json({ ...token().session, endedAt: '2026-10-22T10:05:00Z', endedReason: 'ended by the administrator' }))

    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/accounts' })
    await userEvent.click(await screen.findByRole('button', { name: 'Open as Parent Alpha' }))
    const dialog = screen.getByRole('dialog', { name: "Open Parent Alpha's account" })
    expect(within(dialog).getByRole('button', { name: 'Open the account' })).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox'), 'cannot find the card')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open the account' }))

    // The banner says whose account this is.
    expect(await screen.findByText('Support session: acting as Parent Alpha (parent)')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /Supervisor One/ }))
    expect(await screen.findByText('Earlier support note')).toBeInTheDocument()
    expect(screen.getAllByText('Sent by support')).toHaveLength(1)

    // The person's routes go on the support token; the staff session is untouched.
    expect(authOf(callsTo('GET', /\/conversations$/)[0])).toBe('Bearer support-token-1')
    expect(authOf(callsTo('POST', /\/admin\/impersonations$/)[0])).toBe('Bearer staff-access')
    expect(tokenStore.access()).toBe('staff-access')

    await userEvent.type(screen.getByLabelText(/^Write a message/), 'Moved to Thursday')
    expect(screen.getByText('Sent as Parent Alpha, labelled "Sent by support" for everyone.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(callsTo('POST', /\/conversations\/c-1\/messages$/)).toHaveLength(1))
    expect(authOf(callsTo('POST', /\/conversations\/c-1\/messages$/)[0])).toBe('Bearer support-token-1')

    await userEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument()
    expect(callsTo('POST', /\/admin\/impersonations\/imp-1\/end$/)).toHaveLength(1)
    expect(tokenStore.access()).toBe('staff-access')
  })

  it('a reload asks for a fresh token with the administrator\'s own session; an ended one says so', async () => {
    on('POST', /\/admin\/impersonations\/imp-2\/token$/, () => json(token({ id: 'imp-2' }, 'support-token-2')))
    const first = renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/support/imp-2' })
    expect(await screen.findByText('Support session: acting as Parent Alpha (parent)')).toBeInTheDocument()
    expect(authOf(callsTo('POST', /imp-2\/token$/)[0])).toBe('Bearer staff-access')
    first.unmount()

    on('POST', /\/admin\/impersonations\/imp-3\/token$/, () =>
      json({ error: { code: 'COMM.IMPERSONATION_ENDED', message: 'this support session has ended' } }, 409),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/support/imp-3' })
    expect(await screen.findByText('This support session has ended.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Accounts' })).toHaveAttribute('href', '/accounts')
  })

  it('a refusal from the server is said plainly', async () => {
    on('POST', /\/admin\/impersonations\/imp-4\/token$/, () => json(token({ id: 'imp-4' }, 'support-token-4')))
    on('POST', /\/conversations\/c-1\/messages$/, () =>
      json({ error: { code: 'COMM.SUPPORT_SESSION_FORBIDDEN', message: 'no' } }, 403),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/support/imp-4' })
    await userEvent.click(await screen.findByRole('button', { name: /Supervisor One/ }))
    await userEvent.type(await screen.findByLabelText(/^Write a message/), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed in a support session')
  })
})
