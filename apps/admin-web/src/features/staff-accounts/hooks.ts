import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accountKeys } from '@/features/accounts/api'
import { staffAccountKeys, staffAccountsApi, type AccessRoleEdit, type NewAccessRole, type NewStaffAccount } from './api'

export function useStaffAccounts(enabled = true) {
  return useQuery({ queryKey: staffAccountKeys.list, queryFn: staffAccountsApi.list, enabled })
}

export function useStaffAccount(staffId: string) {
  return useQuery({ queryKey: staffAccountKeys.one(staffId), queryFn: () => staffAccountsApi.get(staffId) })
}

export function useAccessRoles(enabled = true) {
  return useQuery({ queryKey: staffAccountKeys.roles, queryFn: staffAccountsApi.roles, staleTime: 30_000, enabled })
}

export function usePermissionCatalogue() {
  return useQuery({ queryKey: staffAccountKeys.permissions, queryFn: staffAccountsApi.permissions, staleTime: 5 * 60_000 })
}

/** A staff-account write can change what the Accounts page shows too. */
function useInvalidating<V, R>(fn: (v: V) => Promise<R>, keepAnswer = false) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    // An answer that holds a sign-in code is never kept once the dialog lets go of it.
    ...(keepAnswer ? {} : { gcTime: 0 }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: staffAccountKeys.all })
      void client.invalidateQueries({ queryKey: accountKeys.all })
    },
  })
}

export function useCreateStaffAccount() {
  return useInvalidating((body: NewStaffAccount) => staffAccountsApi.create(body))
}

export function useGrantRole() {
  return useInvalidating((v: { staffId: string; roleId: string; reason: string }) => staffAccountsApi.grant(v.staffId, v.roleId, v.reason), true)
}

export function useRevokeRole() {
  return useInvalidating((v: { staffId: string; roleId: string; reason: string }) => staffAccountsApi.revoke(v.staffId, v.roleId, v.reason), true)
}

export function useSetupCode() {
  return useInvalidating((v: { staffId: string; reason: string }) => staffAccountsApi.setupCode(v.staffId, v.reason))
}

export function useDefineRole() {
  return useInvalidating((body: NewAccessRole) => staffAccountsApi.defineRole(body), true)
}

export function useUpdateRole() {
  return useInvalidating((v: { roleId: string; body: AccessRoleEdit }) => staffAccountsApi.updateRole(v.roleId, v.body), true)
}

export function useArchiveRole() {
  return useInvalidating((v: { roleId: string; reason: string }) => staffAccountsApi.archiveRole(v.roleId, v.reason), true)
}
