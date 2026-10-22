/**
 * Where Admin Web keeps its session (API-CONTRACT §3.1, PR-B; PD-23).
 *
 * The API authenticates with a Bearer access token and rotates a refresh token
 * on every `/auth/refresh`. It sets no cookie, so the cookie-based client this
 * replaced could never sign anybody in.
 *
 *   access token   MEMORY ONLY, in every mode. It is the credential every
 *                  request carries, so it is never written to storage a script
 *                  could read after the tab is gone.
 *   refresh token  one of two places, chosen by the SERVER's answer:
 *
 *     'tab'     sessionStorage (the default; "Keep me signed in" not ticked,
 *               or the super admin, whom the server never remembers). Survives
 *               a reload of THIS tab, dies with the tab, never shared.
 *     'device'  localStorage (PD-23 "Keep me signed in on this device", only
 *               when the login answered `session.remembered: true`). Shared by
 *               every tab of this browser.
 *
 * Sharing is the dangerous part: the API treats a replayed (already rotated)
 * refresh token as theft and revokes EVERY session on the account. Two tabs
 * that each read the token and then refresh would sign the whole account out.
 * So 'device' mode is only offered where the Web Locks API exists, and every
 * refresh in that mode runs under one cross-tab lock and reads the token from
 * storage INSIDE the lock (`withRefreshLock`, used by client.ts
 * refreshSession). Without Web Locks the checkbox is hidden and the old
 * one-tab-one-token rule stands.
 *
 * Nothing here decides what the user may do. The role is read from `/me` and
 * the server re-decides every action.
 */

/** Per-tab refresh token (sessionStorage). The key predates PD-23. */
export const TAB_REFRESH_KEY = 'jawwid.admin.refresh'
/** Per-device refresh token (localStorage), shared by every tab. */
export const DEVICE_REFRESH_KEY = 'jawwid.admin.refresh.persistent'
/** The Web Locks name every 'device'-mode refresh is serialized under. */
export const REFRESH_LOCK = 'jawwid.admin.refresh'

export type Persistence = 'tab' | 'device'

let accessToken: string | null = null
/**
 * Which storage holds THIS tab's refresh token. Null until known: it is
 * re-derived from where a token is found (sessionStorage first, then
 * localStorage), so a new tab of a remembered browser joins 'device' mode and
 * a refresh writes the rotated token back to the place it came from.
 */
let mode: Persistence | null = null

function tabStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    // Blocked storage: the session simply does not survive a reload.
    return null
  }
}

function deviceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function read(store: Storage | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(store: Storage | null, key: string, value: string): void {
  try {
    store?.setItem(key, value)
  } catch {
    // Memory-only session; still usable until reload.
  }
}

function remove(store: Storage | null, key: string): void {
  try {
    store?.removeItem(key)
  } catch {
    // Nothing to clear.
  }
}

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

function lockManager(): LockManagerLike | null {
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks
  return locks && typeof locks.request === 'function' ? locks : null
}

/** Where a token is, sessionStorage first. 'device' only where it is safe. */
function resolveMode(): Persistence | null {
  if (read(tabStorage(), TAB_REFRESH_KEY)) return 'tab'
  if (persistenceSupported() && read(deviceStorage(), DEVICE_REFRESH_KEY)) return 'device'
  return null
}

function currentMode(): Persistence | null {
  mode ??= resolveMode()
  return mode
}

/**
 * Whether "Keep me signed in on this device" may be offered: cross-tab
 * refresh serialization (Web Locks) AND a localStorage to keep the token in.
 * Without both, a shared token could be replayed, so it is not offered.
 */
export function persistenceSupported(): boolean {
  if (!lockManager()) return false
  const store = deviceStorage()
  if (!store) return false
  try {
    const probe = `${DEVICE_REFRESH_KEY}.probe`
    store.setItem(probe, '1')
    store.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export const tokenStore = {
  access(): string | null {
    return accessToken
  },
  /** Read from storage on EVERY call -- never a cached copy (see withRefreshLock). */
  refresh(): string | null {
    const m = currentMode()
    if (m === 'device') return read(deviceStorage(), DEVICE_REFRESH_KEY)
    if (m === 'tab') return read(tabStorage(), TAB_REFRESH_KEY)
    return null
  },
  mode(): Persistence | null {
    return currentMode()
  },
  hasSession(): boolean {
    return Boolean(accessToken || this.refresh())
  },
  /**
   * Store a pair. `remembered` is given by a LOGIN (the server's
   * `session.remembered`); a refresh omits it and the rotated token goes back
   * where the previous one was. A remembered login where persistence is not
   * supported stays per-tab.
   */
  set(pair: TokenPair, opts?: { remembered?: boolean }): void {
    accessToken = pair.accessToken
    const next: Persistence = opts
      ? opts.remembered === true && persistenceSupported()
        ? 'device'
        : 'tab'
      : currentMode() ?? 'tab'
    mode = next
    if (next === 'device') {
      write(deviceStorage(), DEVICE_REFRESH_KEY, pair.refreshToken)
      remove(tabStorage(), TAB_REFRESH_KEY)
    } else {
      write(tabStorage(), TAB_REFRESH_KEY, pair.refreshToken)
      // Only a login decides the mode; a refresh in 'tab' mode leaves a
      // device token (another tab's session) alone.
      if (opts) remove(deviceStorage(), DEVICE_REFRESH_KEY)
    }
  },
  /**
   * End this tab's session. In 'device' mode removing the shared token is
   * what signs the browser's other tabs out (they listen for it, see
   * onSignedOutElsewhere).
   */
  clear(): void {
    const m = mode
    accessToken = null
    mode = null
    remove(tabStorage(), TAB_REFRESH_KEY)
    if (m === 'device') remove(deviceStorage(), DEVICE_REFRESH_KEY)
  },
}

/**
 * Run a refresh so that no two tabs of this browser can present the same
 * refresh token. In 'device' mode the callback runs under the `REFRESH_LOCK`
 * Web Lock; the callback MUST read the token (tokenStore.refresh()) inside,
 * never before -- a token read before the lock may already have been rotated
 * by another tab, and presenting it would be a replay. In 'tab' mode (one tab,
 * one token) it simply runs.
 */
export function withRefreshLock<T>(callback: () => Promise<T>): Promise<T> {
  const locks = lockManager()
  if (locks && currentMode() === 'device') return locks.request(REFRESH_LOCK, callback)
  return callback()
}

/**
 * Another tab of this browser signed out (or its refresh failed for good) and
 * removed the shared 'device' token: forget this tab's access token and tell
 * the listener, which ends the session on screen. Rotations (a new value) are
 * ignored -- the next refresh reads the new token under the lock.
 */
export function onSignedOutElsewhere(listener: () => void): () => void {
  const target = globalThis.window
  if (!target) return () => undefined
  const handler = (event: StorageEvent) => {
    if (event.key !== DEVICE_REFRESH_KEY && event.key !== null) return
    if (mode !== 'device') return
    if (read(deviceStorage(), DEVICE_REFRESH_KEY) !== null) return
    accessToken = null
    mode = null
    listener()
  }
  target.addEventListener('storage', handler)
  return () => target.removeEventListener('storage', handler)
}
