import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { listTime } from '@/features/admin/copy'
import { Avatar } from '@/shared/components/Avatar'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { QueryBoundary } from '@/shared/components/States'
import { chatApi, chatKeys, type ChatConversation } from './chatApi'
import { chatCopyFor } from './copy'
import { conversationName } from './chatView'

/**
 * "Starred messages": the viewer's own bookmarks, newest star first, across
 * every conversation they may still read (the server drops the rest). Choosing
 * one opens its conversation.
 */
export function StarredDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (conversationId: string) => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const { staff } = useSession()
  const queryClient = useQueryClient()
  const conversations = queryClient.getQueryData<ChatConversation[]>(chatKeys.list) ?? []
  const nameOf = (id: string) => {
    const c = conversations.find((x) => x.id === id)
    return c ? conversationName(c, staff?.id, copy) : ''
  }

  const starred = useInfiniteQuery({
    queryKey: chatKeys.starred,
    queryFn: ({ pageParam }) => chatApi.starred(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  })
  const items = starred.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <Dialog
      title={copy.starredTitle}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {copy.close}
        </button>
      }
    >
      <QueryBoundary
        isLoading={starred.isLoading}
        error={starred.error}
        onRetry={() => void starred.refetch()}
        isEmpty={items.length === 0}
        emptyTitle={copy.starredEmpty}
        emptyIcon="star"
      >
        <ul className="cw-starred">
          {items.map((it) => {
            const m = it.message
            const author = m.authorId === staff?.id ? copy.you : m.authorDisplayName || (copy.role[m.authorKind] ?? '')
            return (
              <li key={m.id}>
                <button type="button" className="cw-starred__item" onClick={() => onOpen(it.conversationId)}>
                  <Avatar name={author || '?'} seed={m.authorId ?? m.authorKind} size="sm" src={m.authorAvatarUrl} />
                  <span className="cw-starred__main">
                    <span className="cw-starred__top">
                      <span className="cw-starred__who" dir="auto">{author}</span>
                      <span className="cw-starred__where" dir="auto">{nameOf(it.conversationId)}</span>
                      <time className="cw-starred__time" dateTime={m.createdAt}>{listTime(m.createdAt, locale)}</time>
                    </span>
                    <span className="cw-starred__body" dir="auto">
                      {m.body || (copy.preview[m.attachments[0]?.kind ?? m.type] ?? copy.attachment)}
                    </span>
                  </span>
                  <Icon name="star" size={14} />
                </button>
              </li>
            )
          })}
        </ul>
        {starred.hasNextPage && (
          <button type="button" className="btn btn--sm" disabled={starred.isFetchingNextPage} onClick={() => void starred.fetchNextPage()}>
            {copy.starredMore}
          </button>
        )}
      </QueryBoundary>
    </Dialog>
  )
}
