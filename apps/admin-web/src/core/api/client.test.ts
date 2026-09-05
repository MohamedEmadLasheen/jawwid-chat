import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { api, newIdempotencyKey, request, setUnauthenticatedHandler } from './client'
import { ApiError, NetworkError } from './errors'

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
  })

  it('sends the session cookie rather than a token held in JavaScript', async () => {
    await api.get('/me')
    expect(fetchMock.mock.calls[0]![1].credentials).toBe('include')
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
    await expect(api.get('/dashboard/header')).rejects.toMatchObject({
      status: 500,
      messageEn: 'Something went wrong on our side.',
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
