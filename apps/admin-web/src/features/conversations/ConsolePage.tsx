import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import { useDebounced } from '@/shared/hooks/useDebounced'
import type { Conversation, Message } from '@/shared/types/conversation'
import { ConversationView } from './ConversationView'
import { ConversationComposer } from './ConversationComposer'
import { ConversationSearch } from './ConversationSearch'
import {
  useConversation,
  useConversationQueue,
  useConversationSubscription,
} from './hooks'

/**
 * THE COMMUNICATION OPERATIONS CONSOLE.
 *
 * A queue on the left, the selected conversation on the right — the shape the
 * previous inbox had, re-pointed at conversations instead of at a four-bucket
 * attention engine the API does not compute.
 *
 * The two sections are plain predicates over what the list already serves:
 *
 *   needs reply        the family spoke last and Jawwid has not answered
 *   waiting on family  Jawwid spoke last
 *
 * Membership is the SERVER's (`needsReply` is computed in `dto.ts` from the
 * conversation's own clocks); the console only groups by it. Nothing here
 * filters for authorization reasons — the list is already scoped.
 */
export function ConsolePage() {
  const { t, duration } = useI18n()
  const navigate = useNavigate()
  const { conversationId } = useParams<{ conversationId: string }>()

  const [section, setSection] = useState<'needs_reply' | 'waiting'>('needs_reply')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 300)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)

  const queue = useConversationQueue()
  const selected = useConversation(conversationId ?? null)

  // Join the room while the conversation is open; leave on close. The provider
  // re-subscribes after a reconnect, because rooms do not survive one.
  useConversationSubscription(conversationId ?? null)

  const rows = section === 'needs_reply' ? queue.needsReply : queue.waiting

  return (
    <div className="workspace">
      <section className="column column--list" aria-label={t('nav.console')}>
        <div className="column__header">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={section === 'needs_reply'}
              className="tab"
              onClick={() => setSection('needs_reply')}
            >
              {t('section.needsReply')} ({queue.needsReply.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === 'waiting'}
              className="tab"
              onClick={() => setSection('waiting')}
            >
              {t('section.waiting')} ({queue.waiting.length})
            </button>
          </div>

          <input
            className="field__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search.conversations')}
            aria-label={t('search.conversations')}
          />
        </div>

        <QueryBoundary isLoading={queue.isLoading} error={queue.error}>
          {debouncedQuery.trim().length >= 2 ? (
            <ConversationSearch
              query={debouncedQuery.trim()}
              onSelect={(id) => navigate(`/console/${id}`)}
            />
          ) : (
            <ul className="rows">
              {rows.length === 0 && <li className="empty">{t('section.empty')}</li>}
              {rows.map((conversation) => (
                <QueueRow
                  key={conversation.id}
                  conversation={conversation}
                  isSelected={conversation.id === conversationId}
                  duration={duration}
                  onSelect={() => navigate(`/console/${conversation.id}`)}
                />
              ))}
            </ul>
          )}
        </QueryBoundary>
      </section>

      <section className="column column--workspace" aria-label={t('nav.conversation')}>
        {!conversationId && <p className="empty">{t('console.selectPrompt')}</p>}

        {conversationId && (
          <QueryBoundary isLoading={selected.isLoading} error={selected.error}>
            {selected.data && (
              <>
                <ConversationHeader conversation={selected.data} />
                <ConversationView
                  conversation={selected.data}
                  onReplyTo={setReplyingTo}
                />
                <ConversationComposer
                  conversationId={conversationId}
                  replyingTo={replyingTo}
                  onCancelReply={() => setReplyingTo(null)}
                />
              </>
            )}
          </QueryBoundary>
        )}
      </section>
    </div>
  )
}

function ConversationHeader({ conversation }: { conversation: Conversation }) {
  const { t } = useI18n()
  const members = conversation.members ?? []

  return (
    <header className="column__header">
      <h2>
        {conversation.title ??
          members
            .map((m) => m.displayName)
            .filter(Boolean)
            .join('، ')}
      </h2>
      <div className="badges">
        {/* Never state by colour alone: each badge carries its own words. */}
        <Badge tone={conversation.needsReply ? 'coverage' : 'internal'}>
          {conversation.needsReply ? t('section.needsReply') : t('section.waiting')}
        </Badge>
        {conversation.type === 'student_group' && (
          <Badge tone="internal">{t('conversation.group')}</Badge>
        )}
        {(conversation.unreadCount ?? 0) > 0 && (
          <Badge tone="coverage">
            {t('conversation.unread', { count: String(conversation.unreadCount ?? 0) })}
          </Badge>
        )}
      </div>
    </header>
  )
}

function QueueRow({
  conversation,
  isSelected,
  duration,
  onSelect,
}: {
  conversation: Conversation
  isSelected: boolean
  duration: (iso: string) => string
  onSelect: () => void
}) {
  const members = conversation.members ?? []
  const title =
    conversation.title ??
    members
      .map((m) => m.displayName)
      .filter(Boolean)
      .join('، ')

  return (
    <li>
      <button
        type="button"
        className={isSelected ? 'row row--selected' : 'row'}
        aria-current={isSelected}
        onClick={onSelect}
      >
        <span className="row__title">{title}</span>
        {/*
          The preview is what the SERVER decided this operator may see: an
          internal note never appears as a family's preview for somebody who
          cannot read one, because the API picked the newest READABLE message.
        */}
        <span className="row__preview">{conversation.lastMessagePreview}</span>
        <span className="row__meta">
          <span>{duration(conversation.lastActivityAt)}</span>
          {(conversation.unreadCount ?? 0) > 0 && (
            <span className="row__unread">{conversation.unreadCount}</span>
          )}
        </span>
      </button>
    </li>
  )
}
