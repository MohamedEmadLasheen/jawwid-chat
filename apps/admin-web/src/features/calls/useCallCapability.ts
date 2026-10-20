import { useQuery } from '@tanstack/react-query'
import { callApi, callKeys } from './callApi'

/**
 * The server's advisory answer to "could this viewer start a call here now"
 * (W7, screens/call.md §4), defined ONCE so every place that draws or checks a
 * call affordance -- the header's call button, the chat's "Schedule call…",
 * the Calls page's member picker -- reads the same answer from the same cache.
 *
 * Advisory and cheap to be wrong about: POST /calls (and POST /scheduled-calls)
 * decide again from scratch, so it is refreshed often rather than trusted long.
 */
export const callCapabilityQuery = (conversationId: string) => ({
  queryKey: callKeys.capability(conversationId),
  queryFn: () => callApi.capability(conversationId),
  staleTime: 15_000,
})

/** `callCapabilityQuery` for a component; `canCall` is false while loading, on error and on "no". */
export function useCallCapability(conversationId: string) {
  const query = useQuery(callCapabilityQuery(conversationId))
  return { ...query, canCall: query.data?.canCall === true }
}
