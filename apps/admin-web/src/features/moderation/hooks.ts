import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { moderationApi, moderationKeys, type QueueFilters, type Resolution } from './api'

export function useReports(filters: QueueFilters, enabled = true) {
  return useQuery({ queryKey: moderationKeys.list(filters), queryFn: () => moderationApi.list(filters), enabled, refetchInterval: 60_000 })
}

/** Opening a report is audited by the server, so it is fetched only when a reviewer opens it. */
export function useReport(id: string | null) {
  return useQuery({ queryKey: moderationKeys.one(id ?? ''), queryFn: () => moderationApi.get(id!), enabled: id !== null, staleTime: 0, gcTime: 0 })
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
