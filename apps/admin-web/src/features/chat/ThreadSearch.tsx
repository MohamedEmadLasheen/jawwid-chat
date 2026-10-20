import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Icon } from '@/shared/components/Icon'
import { chatApi, chatKeys } from './chatApi'
import { chatCopyFor } from './copy'
import { searchable, useDebounced } from './search'

/**
 * Search inside one chat (owner decision 2026-10-20), like WhatsApp: a bar
 * under the header, the newest match first, arrows to step to older and newer
 * ones. Each step asks the thread to reveal that message -- loading older
 * history if it is not on screen yet. The server decides what matches and
 * returns only what this viewer may read.
 */
export function ThreadSearch({
  conversationId,
  query,
  onQuery,
  onReveal,
  onClose,
}: {
  conversationId: string
  query: string
  onQuery: (q: string) => void
  onReveal: (messageId: string) => void
  onClose: () => void
}) {
  const { locale, number } = useI18n()
  const copy = chatCopyFor(locale)
  const settled = useDebounced(query.trim())
  const ok = searchable(settled)
  // Pages of 50, newest first; stepping past the last loaded hit fetches the next.
  const results = useInfiniteQuery({
    queryKey: chatKeys.search(conversationId, settled),
    queryFn: ({ pageParam }) => chatApi.search(conversationId, settled, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: ok,
    staleTime: 30_000,
  })
  const hits = ok ? results.data?.pages.flatMap((p) => p.hits) ?? [] : []
  const more = ok && results.hasNextPage
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  // A new answer starts again at the newest match and shows it.
  const first = hits[0]?.id
  useEffect(() => {
    setIndex(0)
    if (first) onReveal(first)
    // Only a new first hit re-reveals; onReveal changes every render.
  }, [first, settled])

  const step = async (delta: 1 | -1) => {
    if (hits.length === 0) return
    let all = hits
    // Older than everything loaded: fetch the next page first.
    if (delta === 1 && index >= all.length - 1 && more && !results.isFetchingNextPage) {
      const fetched = await results.fetchNextPage()
      all = fetched.data?.pages.flatMap((p) => p.hits) ?? all
    }
    const next = Math.min(Math.max(index + delta, 0), all.length - 1)
    if (next === index) return
    setIndex(next)
    onReveal(all[next]!.id)
  }

  const status = !query.trim()
    ? ''
    : !searchable(query)
      ? copy.searchShort
      : results.isFetching && !results.data
        ? '…'
        : hits.length === 0
          ? copy.searchNone
          : copy.searchPosition(index + 1, hits.length, more)

  return (
    <div className="cw-search" role="search">
      <Icon name="search" size={16} />
      <input
        ref={input}
        className="cw-search__input"
        type="search"
        value={query}
        dir="auto"
        autoFocus
        placeholder={copy.searchPlaceholder}
        aria-label={copy.searchChat}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            void step(e.shiftKey ? -1 : 1)
          }
        }}
      />
      <span className="cw-search__status" role="status" aria-live="polite">
        {status.replace(/\d+/g, (d) => number(Number(d)))}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        aria-label={copy.searchOlder}
        title={copy.searchOlder}
        disabled={(index >= hits.length - 1 && !more) || results.isFetchingNextPage}
        onClick={() => void step(1)}
      >
        <Icon name="chevronUp" size={16} />
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        aria-label={copy.searchNewer}
        title={copy.searchNewer}
        disabled={index <= 0}
        onClick={() => void step(-1)}
      >
        <Icon name="chevronDown" size={16} />
      </button>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={copy.searchClose} title={copy.searchClose} onClick={onClose}>
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}
