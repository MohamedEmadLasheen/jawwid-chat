import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { api, newIdempotencyKey, request, setUnauthenticatedHandler } from './client'
import { ApiError, NetworkError } from './errors'
import { tokenStore } from '@/core/auth/tokens'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    setUnauthenticatedHandler(() => {})
    tokenStore.clear()
  })

  // The API is Bearer-only (PR-B) and sets no cookie; the cookie client this
  // replaced could not sign anybody in.
  it('sends the bearer token, and never an ambient cookie', async () => {
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await api.get('/me')
    const init = fetchMock.mock.calls[0]![1]
    expect(init.headers['Authorization']).toBe('Bearer access-1')
    expect(init.credentials).toBe('omit')
  })

  it('sends no Authorization header without a session', async () => {
    await api.get('/me')
    expect(fetchMock.mock.calls[0]![1].headers['Authorization']).toBeUndefined()
  })

  it('drops empty query parameters instead of sending bare filters', async () => {
    await api.get('/families', { q: '', bucket: 'now', owner_id: undefined, needs_reply: false })
    const url: string = fetchMock.mock.calls[0]![0]
    expect(url).toContain('bucket=now')
    expect(url).toContain('needs_reply=false')
    expect(url).not.toContain('q=')
    expect(url).not.toContain('owner_id')
  })

  it('passes an idempotency key through so a retry cannot duplicate a write', async () => {
    await api.post('/families/fam_1/messages', { body: 'hi' }, 'key-123')
    expect(fetchMock.mock.calls[0]![1].headers['Idempotency-Key']).toBe('key-123')
  })

  it('mints unique idempotency keys', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey())
  })

  it('maps a server error into both languages', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'coverage_cannot_close',
            message_en: 'Coverage cannot close a relationship case.',
            message_ar: 'التغطية لا يمكنها إغلاق حالة علاقة.',
          },
        },
        403,
      ),
    )

    await expect(api.post('/cases/c1', {})).rejects.toSatisfy((error: unknown) => {
      const apiError = error as ApiError
      expect(apiError).toBeInstanceOf(ApiError)
      expect(apiError.isForbidden).toBe(true)
      expect(apiError.localized('ar')).toBe('التغطية لا يمكنها إغلاق حالة علاقة.')
      return true
    })
  })

  it('falls back to a readable message when the server sends none', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500))
    await expect(api.get('/dashboard/chats')).rejects.toMatchObject({
      status: 500,
      messageEn: 'Something went wrong on our side.',
    })
  })

  it('rotates an expired access token ONCE for a burst of 401s, then retries', async () => {
    tokenStore.set({ accessToken: 'stale', refreshToken: 'refresh-1' })
    let refreshes = 0
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++
        expect(JSON.parse(String(init.body))).toEqual({ refreshToken: 'refresh-1' })
        return jsonResponse({ accessToken: 'fresh', refreshToken: 'refresh-2' })
      }
      const auth = (init.headers as Record<string, string>)['Authorization']
      return auth === 'Bearer fresh' ? jsonResponse({ ok: true }) : jsonResponse({}, 401)
    })

    // The API revokes every session on a replayed refresh token, so five
    // concurrent expiries must cost exactly one rotation.
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => api.get('/admin/overview')))
    expect(results.every((r) => (r as { ok: boolean }).ok)).toBe(true)
    expect(refreshes).toBe(1)
    expect(tokenStore.access()).toBe('fresh')
    expect(tokenStore.refresh()).toBe('refresh-2')
  })

  it('ends the session when the refresh is refused', async () => {
    const onUnauthenticated = vi.fn()
    setUnauthenticatedHandler(onUnauthenticated)
    tokenStore.set({ accessToken: 'stale', refreshToken: 'revoked' })
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'AUTH.SESSION_REVOKED' } }, 401))

    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError)
    expect(tokenStore.hasSession()).toBe(false)
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
  })

  it("shows the API's own single-language message when that is all it sends", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'COMM.ADMIN_INSPECTION_DENIED', message: 'only the super admin may inspect' } }, 403),
    )
    await expect(api.get('/admin/users')).rejects.toMatchObject({
      code: 'COMM.ADMIN_INSPECTION_DENIED',
      messageEn: 'only the super admin may inspect',
    })
  })

  it('ends the session exactly once on a 401 from anywhere', async () => {
    const onUnauthenticated = vi.fn()
    setUnauthenticatedHandler(onUnauthenticated)
    fetchMock.mockResolvedValue(jsonResponse({}, 401))

    await expect(api.get('/inbox')).rejects.toBeInstanceOf(ApiError)
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
  })

  it('reports a network failure as its own kind of error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.get('/inbox')).rejects.toBeInstanceOf(NetworkError)
  })

  it('returns nothing for a 204 rather than trying to parse a body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(api.delete('/coverage/rules/r1')).resolves.toBeUndefined()
  })

  it('does not attach a JSON content type to a GET', async () => {
    await request('/me', { method: 'GET' })
    expect(fetchMock.mock.calls[0]![1].headers['Content-Type']).toBeUndefined()
  })
})
