import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, setTermsRequiredHandler } from './client'
import { ApiError } from './errors'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('PD-58 terms interception', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setTermsRequiredHandler(() => {})
  })
  it('calls the handler once on 403 COMM.TERMS_NOT_ACCEPTED and still throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'COMM.TERMS_NOT_ACCEPTED', message: 'x', detail: { required: [] } } }, 403)))
    const handler = vi.fn()
    setTermsRequiredHandler(handler)
    await expect(api.post('/x', {})).rejects.toMatchObject({ code: 'COMM.TERMS_NOT_ACCEPTED' })
    expect(handler).toHaveBeenCalledTimes(1)
  })
  it('ignores other 403s', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'COMM.FORBIDDEN', message: 'x' } }, 403)))
    const handler = vi.fn()
    setTermsRequiredHandler(handler)
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError)
    expect(handler).not.toHaveBeenCalled()
  })
})
