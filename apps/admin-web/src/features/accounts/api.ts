import { api } from '@/core/api/client'

/**
 * PD-21 wire contract, mirrored from apps/api/src/account-admin.
 *
 * Who may act on which account is the server's answer alone
 * (AuthorizationService.canAdministerAccount): any staff member for parents and
 * teachers, the super admin for other staff, nobody for the super admin's
 * account or their own. `allowed` is advisory -- every action is decided again.
 */

export type AccountKind = 'family' | 'teacher' | 'staff'
export type AccountStatus = 'provisioned' | 'active' | 'suspended' | 'deactivated'

export interface AccountSummary {
  accountId: string
  kind: AccountKind
  name: string
  staffRole: string | null
  familyName: string | null
  children: string[]
  status: AccountStatus
  hasLogin: boolean
  lockedUntil: string | null
  lastLoginAt: string | null
  allowed: { resetPassword: boolean; suspend: boolean; reactivate: boolean; impersonate: boolean }
}

export interface AccountList {
  accounts: AccountSummary[]
  truncated: boolean
}

/** The one-time code: shown to the administrator ONCE, never stored by the client. */
export interface IssuedReset {
  code: string
  expiresAt: string
  expiresInMinutes: number
  signedOutSessions: number
}

export const accountKeys = {
  all: ['accounts'] as const,
  list: (q: string, kind: string) => ['accounts', 'list', q, kind] as const,
}

const path = (id: string) => `/admin/accounts/${encodeURIComponent(id)}`

export const accountsApi = {
  list: (q: string, kind: string) =>
    api.get<AccountList>('/admin/accounts', { ...(q ? { q } : {}), ...(kind !== 'all' ? { kind } : {}) }),
  issueReset: (id: string, reason: string, signOutEverywhere: boolean) =>
    api.post<IssuedReset>(`${path(id)}/password-reset`, { reason, signOutEverywhere }),
  suspend: (id: string, reason: string) => api.post<AccountSummary>(`${path(id)}/suspend`, { reason }),
  reactivate: (id: string, reason: string) => api.post<AccountSummary>(`${path(id)}/reactivate`, { reason }),
}
