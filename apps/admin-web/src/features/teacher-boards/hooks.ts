import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { lookupVerse, verseKey, type BoardPage, type VerseLookup, type VerseRef } from './board'
import { teacherBoardsApi, teacherBoardsKeys, type BoardAssetJson } from './api'
import type { ImageLookup } from './render'

/**
 * Every read here is logged by the server (§10 1c), so none is repeated behind
 * the reader's back: no refetch on focus or reconnect, nothing kept once the
 * page is left. An open is one row in the access history, not ten.
 */
const LOGGED = { refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: Infinity, gcTime: 0, retry: false } as const

export function useTeacherBoards(teacherId: string | null) {
  return useQuery({
    queryKey: teacherBoardsKeys.list(teacherId ?? ''),
    queryFn: () => teacherBoardsApi.list(teacherId as string),
    enabled: !!teacherId,
    ...LOGGED,
  })
}

export function useTeacherBoard(boardId: string) {
  return useQuery({ queryKey: teacherBoardsKeys.board(boardId), queryFn: () => teacherBoardsApi.board(boardId), ...LOGGED })
}

/** Asked for only when the reader opens it: reading the history is itself logged. */
export function useAccessLog(boardId: string, enabled: boolean) {
  return useQuery({ queryKey: teacherBoardsKeys.accessLog(boardId), queryFn: () => teacherBoardsApi.accessLog(boardId), enabled, ...LOGGED })
}

export function useCopyBoard(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ teacherId, key }: { teacherId: string; key: string }) => teacherBoardsApi.copy(boardId, teacherId, key),
    onSuccess: () => client.invalidateQueries({ queryKey: teacherBoardsKeys.accessLog(boardId) }),
  })
}

/**
 * The texts of a page's verses, one request per range, each checked against
 * its reference before it may be drawn (board.ts lookupVerse): a text that is
 * not exactly the range is unavailable, a changed SHA-256 is "changed", and a
 * dataset that cannot be reached shows no text at all -- never a fallback.
 */
export function useVerseTexts(page: BoardPage | null): (ref: VerseRef) => VerseLookup {
  const refs = useMemo(() => {
    const byKey = new Map<string, VerseRef>()
    for (const e of page?.elements ?? []) if (e.kind === 'verse') byKey.set(verseKey(e.ref), e.ref)
    return [...byKey.values()]
  }, [page])
  const results = useQueries({
    queries: refs.map((ref) => ({
      queryKey: teacherBoardsKeys.verse(verseKey(ref)),
      queryFn: () => teacherBoardsApi.ayahs(ref),
      staleTime: Infinity,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  })
  // A new function only when an answer arrives or fails: that, and nothing else, redraws the page.
  const settled = results.map((r) => `${r.status}:${r.dataUpdatedAt}`).join('|')
  return useMemo(() => {
    const byKey = new Map(refs.map((ref, i) => [verseKey(ref), results[i]]))
    return (ref: VerseRef) => {
      const r = byKey.get(verseKey(ref))
      return lookupVerse(ref, r?.data, !!r?.isError)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `settled` stands for `results`
  }, [refs, settled])
}

/**
 * PR-4: the board's images, loaded once each from the signed URLs the board
 * answer carried (an <img> request: the storage origin is in img-src). A URL
 * that has run out shows as unavailable; opening the board again signs anew
 * (and is logged, as every open is).
 */
export function useBoardImages(assets: BoardAssetJson[] | undefined): (assetId: string) => ImageLookup {
  const [loaded, setLoaded] = useState<Record<string, ImageLookup>>({})
  const started = useRef(new Set<string>())
  useEffect(() => {
    let live = true
    for (const a of assets ?? []) {
      const id = a.id.toLowerCase()
      if (started.current.has(id)) continue
      started.current.add(id)
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => live && setLoaded((s) => ({ ...s, [id]: { status: 'ready', source: img } }))
      img.onerror = () => live && setLoaded((s) => ({ ...s, [id]: { status: 'unavailable' } }))
      img.src = a.url
    }
    return () => {
      live = false
    }
  }, [assets])
  const known = useMemo(() => new Set((assets ?? []).map((a) => a.id.toLowerCase())), [assets])
  return useCallback(
    (assetId: string): ImageLookup => loaded[assetId] ?? (known.has(assetId) ? { status: 'loading' } : { status: 'unavailable' }),
    [loaded, known],
  )
}
