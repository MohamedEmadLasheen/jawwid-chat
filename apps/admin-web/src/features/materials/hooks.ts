import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { materialsApi, materialsKeys, type ItemInput, type ItemQuery, type MarkStatus } from './api'

/** Whether to offer the Materials page. A refusal reads as "no". */
export function useMaterialsAccess(enabled = true) {
  return useQuery({ queryKey: materialsKeys.access, queryFn: materialsApi.access, enabled, staleTime: 5 * 60_000, retry: false })
}

export function useSurahs() {
  return useQuery({ queryKey: materialsKeys.surahs, queryFn: materialsApi.surahs, staleTime: Infinity })
}

export function useItems(q: ItemQuery) {
  return useQuery({ queryKey: materialsKeys.items(q), queryFn: () => materialsApi.items(q), staleTime: 10_000 })
}

export function useSaveItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ItemInput }) => (id ? materialsApi.update(id, body) : materialsApi.create(body)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...materialsKeys.all, 'items'] }),
  })
}

export function useRecitations() {
  return useQuery({ queryKey: materialsKeys.recitations, queryFn: materialsApi.recitations })
}

export function useRecitationMutations() {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: materialsKeys.recitations })
  return {
    create: useMutation({ mutationFn: materialsApi.createSource, onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Parameters<typeof materialsApi.updateSource>[1] }) => materialsApi.updateSource(id, body),
      onSuccess: refresh,
    }),
    setTrack: useMutation({
      mutationFn: ({ id, surah, body }: { id: string; surah: number; body: Parameters<typeof materialsApi.setTrack>[2] }) =>
        materialsApi.setTrack(id, surah, body),
      onSuccess: (data) => qc.setQueryData(materialsKeys.recitations, data),
    }),
  }
}

/** A child's memorization map. A refusal (not this viewer's child) hides the panel. */
export function useProgress(learnerId: string) {
  return useQuery({ queryKey: materialsKeys.progress(learnerId), queryFn: () => materialsApi.progress(learnerId), retry: false })
}

export function useSurahHistory(learnerId: string, surah: number | null) {
  return useQuery({
    queryKey: materialsKeys.history(learnerId, surah ?? 0),
    queryFn: () => materialsApi.history(learnerId, surah as number),
    enabled: surah !== null,
  })
}

export function useCorrectSurah(learnerId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ surah, status, reason }: { surah: number; status: MarkStatus; reason: string }) =>
      materialsApi.correct(learnerId, surah, { status, reason }),
    onSuccess: (data, v) => {
      qc.setQueryData(materialsKeys.history(learnerId, v.surah), data)
      void qc.invalidateQueries({ queryKey: materialsKeys.progress(learnerId), exact: true })
    },
  })
}
