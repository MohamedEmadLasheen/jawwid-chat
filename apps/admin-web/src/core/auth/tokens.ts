/**
 * Where Admin Web keeps its session (API-CONTRACT §3.1, PR-B).
 *
 * The API authenticates with a Bearer access token and rotates a refresh token
 * on every `/auth/refresh`. It sets no cookie, so the cookie-based client this
 * replaced could never sign anybody in.
 *
 *   access token   MEMORY ONLY. It is the credential every request carries,
 *                  so it is never written to storage a script could read
 *                  after the tab is gone.
 *   refresh token  sessionStorage. Survives a reload of THIS tab, dies with
 *                  the tab, and is never shared with another tab -- which
 *                  matters, because the API treats a replayed refresh token as
 *                  theft and revokes every session on the account. Two tabs
 *                  sharing one would sign each other out.
 *
 * Nothing here decides what the user may do. The role is read from `/me` and
 * the server re-decides every action.
 */

const REFRESH_KEY = 'jawwid.admin.refresh'

let accessToken: string | null = null

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    // Blocked storage: the session simply does not survive a reload.
    return null
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
  refresh(): string | null {
    try {
      return storage()?.getItem(REFRESH_KEY) ?? null
    } catch {
      return null
    }
  },
  hasSession(): boolean {
    return Boolean(accessToken || this.refresh())
  },
  set(pair: TokenPair): void {
    accessToken = pair.accessToken
    try {
      storage()?.setItem(REFRESH_KEY, pair.refreshToken)
    } catch {
      // Memory-only session; still usable until reload.
    }
  },
  clear(): void {
    accessToken = null
    try {
      storage()?.removeItem(REFRESH_KEY)
    } catch {
      // Nothing to clear.
    }
  },
}
