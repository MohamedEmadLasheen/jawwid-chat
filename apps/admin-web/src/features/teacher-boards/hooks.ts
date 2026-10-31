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

/** The pickers' teachers, under a whiteboard key (not the supervision directory's). Names only: not logged. */
export function useBoardTeachers() {
  return useQuery({ queryKey: teacherBoardsKeys.teachers, queryFn: teacherBoardsApi.teachers, staleTime: 60_000, retry: false })
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

/** An image is kept no larger than this on its long side: the page's own width. */
export const MAX_IMAGE_EDGE = 1920

/**
 * One image, from its signed URL (an <img> request: the storage origin is in
 * img-src), then kept at most [MAX_IMAGE_EDGE] on its long side: an 8,000 px
 * photo is not held at full size (review of #336).
 */
async function loadImage(url: string): Promise<CanvasImageSource> {
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('image not loaded'))
    img.src = url
  })
  const long = Math.max(img.naturalWidth, img.naturalHeight)
  if (long <= MAX_IMAGE_EDGE || typeof createImageBitmap !== 'function') return img
  const k = MAX_IMAGE_EDGE / long
  const bitmap = await createImageBitmap(img, {
    resizeWidth: Math.max(1, Math.round(img.naturalWidth * k)),
    resizeHeight: Math.max(1, Math.round(img.naturalHeight * k)),
    resizeQuality: 'high',
  })
  img.src = '' // the full-size decode is let go
  return bitmap
}

/**
 * PR-4: the board's images, from the signed URLs the board answer carried,
 * loaded only when the page on view names them (`wanted`), once each. One that
 * fails, or is not among the board's signed images, shows as unavailable; a
 * URL that has run out does too, and opening the board again signs anew (and
 * is logged, as every open is).
 *
 * Under StrictMode an effect is cleaned up and run again (review of #336):
 * a load once started is never abandoned by a cleanup, only by the viewer
 * closing, so the second run finds it in flight and the answer still lands.
 */
export function useBoardImages(assets: BoardAssetJson[] | undefined, wanted: Iterable<string>): (assetId: string) => ImageLookup {
  const [loaded, setLoaded] = useState<Record<string, ImageLookup>>({})
  const started = useRef(new Set<string>())
  const open = useRef(true)
  useEffect(() => {
    open.current = true
    return () => {
      open.current = false
    }
  }, [])
  const want = [...new Set([...wanted].map((id) => id.toLowerCase()))].sort().join(',')
  useEffect(() => {
    const byId = new Map((assets ?? []).map((a) => [a.id.toLowerCase(), a]))
    for (const id of want ? want.split(',') : []) {
      const a = byId.get(id)
      if (!a || started.current.has(id)) continue
      started.current.add(id)
      loadImage(a.url).then(
        (source) => open.current && setLoaded((s) => ({ ...s, [id]: { status: 'ready', source } })),
        () => open.current && setLoaded((s) => ({ ...s, [id]: { status: 'unavailable' } })),
      )
    }
  }, [assets, want])
  const known = useMemo(() => new Set((assets ?? []).map((a) => a.id.toLowerCase())), [assets])
  return useCallback(
    (assetId: string): ImageLookup => loaded[assetId] ?? (known.has(assetId) ? { status: 'loading' } : { status: 'unavailable' }),
    [loaded, known],
  )
}
