import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { lookupVerse, verseKey, type BoardPage, type VerseLookup, type VerseRef } from './board'
import { teacherBoardsApi, teacherBoardsKeys } from './api'

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
