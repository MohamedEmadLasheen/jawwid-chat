import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, refreshSession, requestAs, setTermsRequiredHandler } from './client'
import { ApiError } from './errors'
import { sessionApi } from './endpoints'
import { tokenStore } from '@/core/auth/tokens'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const TERMS_403 = (detail?: unknown) =>
  jsonResponse({ error: { code: 'COMM.TERMS_NOT_ACCEPTED', message: 'x', ...(detail === undefined ? {} : { detail }) } }, 403)

const DOC = { documentKey: 'terms_staff', version: 'v1', urlAr: 'https://x.test/ar', urlEn: 'https://x.test/en' }

describe('PD-58 terms interception', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setTermsRequiredHandler(() => {})
    tokenStore.clear()
  })
  it('calls the handler once on 403 COMM.TERMS_NOT_ACCEPTED and still throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(TERMS_403({ required: [] })))
    const handler = vi.fn()
    setTermsRequiredHandler(handler)
    await expect(api.post('/x', {})).rejects.toMatchObject({ code: 'COMM.TERMS_NOT_ACCEPTED' })
    expect(handler).toHaveBeenCalledTimes(1)
  })
  it('a 403 without detail still calls the handler (it then only refetches /me)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(TERMS_403()))
    const handler = vi.fn()
    setTermsRequiredHandler(handler)
    await expect(api.post('/x', {})).rejects.toMatchObject({ code: 'COMM.TERMS_NOT_ACCEPTED' })
    expect(handler).toHaveBeenCalledWith(undefined)
  })
  it('ignores other 403s', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'COMM.FORBIDDEN', message: 'x' } }, 403)))
    const handler = vi.fn()
    setTermsRequiredHandler(handler)
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError)
    expect(handler).not.toHaveBeenCalled()
  })
  it("a support session's own 403 (requestAs, anonymous) never gates the staff member", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(TERMS_403({ required: [DOC] })))
    const handler = vi.fn()
    setTermsRequiredHandler(handler)
    await expect(requestAs('support-bearer', '/conversations/c/messages', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'COMM.TERMS_NOT_ACCEPTED',
    })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('PD-58 the token pair', () => {
  beforeEach(() => tokenStore.set({ accessToken: 'a', refreshToken: 'r' }))
  afterEach(() => {
    vi.unstubAllGlobals()
    setTermsRequiredHandler(() => {})
    tokenStore.clear()
  })

  const pair = (legal?: unknown) => ({
    tokenType: 'Bearer',
    accessToken: 'a2',
    refreshToken: 'r2',
    expiresIn: 900,
    ...(legal === undefined ? {} : { legal }),
  })

  it.each([
    ['required', { state: 'required', required: [DOC], unavailable: [] }, 1],
    ['unavailable', { state: 'unavailable', required: [], unavailable: ['terms_staff'] }, 1],
    ['accepted', { state: 'accepted', required: [], unavailable: [] }, 0],
    ["absent (today's API)", undefined, 0],
  ])('a refresh whose pair is %s calls the handler %i time(s)', async (_label, legal, times) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(pair(legal))))
    const handler = vi.fn()
    setTermsRequiredHandler(handler)
    await expect(refreshSession()).resolves.toBe(true)
    expect(handler).toHaveBeenCalledTimes(times)
  })

  it('login takes legal from the top level of the pair when the actor has none', async () => {
    const actor = { actorId: 's', kind: 'staff', displayName: 'A', locale: 'en', isActive: true, staffRole: 'admin', organizationId: null }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ...pair({ state: 'required', required: [DOC], unavailable: [] }), actor })),
    )
    const staff = await sessionApi.login('a', 'b')
    expect(staff.legal).toEqual({ state: 'required', required: [DOC], unavailable: [] })
  })
})
