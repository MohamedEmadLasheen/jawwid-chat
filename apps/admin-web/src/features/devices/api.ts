import { api } from '@/core/api/client'

/**
 * PD-23 wire contract: the sessions (signed-in devices) of an account.
 *
 *   GET  /me/sessions                          the signed-in staff member's own
 *   POST /me/sessions/{id}/revoke              -> { ok: true } (404 if not yours)
 *   POST /me/sessions/revoke-others            -> { revoked }
 *
 *   GET  /admin/accounts/{id}/sessions         another account's (`current` always false)
 *   POST /admin/accounts/{id}/sessions/{sid}/revoke   { reason } -> { ok: true }
 *   POST /admin/accounts/{id}/sessions/revoke-all     { reason } -> { revoked }
 *
 * Who may end whose sessions is the server's decision on every request
 * (canAdministerAccount for the admin half). Nothing here carries a token.
 */
export interface SessionDto {
  id: string
  current: boolean
  platform: 'ios' | 'android' | 'web' | null
  deviceName: string | null
  appVersion: string | null
  signedInAt: string
  lastSeenAt: string | null
  expiresAt: string
  remembered: boolean
}

export const sessionKeys = {
  mine: ['me', 'sessions'] as const,
  // Under ['accounts'], so the Accounts page's own invalidations refresh it too.
  account: (accountId: string) => ['accounts', 'sessions', accountId] as const,
}

const enc = encodeURIComponent

export const mySessionsApi = {
  list: () => api.get<{ sessions: SessionDto[] }>('/me/sessions').then((r) => r.sessions),
  revoke: (sessionId: string) => api.post<{ ok: true }>(`/me/sessions/${enc(sessionId)}/revoke`),
  revokeOthers: () => api.post<{ revoked: number }>('/me/sessions/revoke-others'),
}

export const accountSessionsApi = {
  list: (accountId: string) =>
    api.get<{ sessions: SessionDto[] }>(`/admin/accounts/${enc(accountId)}/sessions`).then((r) => r.sessions),
  revoke: (accountId: string, sessionId: string, reason: string) =>
    api.post<{ ok: true }>(`/admin/accounts/${enc(accountId)}/sessions/${enc(sessionId)}/revoke`, { reason }),
  revokeAll: (accountId: string, reason: string) =>
    api.post<{ revoked: number }>(`/admin/accounts/${enc(accountId)}/sessions/revoke-all`, { reason }),
}
