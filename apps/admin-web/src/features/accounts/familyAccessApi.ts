import { api } from '@/core/api/client'

/**
 * ADMIN-002 wire contract, mirrored from apps/api/src/account-admin/family-access.*.
 *
 * A grant opens account administration of ONE family's parent accounts to one
 * Operations staff member, for a purpose, for at most 7 days. The Operations
 * Manager and the super admin grant and revoke (`canGrant`); a grantee sees
 * only their own active grants. Expiry is the server's: a grant past its end
 * opens nothing, whatever this list last said.
 */

export type FamilyAccessStatus = 'active' | 'ended' | 'revoked'

export interface FamilyAccessGrant {
  id: string
  family: { id: string; name: string }
  grantee: { id: string; name: string }
  grantedBy: { id: string; name: string }
  purpose: string
  startsAt: string
  endsAt: string
  revokedAt: string | null
  status: FamilyAccessStatus
}

export interface FamilyAccessList {
  grants: FamilyAccessGrant[]
  /** May this caller grant and revoke? Absent from an older server = no. */
  canGrant?: boolean
  /** Who may receive a grant: the live Operations staff of the organization. Only for a grantor. */
  grantees?: Array<{ id: string; name: string }>
}

/** The server's cap is 168 hours; these are the offered windows. */
export const GRANT_HOURS = [4, 24, 72, 168] as const

export const familyAccessKeys = {
  all: ['family-access'] as const,
  list: () => ['family-access', 'list'] as const,
}

const base = '/admin/family-access-grants'

export const familyAccessApi = {
  list: () => api.get<FamilyAccessList>(base),
  grant: (v: { familyId: string; granteeId: string; purpose: string; hours: number }) =>
    api.post<FamilyAccessGrant>(base, v),
  revoke: (id: string, reason: string) =>
    api.post<FamilyAccessGrant>(`${base}/${encodeURIComponent(id)}/revoke`, { reason }),
}
