import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { profileKeys } from '@/features/profiles/api'
import { subscriptionKeys, subscriptionsApi, type NewException, type NewSubscription, type SubscriptionView } from './api'

export function useSubscription(learnerId: string) {
  return useQuery({
    queryKey: subscriptionKeys.learner(learnerId),
    queryFn: () => subscriptionsApi.view(learnerId),
    enabled: learnerId !== '',
    retry: false,
  })
}

export function useRenewalRequests(enabled = true) {
  return useQuery({ queryKey: subscriptionKeys.renewals(), queryFn: () => subscriptionsApi.renewalRequests(), enabled, retry: false })
}

/** Every write answers the child's whole view; it replaces the cached one, and the family's money is re-read. */
function useWrite<A>(learnerId: string, fn: (a: A) => Promise<SubscriptionView>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (view) => {
      qc.setQueryData(subscriptionKeys.learner(learnerId), view)
      void qc.invalidateQueries({ queryKey: subscriptionKeys.renewals() })
      void qc.invalidateQueries({ queryKey: profileKeys.all })
    },
  })
}

export const useAddSubscription = (learnerId: string) =>
  useWrite(learnerId, (body: NewSubscription) => subscriptionsApi.add(learnerId, body))
export const useVoidSubscription = (learnerId: string) =>
  useWrite(learnerId, ({ id, reason }: { id: string; reason: string }) => subscriptionsApi.void(id, reason))
export const useGrantException = (learnerId: string) =>
  useWrite(learnerId, (body: NewException) => subscriptionsApi.grant(learnerId, body))
export const useRevokeException = (learnerId: string) =>
  useWrite(learnerId, ({ id, reason }: { id: string; reason: string }) => subscriptionsApi.revoke(id, reason))
