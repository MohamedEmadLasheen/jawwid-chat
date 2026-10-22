import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEVICE_REFRESH_KEY,
  REFRESH_LOCK,
  TAB_REFRESH_KEY,
  onSignedOutElsewhere,
  persistenceSupported,
  tokenStore,
} from './tokens'
import { deviceLabel } from './device'
import { readableDeviceName } from '@/features/devices/SessionList'
import { installFakeLocks, removeFakeLocks } from '@/test/locks'

/**
 * PD-23 "Keep me signed in on this device": where the refresh token lives,
 * and why sharing it across tabs cannot replay it.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  tokenStore.clear()
  removeFakeLocks()
  localStorage.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('PD-23: the token store', () => {
  it('offers persistence only where Web Locks exist', () => {
    expect(persistenceSupported()).toBe(false)
    installFakeLocks()
    expect(persistenceSupported()).toBe(true)
  })

  it('keeps a remembered session in localStorage and a not-remembered one in sessionStorage', () => {
    installFakeLocks()
    tokenStore.set({ accessToken: 'a1', refreshToken: 'r1' }, { remembered: true })
    expect(localStorage.getItem(DEVICE_REFRESH_KEY)).toBe('r1')
    expect(sessionStorage.getItem(TAB_REFRESH_KEY)).toBeNull()
    expect(tokenStore.mode()).toBe('device')

    tokenStore.set({ accessToken: 'a2', refreshToken: 'r2' }, { remembered: false })
    expect(sessionStorage.getItem(TAB_REFRESH_KEY)).toBe('r2')
    // The previous device copy is cleared, not left behind.
    expect(localStorage.getItem(DEVICE_REFRESH_KEY)).toBeNull()
    expect(tokenStore.mode()).toBe('tab')
  })

  it('never writes the access token to any storage', () => {
    installFakeLocks()
    tokenStore.set({ accessToken: 'secret-access', refreshToken: 'r1' }, { remembered: true })
    const everything = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(everything).not.toContain('secret-access')
  })

  it('stays per-tab when the server remembered but this browser cannot serialize refreshes', () => {
    tokenStore.set({ accessToken: 'a1', refreshToken: 'r1' }, { remembered: true })
    expect(localStorage.getItem(DEVICE_REFRESH_KEY)).toBeNull()
    expect(sessionStorage.getItem(TAB_REFRESH_KEY)).toBe('r1')
  })

  it('writes a rotated token back to where the previous one was', () => {
    installFakeLocks()
    tokenStore.set({ accessToken: 'a1', refreshToken: 'r1' }, { remembered: true })
    tokenStore.set({ accessToken: 'a2', refreshToken: 'r2' })
    expect(localStorage.getItem(DEVICE_REFRESH_KEY)).toBe('r2')
    expect(sessionStorage.getItem(TAB_REFRESH_KEY)).toBeNull()
  })

  it('on load, looks in sessionStorage first, then localStorage', async () => {
    installFakeLocks()
    localStorage.setItem(DEVICE_REFRESH_KEY, 'device-token')
    let fresh = (await import('./tokens')).tokenStore
    expect(fresh.refresh()).toBe('device-token')
    expect(fresh.mode()).toBe('device')

    vi.resetModules()
    sessionStorage.setItem(TAB_REFRESH_KEY, 'tab-token')
    fresh = (await import('./tokens')).tokenStore
    expect(fresh.refresh()).toBe('tab-token')
    expect(fresh.mode()).toBe('tab')
  })

  it('signs this tab out when another tab removes the shared token, and ignores rotations', () => {
    installFakeLocks()
    tokenStore.set({ accessToken: 'a1', refreshToken: 'r1' }, { remembered: true })
    const listener = vi.fn()
    const stop = onSignedOutElsewhere(listener)

    // Another tab rotated it: nothing to do.
    localStorage.setItem(DEVICE_REFRESH_KEY, 'r2')
    window.dispatchEvent(new StorageEvent('storage', { key: DEVICE_REFRESH_KEY, newValue: 'r2' }))
    expect(listener).not.toHaveBeenCalled()
    expect(tokenStore.access()).toBe('a1')

    // Another tab signed out.
    localStorage.removeItem(DEVICE_REFRESH_KEY)
    window.dispatchEvent(new StorageEvent('storage', { key: DEVICE_REFRESH_KEY, newValue: null }))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(tokenStore.access()).toBeNull()
    expect(tokenStore.hasSession()).toBe(false)
    stop()
  })

  it('a per-tab session ignores the shared key', () => {
    tokenStore.set({ accessToken: 'a1', refreshToken: 'r1' })
    const listener = vi.fn()
    const stop = onSignedOutElsewhere(listener)
    window.dispatchEvent(new StorageEvent('storage', { key: DEVICE_REFRESH_KEY, newValue: null }))
    expect(listener).not.toHaveBeenCalled()
    expect(tokenStore.access()).toBe('a1')
    stop()
  })
})

describe('PD-23: refresh across tabs', () => {
  it('runs every device-mode refresh under the lock and re-reads the token inside it: no replay', async () => {
    const { requested } = installFakeLocks()
    const presented: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (!String(url).endsWith('/auth/refresh')) return json({}, 404)
        const { refreshToken } = JSON.parse(String(init.body)) as { refreshToken: string }
        // The server: a token presented twice is theft.
        if (presented.includes(refreshToken)) return json({ error: { code: 'AUTH.REFRESH_REUSED' } }, 401)
        presented.push(refreshToken)
        await new Promise((r) => setTimeout(r, 10))
        const n = Number(refreshToken.slice(1)) + 1
        return json({
          accessToken: `a${n}`,
          refreshToken: `r${n}`,
          session: { id: 's1', createdAt: '2026-10-22T00:00:00Z', remembered: true, expiresAt: '2026-10-29T00:00:00Z', absoluteExpiresAt: null },
        })
      }),
    )

    // Two tabs: two module instances sharing one localStorage and one lock manager.
    vi.resetModules()
    const tabA = { ...(await import('@/core/api/client')), ...(await import('./tokens')) }
    tabA.tokenStore.set({ accessToken: 'a1', refreshToken: 'r1' }, { remembered: true })
    vi.resetModules()
    const tabB = { ...(await import('@/core/api/client')), ...(await import('./tokens')) }
    expect(tabB.tokenStore.mode()).toBe('device')

    const [okA, okB] = await Promise.all([tabA.refreshSession(), tabB.refreshSession()])
    expect([okA, okB]).toEqual([true, true])
    // The second refresh presented the token the first one wrote -- not r1 again.
    expect(presented).toEqual(['r1', 'r2'])
    expect(localStorage.getItem(DEVICE_REFRESH_KEY)).toBe('r3')
    expect(requested).toEqual([REFRESH_LOCK, REFRESH_LOCK])
    expect(tabA.tokenStore.access()).toBe('a2')
    expect(tabB.tokenStore.access()).toBe('a3')
  })

  it('still shares one in-flight refresh between same-tab 401s', async () => {
    installFakeLocks()
    let refreshes = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).endsWith('/auth/refresh')) {
          refreshes++
          return json({ accessToken: 'fresh', refreshToken: 'r2' })
        }
        const auth = (init.headers as Record<string, string>)['Authorization']
        return auth === 'Bearer fresh' ? json({ ok: true }) : json({}, 401)
      }),
    )
    vi.resetModules()
    const { api } = await import('@/core/api/client')
    const tokens = await import('./tokens')
    tokens.tokenStore.set({ accessToken: 'stale', refreshToken: 'r1' }, { remembered: true })
    await Promise.all([1, 2, 3, 4].map(() => api.get('/me')))
    expect(refreshes).toBe(1)
    expect(localStorage.getItem(DEVICE_REFRESH_KEY)).toBe('r2')
  })

  it('a refresh refused for good clears the shared token, which signs the other tabs out', async () => {
    installFakeLocks()
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'AUTH.SESSION_REVOKED' } }, 401)))
    vi.resetModules()
    const { refreshSession } = await import('@/core/api/client')
    const tokens = await import('./tokens')
    tokens.tokenStore.set({ accessToken: 'a1', refreshToken: 'r1' }, { remembered: true })
    expect(await refreshSession()).toBe(false)
    expect(localStorage.getItem(DEVICE_REFRESH_KEY)).toBeNull()
  })

  it.each([
    ['the network is down', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['the server fails (503)', async () => json({ error: { code: 'COMMON.UNAVAILABLE' } }, 503)],
  ])('keeps every tab signed in when %s: the error goes up, the token stays', async (_label, answer) => {
    installFakeLocks()
    vi.stubGlobal('fetch', vi.fn(answer))
    vi.resetModules()
    const { refreshSession } = await import('@/core/api/client')
    const tokens = await import('./tokens')
    tokens.tokenStore.set({ accessToken: 'a1', refreshToken: 'r1' }, { remembered: true })
    await expect(refreshSession()).rejects.toBeTruthy()
    expect(localStorage.getItem(DEVICE_REFRESH_KEY)).toBe('r1')
    expect(tokens.tokenStore.refresh()).toBe('r1')
  })
})

describe('PD-23: the device name', () => {
  it('names the browser and the system, without versions', () => {
    expect(
      deviceLabel({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      }),
    ).toBe('Chrome on macOS')
    expect(
      deviceLabel({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0',
      }),
    ).toBe('Edge on Windows')
    expect(
      deviceLabel({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      }),
    ).toBe('Safari on iPhone')
    expect(deviceLabel({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0' })).toBe('Firefox on Linux')
    expect(
      deviceLabel({ userAgent: '', userAgentData: { brands: [{ brand: 'Not=A?Brand' }, { brand: 'Google Chrome' }], platform: 'Windows' } }),
    ).toBe('Chrome on Windows')
    expect(deviceLabel({ userAgent: 'something odd' })).toBe('Web browser')
  })

  it('is at most 60 characters and carries no digits from a version', () => {
    const label = deviceLabel({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36',
    })
    expect(label).toBe('Samsung Internet on Android')
    expect(label.length).toBeLessThanOrEqual(60)
    expect(label).not.toMatch(/\d/)
  })
})

describe('PD-23: how a device is named in the lists', () => {
  it('shows an iOS model code as its family and every real name as given', () => {
    expect(readableDeviceName('iPhone18,1')).toBe('iPhone')
    expect(readableDeviceName('iPad13,4')).toBe('iPad')
    expect(readableDeviceName('Galaxy A54')).toBe('Galaxy A54')
    expect(readableDeviceName('Chrome on macOS')).toBe('Chrome on macOS')
    expect(readableDeviceName(null)).toBe('')
  })
})
