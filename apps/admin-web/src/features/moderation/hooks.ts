import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/core/api/errors'
import { moderationApi, moderationKeys, type QueueFilters, type QueueReport, type Resolution } from './api'

/** Access is scoped on the server: a 404 means "not available to you" (or gone), never retried. */
export const isNotAvailable = (e: unknown): boolean => e instanceof ApiError && e.isNotFound

export function useReports(filters: QueueFilters, enabled = true) {
  return useQuery({ queryKey: moderationKeys.list(filters), queryFn: () => moderationApi.list(filters), enabled, refetchInterval: 60_000 })
}

/** Opening a report is audited by the server, so it is fetched only when a reviewer opens it. */
export function useReport(id: string | null) {
  return useQuery({ queryKey: moderationKeys.one(id ?? ''), queryFn: () => moderationApi.get(id!), enabled: id !== null, staleTime: 0, gcTime: 0, retry: (n, e) => !isNotAvailable(e) && n < 2 })
}

/** Drops a report this reviewer can no longer see from every cached queue list, and its detail. */
export function useForgetReport() {
  const client = useQueryClient()
  return useCallback(
    (id: string) => {
      client.setQueriesData<QueueReport[]>({ queryKey: [...moderationKeys.all, 'list'] }, (old) => old?.filter((r) => r.id !== id))
      client.removeQueries({ queryKey: moderationKeys.one(id) })
    },
    [client],
  )
}

/**
 * Opens one evidence attachment: a fresh signed URL per click (the server
 * audits each), opened at once in a new tab without an opener or referrer.
 * Deliberately outside React Query: the URL is never cached, prefetched or
 * kept in state; it lives only for the duration of this call.
 */
export function useOpenAttachment(id: string, onNotAvailable: () => void) {
  const [pending, setPending] = useState<number | null>(null)
  const [error, setError] = useState<unknown>(null)
  const gone = useRef(onNotAvailable)
  gone.current = onNotAvailable
  const open = useCallback(
    async (index: number) => {
      setPending(index)
      setError(null)
      try {
        const { url } = await moderationApi.attachmentUrl(id, index)
        window.open(url, '_blank', 'noopener,noreferrer')
      } catch (e) {
        if (isNotAvailable(e)) gone.current()
        else setError(e)
      } finally {
        setPending(null)
      }
    },
    [id],
  )
  return { open, pending, error }
}

export function useTake() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => moderationApi.take(id),
    onSettled: () => client.invalidateQueries({ queryKey: moderationKeys.all }),
  })
}

export function useResolve(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { resolution: Resolution; note?: string; answer: string; key: string }) =>
      moderationApi.resolve(id, { resolution: v.resolution, note: v.note, answer: v.answer }, v.key),
    onSettled: () => client.invalidateQueries({ queryKey: moderationKeys.all }),
  })
}

/** The current instant, re-read every `everyMs` so the clocks tick. Tests fake the system time. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}
