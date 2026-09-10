import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { conversationApi, messageApi } from '@/core/api/conversations'
import { qk } from '@/core/api/queryKeys'
import { ErrorState } from '@/shared/components/States'
import { ConversationListSkeleton } from './ConversationListItem'

/**
 * Search, across conversations and messages.
 *
 * EVERY result comes from the server. Nothing here filters a cached list:
 * filtering locally would look like search while silently covering only what
 * happened to be fetched — and it would be the beginnings of a client-side
 * directory, which this console is not allowed to assemble.
 *
 * The server scopes both queries to what this operator may read, so a message
 * in another supervisor's family is not a result that is hidden; it is not a
 * candidate at all.
 *
 * A result shows enough to tell two families apart — the conversation it is
 * in, the matched text, and when — and never a phone number: phone numbers are
 * not a search key and do not appear in a result (DQ-04).
 */
export function ConversationSearch({
  query,
  onSelect,
}: {
  query: string
  onSelect: (conversationId: string) => void
}) {
  const { t, duration } = useI18n()

  const conversations = useQuery({
    queryKey: qk.conversationSearch(query),
    queryFn: () => conversationApi.search(query),
    enabled: query.length >= 2,
  })

  const messages = useQuery({
    queryKey: qk.messageSearch({ q: query }),
    queryFn: () => messageApi.search({ q: query }),
    enabled: query.length >= 2,
  })

  if (conversations.isPending && messages.isPending) {
    return <ConversationListSkeleton rows={4} />
  }

  const conversationHits = conversations.data?.conversations ?? []
  const messageHits = messages.data?.hits ?? []

  return (
    <div className="search-results">
      <h3 className="search-results__heading">{t('search.conversations')}</h3>
      {conversations.error ? (
        <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />
      ) : conversationHits.length === 0 ? (
        <p className="empty">{t('search.none')}</p>
      ) : (
        <ul className="conv-rows">
          {conversationHits.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                className="search-hit"
                onClick={() => onSelect(conversation.id)}
              >
                <span className="search-hit__title">
                  {conversation.title ?? t('nav.conversation')}
                </span>
                <span className="search-hit__meta">
                  <span>{duration(conversation.lastActivityAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="search-results__heading">{t('search.messages')}</h3>
      {messages.error ? (
        <ErrorState error={messages.error} onRetry={() => void messages.refetch()} />
      ) : messageHits.length === 0 ? (
        <p className="empty">{t('search.none')}</p>
      ) : (
        <ul className="conv-rows">
          {messageHits.map((hit) => (
            <li key={hit.message.id}>
              <button
                type="button"
                className="search-hit"
                onClick={() => onSelect(hit.conversationId)}
              >
                <span className="search-hit__excerpt">{hit.message.body}</span>
                <span className="search-hit__meta">
                  <span>{hit.conversationTitle ?? ''}</span>
                  <span>{duration(hit.message.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
