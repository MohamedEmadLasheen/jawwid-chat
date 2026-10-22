import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accountKeys, accountsApi } from './api'

export function useAccounts(q: string, kind: string) {
  return useQuery({ queryKey: accountKeys.list(q, kind), queryFn: () => accountsApi.list(q, kind) })
}

function useInvalidating<V, R>(fn: (v: V) => Promise<R>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({ queryKey: accountKeys.all }),
  })
}

export function useIssueReset() {
  return useInvalidating((v: { id: string; reason: string; signOutEverywhere: boolean }) =>
    accountsApi.issueReset(v.id, v.reason, v.signOutEverywhere),
  )
}

export function useSuspend() {
  return useInvalidating((v: { id: string; reason: string }) => accountsApi.suspend(v.id, v.reason))
}

export function useReactivate() {
  return useInvalidating((v: { id: string; reason: string }) => accountsApi.reactivate(v.id, v.reason))
}
