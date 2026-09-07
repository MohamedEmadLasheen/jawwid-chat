import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { conversationApi, messageApi } from '@/core/api/conversations'
import { qk } from '@/core/api/queryKeys'
import { QueryBoundary } from '@/shared/components/States'

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

  return (
    <div className="search-results">
      <QueryBoundary isLoading={conversations.isLoading} error={conversations.error}>
        <>
          <h3 className="search-results__heading">{t('search.conversations')}</h3>
          <ul className="rows">
            {(conversations.data?.conversations ?? []).length === 0 && (
              <li className="empty">{t('search.none')}</li>
            )}
            {(conversations.data?.conversations ?? []).map((conversation) => (
              <li key={conversation.id}>
                <button type="button" className="row" onClick={() => onSelect(conversation.id)}>
                  <span className="row__title">{conversation.title ?? conversation.id}</span>
                  <span className="row__meta">{duration(conversation.lastActivityAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      </QueryBoundary>

      <QueryBoundary isLoading={messages.isLoading} error={messages.error}>
        <>
          <h3 className="search-results__heading">{t('search.messages')}</h3>
          <ul className="rows">
            {(messages.data?.hits ?? []).length === 0 && (
              <li className="empty">{t('search.none')}</li>
            )}
            {(messages.data?.hits ?? []).map((hit) => (
              <li key={hit.message.id}>
                <button
                  type="button"
                  className="row"
                  onClick={() => onSelect(hit.conversationId)}
                >
                  <span className="row__preview">{hit.message.body}</span>
                  <span className="row__meta">
                    <span>{hit.conversationTitle ?? ''}</span>
                    <span>{duration(hit.message.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      </QueryBoundary>
    </div>
  )
}
