import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ErrorState } from '@/shared/components/States'
import { Avatar } from '@/shared/components/Avatar'
import { Icon } from '@/shared/components/Icon'
import { useDebounced } from '@/shared/hooks/useDebounced'
import type { Conversation, Message } from '@/shared/types/conversation'
import { ConversationView, ThreadSkeleton } from './ConversationView'
import { ConversationComposer } from './ConversationComposer'
import { ConversationSearch } from './ConversationSearch'
import { ConversationModeration } from './ConversationModeration'
import { ConversationListItem, ConversationListSkeleton } from './ConversationListItem'
import { FamilyContextPanel } from './FamilyContextPanel'
import { titleOf } from './conversationDisplay'
import {
  useConversation,
  useConversationQueue,
  useConversationSubscription,
} from './hooks'

/**
 * THE COMMUNICATION WORKSPACE.
 *
 * Three zones, and the middle one is the product:
 *
 *   conversations  |  the conversation  |  family and student
 *
 * Communication is the primary experience and operations are layered around
 * it. That ordering is the whole design: the thread has the most space, the
 * best type and the only primary action on the screen; the list exists to
 * choose what to read next; the panel exists so a reply can be better
 * informed. Nothing in this file turns the middle zone back into a data grid.
 *
 * ## The two sections
 *
 * Membership is the SERVER's — `needsReply` is computed in the API's `dto.ts`
 * from the conversation's own clocks — and this screen only groups by it:
 *
 *   needs reply        the family spoke last and Jawwid has not answered
 *   waiting on family  Jawwid spoke last
 *
 * There is no attention score, no bucket, and no priority anywhere on this
 * screen, because the API computes none and the console invents none. Nothing
 * here filters for authorization reasons either: the list arrives scoped.
 *
 * ## Responsive
 *
 * `design-system.md` §9.1 — three panes at ≥ 1280, the family panel becomes a
 * drawer from 1024, and below 1024 it is one pane at a time with push
 * navigation. The breakpoints live in `console.css`; this component's only
 * responsibility is to know whether a conversation is selected, which is what
 * the one-pane layout switches on.
 */
export function ConsolePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { conversationId } = useParams<{ conversationId: string }>()

  const [section, setSection] = useState<'needs_reply' | 'waiting'>('needs_reply')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 300)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)

  /**
   * The context panel's open state, below the three-pane breakpoint.
   *
   * Above 1280 the panel is permanent and this flag does nothing — CSS decides
   * that, because the breakpoint belongs to the stylesheet. Below it, the
   * panel is a drawer, and it starts closed so that opening a conversation on
   * a narrow screen shows the conversation.
   */
  const [contextOpen, setContextOpen] = useState(false)

  const queue = useConversationQueue()
  const selected = useConversation(conversationId ?? null)

  // Join the room while the conversation is open; leave on close. The provider
  // re-subscribes after a reconnect, because rooms do not survive one.
  useConversationSubscription(conversationId ?? null)

  // A reply-quote belongs to the conversation it was raised in. Carrying it
  // across would attach a family's words to another family's reply.
  useEffect(() => {
    setReplyingTo(null)
    setContextOpen(false)
  }, [conversationId])

  const rows = section === 'needs_reply' ? queue.needsReply : queue.waiting
  const isSearching = debouncedQuery.trim().length >= 2

  return (
    <div
      className={
        conversationId ? 'workspace workspace--has-selection' : 'workspace'
      }
    >
      <ConversationListPane
        section={section}
        onSection={setSection}
        query={query}
        onQuery={setQuery}
        isSearching={isSearching}
        searchQuery={debouncedQuery.trim()}
        rows={rows}
        queue={queue}
        selectedId={conversationId ?? null}
        onSelect={(id) => navigate(`/console/${id}`)}
      />

      <section className="chat" aria-label={t('nav.conversation')}>
        {!conversationId && <ConsoleEmptyState />}

        {conversationId && selected.isPending && (
          // Header, thread and composer all appear as their own shapes: a
          // half-drawn screen tells an operator what is arriving, and a blank
          // one tells them the console is broken.
          <>
            <div className="chat__header" aria-hidden="true">
              <div
                className="skeleton"
                style={{ inlineSize: 40, blockSize: 40, borderRadius: 'var(--radius-full)' }}
              />
              <div className="skeleton skeleton-line" style={{ inlineSize: 180 }} />
            </div>
            <ThreadSkeleton />
          </>
        )}

        {conversationId && selected.error && (
          <ErrorState error={selected.error} onRetry={() => void selected.refetch()} />
        )}

        {conversationId && selected.data && (
          <>
            <ConversationHeader
              conversation={selected.data}
              onBack={() => navigate('/console')}
              onToggleContext={() => setContextOpen((open) => !open)}
            />
            <ConversationView conversation={selected.data} onReplyTo={setReplyingTo} />
            {/* Moderation sits between the thread and the composer: it is
                about a message that has not gone out yet, so it belongs where
                the operator is about to write the next one. */}
            <ConversationModeration conversationId={conversationId} />
            <ConversationComposer
              conversationId={conversationId}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
            />
          </>
        )}
      </section>

      {/*
        The panel is rendered only with a conversation open — there is no
        family to describe otherwise. Below 1280 it is a drawer, and it stays
        MOUNTED while closed so that toggling it does not refetch the family on
        every open.
      */}
      {selected.data && (
        <FamilyContextPanel
          conversation={selected.data}
          drawerOpen={contextOpen}
          onClose={() => setContextOpen(false)}
        />
      )}
    </div>
  )
}

function ConversationListPane({
  section,
  onSection,
  query,
  onQuery,
  isSearching,
  searchQuery,
  rows,
  queue,
  selectedId,
  onSelect,
}: {
  section: 'needs_reply' | 'waiting'
  onSection: (section: 'needs_reply' | 'waiting') => void
  query: string
  onQuery: (query: string) => void
  isSearching: boolean
  searchQuery: string
  rows: Conversation[]
  queue: ReturnType<typeof useConversationQueue>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { t } = useI18n()
  const searchRef = useRef<HTMLInputElement>(null)

  /**
   * `/` focuses search (§10, keyboard). Ignored while the operator is already
   * typing into something — a slash inside a reply is a slash, not a command.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const active = document.activeElement
      const isTyping =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      if (isTyping) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <section className="conv-list" aria-label={t('console.title')}>
      <div className="conv-list__header">
        <h1 className="conv-list__title">
          {t('console.title')}
          {queue.totalUnread > 0 && (
            <span className="conv-list__count">
              {t('conversation.unread', { count: String(queue.totalUnread) })}
            </span>
          )}
        </h1>

        <div className="conv-search">
          <span className="conv-search__icon">
            <Icon name="search" size={16} />
          </span>
          <input
            ref={searchRef}
            className="conv-search__input"
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={t('console.searchPlaceholder')}
            aria-label={t('console.searchPlaceholder')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onQuery('')
            }}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="conv-search__clear"
              aria-label={t('console.searchClear')}
              onClick={() => onQuery('')}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        {/*
          Both sections are always visible with their count, even at zero: a
          section that disappears when it empties reads as a bug, and the two
          counts together are the operator's whole workload at a glance.
        */}
        <div className="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={section === 'needs_reply'}
            className="segmented__option"
            onClick={() => onSection('needs_reply')}
          >
            {t('section.needsReply')}
            <span className="segmented__badge">{queue.needsReply.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'waiting'}
            className="segmented__option"
            onClick={() => onSection('waiting')}
          >
            {t('section.waiting')}
            <span className="segmented__badge">{queue.waiting.length}</span>
          </button>
        </div>
      </div>

      <div className="conv-list__scroll">
        {/*
          `isPending`, not `isLoading`. Between two retry attempts React Query
          reports `isLoading: false` with no data and no error yet, and a
          branch keyed on `isLoading` falls through that gap to the EMPTY
          state — an operator watching a failing request would be told their
          inbox is empty before being told it failed.
        */}
        {queue.isPending && <ConversationListSkeleton />}

        {!queue.isPending && queue.error && (
          <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
        )}

        {!queue.isPending && !queue.error && isSearching && (
          <ConversationSearch query={searchQuery} onSelect={onSelect} />
        )}

        {!queue.isPending && !queue.error && !isSearching && (
          <ul className="conv-rows">
            {rows.length === 0 && (
              <li className="empty">
                <div>
                  {section === 'needs_reply'
                    ? t('console.listEmpty.needsReply')
                    : t('console.listEmpty.waiting')}
                </div>
                <div style={{ marginBlockStart: 'var(--space-2)' }}>
                  {t('console.listEmpty.hint')}
                </div>
              </li>
            )}
            {rows.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                isSelected={conversation.id === selectedId}
                onSelect={() => onSelect(conversation.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/**
 * THE CONVERSATION HEADER — the component that carries risk R2.
 *
 * Line 1 names the conversation. Line 2 is the responsibility block, and its
 * rule (DD-02) is that the **Primary Owner is permanent**: whoever is handling
 * a conversation right now JOINS that line, never replaces it. This is the one
 * design mechanism that stops coverage reading as a transfer of ownership.
 *
 * What this console can honestly show today is the conversation's own state
 * and its membership; the Primary Owner is the family's supervisor, and it is
 * rendered in the family panel where the family record is actually loaded. The
 * header carries what belongs to the conversation, and does not restate it.
 */
function ConversationHeader({
  conversation,
  onBack,
  onToggleContext,
}: {
  conversation: Conversation
  onBack: () => void
  onToggleContext: () => void
}) {
  const { t } = useI18n()
  const members = conversation.members ?? []
  const isGroup =
    conversation.type === 'student_group' || conversation.type === 'class_group'

  return (
    <header className="chat__header">
      <button
        type="button"
        className="icon-btn chat__back"
        aria-label={t('console.back')}
        onClick={onBack}
      >
        <Icon name="back" size={18} />
      </button>

      <Avatar name={titleOf(conversation)} kind={isGroup ? 'group' : 'person'} />

      <div className="chat__identity">
        <div className="chat__title">
          {/* The full identity stays in `title`; the visible text truncates at
              its own logical end (see `.chat__title-name`). */}
          <span className="chat__title-name" title={titleOf(conversation)}>
            {titleOf(conversation)}
          </span>
          {/* Never state by colour alone: each chip carries its own words. */}
          {conversation.needsReply ? (
            <span className="chip chip--warning">{t('section.needsReply')}</span>
          ) : (
            <span className="chip">{t('section.waiting')}</span>
          )}
        </div>

        <div className="chat__responsibility">
          <span>{t(`conversation.${conversationKindKey(conversation)}` as 'conversation.direct')}</span>
          <span className="chat__responsibility-sep">·</span>
          <span>{t('conversation.members', { count: String(members.length) })}</span>
          {(conversation.teacherRequiresApproval || conversation.parentRequiresApproval) && (
            <>
              <span className="chat__responsibility-sep">·</span>
              <span className="chip chip--warning">{t('message.pendingApproval')}</span>
            </>
          )}
        </div>
      </div>

      <div className="chat__actions">
        <button
          type="button"
          className="icon-btn chat__context-toggle"
          aria-label={t('console.contextOpen')}
          title={t('console.contextOpen')}
          onClick={onToggleContext}
        >
          <Icon name="info" size={18} />
        </button>
      </div>
    </header>
  )
}

function conversationKindKey(conversation: Conversation): string {
  if (conversation.type === 'student_group') return 'group'
  if (conversation.type === 'class_group') return 'classGroup'
  if (conversation.type === 'official') return 'official'
  return 'direct'
}

/**
 * Nothing selected.
 *
 * Calm, and with no action button: the next thing to do is pick a conversation
 * from the list that is already on screen, and an operator does not create
 * conversations — families do. An empty state offering an action that does not
 * exist is worse than one offering none (§7.10).
 */
function ConsoleEmptyState() {
  const { t } = useI18n()
  return (
    <div className="chat-empty">
      <span className="chat-empty__mark">
        <Icon name="chat" size={32} />
      </span>
      <span className="chat-empty__title">{t('console.empty.title')}</span>
      <span className="chat-empty__hint">{t('console.empty.hint')}</span>
    </div>
  )
}
