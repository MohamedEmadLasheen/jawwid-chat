import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { announcementApi, type CreateAnnouncementInput } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import type { AnnouncementRow } from '@/core/api/endpoints'

export function useAnnouncements(filters: { status?: string } = {}) {
  const query = useInfiniteQuery({
    queryKey: qk.announcements(filters),
    queryFn: ({ pageParam }) =>
      announcementApi.list({ ...filters, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  const announcements: AnnouncementRow[] = query.data?.pages.flatMap((page) => page.items) ?? []
  return { ...query, announcements }
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAnnouncementInput) => announcementApi.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.announcementsAll })
    },
  })
}

/**
 * Publishing is separate from creating on purpose, and this mutation is the one
 * that is hard to undo: it hands the announcement to the notification engine,
 * which fans it out to every recipient as ordinary notifications. Cancelling
 * afterwards stops FUTURE fan-out and does not retract what was already sent —
 * a parent who was told something was told it.
 */
export function usePublishAnnouncement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => announcementApi.publish(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.announcementsAll })
    },
  })
}

export function useCancelAnnouncement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => announcementApi.cancel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.announcementsAll })
    },
  })
}
