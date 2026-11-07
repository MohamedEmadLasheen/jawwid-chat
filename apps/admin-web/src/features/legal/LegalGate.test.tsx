import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { LegalGuard } from './LegalGuard'
import { legalGateState, parseLegal } from './legal'
import { api, setTermsRequiredHandler } from '@/core/api/client'
import { tokenStore } from '@/core/auth/tokens'
import { qk } from '@/core/api/queryKeys'
import type { LegalBlock } from './legal'

const DOCS = [
  { documentKey: 'terms_staff', version: '2026-11-1', urlAr: 'https://x.test/ar/terms', urlEn: 'https://x.test/en/terms' },
  { documentKey: 'code_of_conduct', version: '2026-11-2', urlAr: 'https://x.test/ar/coc', urlEn: 'https://x.test/en/coc' },
]
const REQUIRED: LegalBlock = { state: 'required', required: DOCS, unavailable: [] }
const ACCEPTED: LegalBlock = { state: 'accepted', required: [], unavailable: [] }

const ME_REQUIRED = { actorId: 'staff_a', kind: 'staff', displayName: 'Admin A', locale: 'en', isActive: true, staffRole: 'admin', organizationId: null, legal: REQUIRED }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let fetchMock: ReturnType<typeof vi.fn>
let routes: Record<string, () => Response>
const calls = (re: RegExp, method?: string) =>
  fetchMock.mock.calls.filter(([u, i]) => re.test(String(u)) && (!method || (i?.method ?? 'GET') === method))

beforeEach(() => {
  tokenStore.set({ accessToken: 'a', refreshToken: 'r' })
  routes = {
    'GET /me/legal': () => json({ ...REQUIRED, documents: [] }),
    'POST /me/legal/accept': () => json({ legal: ACCEPTED }),
    'GET /me': () => json({ actorId: 's', kind: 'staff', displayName: 'A', locale: 'en', isActive: true, staffRole: 'admin', organizationId: null, legal: ACCEPTED }),
  }
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/v1/, '').replace(/\?.*$/, '')
    const handler = routes[`${init?.method ?? 'GET'} ${path}`]
    return handler ? handler() : json({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
  setTermsRequiredHandler(() => {})
})

function mount(legal: LegalBlock | undefined, locale: 'en' | 'ar' = 'en') {
  const staff = makeStaff(legal ? { legal } : {})
  return renderWithProviders(<LegalGuard><div>APP CONTENT</div></LegalGuard>, { locale, staff })
}

describe('legal state', () => {
  it('no legal field (today\'s API) means no gate', () => {
    expect(legalGateState(parseLegal(undefined))).toBe('none')
    mount(undefined)
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument()
  })
  it('accepted means no gate', () => {
    mount(ACCEPTED)
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument()
  })
  it('required shows the gate and hides the app', () => {
    mount(REQUIRED)
    expect(screen.queryByText('APP CONTENT')).toBeNull()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })
  it('unavailable shows the notice, never the app, never accepted', () => {
    mount({ state: 'unavailable', required: [], unavailable: ['terms_staff'] })
    expect(screen.queryByText('APP CONTENT')).toBeNull()
    expect(screen.getByText('The Terms of Use are temporarily unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
  it('fails closed on an unknown state or an empty required list', () => {
    expect(legalGateState(parseLegal({ state: 'weird', required: [], unavailable: [] }))).toBe('unavailable')
    expect(legalGateState(parseLegal({ state: 'required', required: [], unavailable: [] }))).toBe('unavailable')
    expect(legalGateState(parseLegal({ state: 'accepted', required: DOCS, unavailable: [] }))).toBe('gate')
    expect(legalGateState(parseLegal('nonsense'))).toBe('unavailable')
  })
})

describe('the gate', () => {
  it('has no box pre-ticked and Agree disabled until all are ticked', async () => {
    mount(REQUIRED)
    const boxes = screen.getAllByRole('checkbox')
    boxes.forEach((b) => expect(b).not.toBeChecked())
    const agree = screen.getByRole('button', { name: 'Agree' })
    expect(agree).toBeDisabled()
    await userEvent.click(boxes[0]!)
    expect(agree).toBeDisabled()
    await userEvent.click(boxes[1]!)
    expect(agree).toBeEnabled()
    await userEvent.click(boxes[0]!)
    expect(agree).toBeDisabled()
  })

  it('opens each document in a new tab, in the current language', () => {
    mount(REQUIRED)
    const links = screen.getAllByRole('link', { name: /Open/ })
    expect(links[0]).toHaveAttribute('href', 'https://x.test/en/terms')
    expect(links[1]).toHaveAttribute('href', 'https://x.test/en/coc')
    links.forEach((l) => {
      expect(l).toHaveAttribute('target', '_blank')
      expect(l).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  it('posts the exact body and then lets the app through', async () => {
    const { queryClient } = mount(REQUIRED)
    for (const b of screen.getAllByRole('checkbox')) await userEvent.click(b)
    await userEvent.click(screen.getByRole('button', { name: 'Agree' }))
    await waitFor(() => expect(calls(/\/me\/legal\/accept$/, 'POST')).toHaveLength(1))
    const init = calls(/\/me\/legal\/accept$/, 'POST')[0]![1]
    expect(JSON.parse(init.body)).toEqual({
      documents: [
        { documentKey: 'terms_staff', version: '2026-11-1' },
        { documentKey: 'code_of_conduct', version: '2026-11-2' },
      ],
      client: 'admin_web',
      locale: 'en',
    })
    await waitFor(() => expect(screen.getByText('APP CONTENT')).toBeInTheDocument())
    expect((queryClient.getQueryData(qk.me) as { legal: LegalBlock }).legal.state).toBe('accepted')
  })

  it('sends locale ar in Arabic, renders RTL copy and the Arabic links', async () => {
    mount(REQUIRED, 'ar')
    expect(screen.getByRole('button', { name: 'أوافق' })).toBeDisabled()
    expect(screen.getByLabelText('قرأتُ شروط الاستخدام وأوافق عليها')).toBeInTheDocument()
    expect(screen.getByLabelText('قرأتُ ميثاق السلوك وأوافق عليه')).toBeInTheDocument()
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', 'https://x.test/ar/terms')
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl')
    for (const b of screen.getAllByRole('checkbox')) await userEvent.click(b)
    await userEvent.click(screen.getByRole('button', { name: 'أوافق' }))
    await waitFor(() => expect(calls(/\/me\/legal\/accept$/, 'POST')).toHaveLength(1))
    expect(JSON.parse(calls(/\/me\/legal\/accept$/, 'POST')[0]![1].body).locale).toBe('ar')
  })

  async function tickAndAgree() {
    for (const b of screen.getAllByRole('checkbox')) await userEvent.click(b)
    await userEvent.click(screen.getByRole('button', { name: 'Agree' }))
  }

  it('409 stale: reloads the documents, clears the ticks and asks again', async () => {
    routes['POST /me/legal/accept'] = () => json({ error: { code: 'COMM.LEGAL_VERSION_STALE', message: 'x' } }, 409)
    routes['GET /me'] = () => json(ME_REQUIRED)
    mount(REQUIRED)
    await waitFor(() => expect(calls(/\/me\/legal$/).length).toBeGreaterThan(0))
    const before = calls(/\/me\/legal$/).length
    await tickAndAgree()
    expect(await screen.findByText(/changed since you opened this page/)).toBeInTheDocument()
    await waitFor(() => expect(calls(/\/me\/legal$/).length).toBeGreaterThan(before))
    screen.getAllByRole('checkbox').forEach((b) => expect(b).not.toBeChecked())
    expect(screen.getByRole('button', { name: 'Agree' })).toBeDisabled()
  })

  it('400 wrong documents: reloads, never resends unchanged', async () => {
    routes['POST /me/legal/accept'] = () => json({ error: { code: 'COMM.LEGAL_WRONG_DOCUMENTS', message: 'x' } }, 400)
    routes['GET /me'] = () => json(ME_REQUIRED)
    mount(REQUIRED)
    await waitFor(() => expect(calls(/\/me\/legal$/).length).toBeGreaterThan(0))
    const before = calls(/\/me\/legal$/).length
    await tickAndAgree()
    expect(await screen.findByText(/changed since you opened this page/)).toBeInTheDocument()
    await waitFor(() => expect(calls(/\/me\/legal$/).length).toBeGreaterThan(before))
    expect(screen.getByRole('button', { name: 'Agree' })).toBeDisabled()
    expect(calls(/\/me\/legal\/accept$/, 'POST')).toHaveLength(1)
  })

  it('403 support session: a clear message', async () => {
    routes['POST /me/legal/accept'] = () => json({ error: { code: 'COMM.SUPPORT_SESSION_FORBIDDEN', message: 'x' } }, 403)
    mount(REQUIRED)
    await tickAndAgree()
    expect(await screen.findByText(/support session/i)).toBeInTheDocument()
    expect(screen.queryByText('APP CONTENT')).toBeNull()
  })

  it('503 not configured: a generic failure, still gated', async () => {
    routes['POST /me/legal/accept'] = () => json({ error: { code: 'COMM.LEGAL_NOT_CONFIGURED', message: 'internal detail' } }, 503)
    mount(REQUIRED)
    await tickAndAgree()
    expect(await screen.findByText('Could not save your agreement. Try again later.')).toBeInTheDocument()
    expect(screen.queryByText('internal detail')).toBeNull()
    expect(screen.queryByText('APP CONTENT')).toBeNull()
  })

  it('Sign out is offered', async () => {
    routes['POST /auth/logout'] = () => json({})
    mount(REQUIRED)
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(calls(/\/auth\/logout$/, 'POST')).toHaveLength(1))
  })
})

describe('central 403 COMM.TERMS_NOT_ACCEPTED interception', () => {
  it('an unrelated request refetches /me and the gate appears', async () => {
    routes['GET /me'] = () => json(ME_REQUIRED)
    routes['GET /tasks'] = () => json({ error: { code: 'COMM.TERMS_NOT_ACCEPTED', message: 'x', detail: { required: DOCS } } }, 403)
    mount(ACCEPTED)
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument()
    await expect(api.get('/tasks')).rejects.toMatchObject({ code: 'COMM.TERMS_NOT_ACCEPTED' })
    await waitFor(() => expect(screen.queryByText('APP CONTENT')).toBeNull())
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(calls(/\/me$/).length).toBeGreaterThan(0)
  })
})
