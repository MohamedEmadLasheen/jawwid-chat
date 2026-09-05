import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inboxApi, type InboxSection } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import type { InboxRow } from '@/shared/types/domain'

/**
 * One query per section. The server decides both membership and order; the
 * client never re-sorts, because sorting here would mean recomputing attention
 * on the client, which brief §12 forbids.
 */
export function useInboxSection(section: InboxSection, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: qk.inbox(section),
    queryFn: ({ pageParam }) => inboxApi.section(section, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  })

  const rows: InboxRow[] = query.data?.pages.flatMap((page) => page.items) ?? []
  return { ...query, rows }
}

export function useShiftBanner() {
  return useQuery({
    queryKey: qk.shiftBanner,
    queryFn: () => inboxApi.shiftBanner(),
    // Backed by the `shift.ending` event; this interval is the safety net for a
    // dropped socket, not the primary mechanism.
    refetchInterval: 120_000,
  })
}

export function useAwaySummary() {
  return useQuery({ queryKey: qk.awaySummary, queryFn: () => inboxApi.awaySummary() })
}

export function useSnoozeToNextShift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (familyIds: string[]) => inboxApi.snoozeToNextShift(familyIds),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.inboxAll })
      void queryClient.invalidateQueries({ queryKey: qk.shiftBanner })
    },
  })
}

/**
 * Brief §6: the inbox carries a "this order is wrong" button whose payload is
 * the calibration data used to replace the initial attention weights with real
 * ones. It is MVP-required, not a nice-to-have.
 */
export function useOrderFeedback() {
  return useMutation({
    mutationFn: (input: {
      family_id: string
      section: InboxSection
      position: number
      what_i_would_have_done: string
    }) => inboxApi.orderFeedback(input),
  })
}
