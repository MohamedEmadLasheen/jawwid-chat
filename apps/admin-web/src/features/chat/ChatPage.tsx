import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { ApiError } from '@/core/api/errors'
import { Badge } from '@/shared/components/Badge'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import { bySeq, chatApi, chatKeys, type ChatConversation, type ChatMessage } from './chatApi'
import { chatCopyFor, systemText, type ChatCopy } from './copy'
import { useChatRealtime } from './useChatRealtime'
import { VoiceNotePlayer, VoiceRecorder } from './VoiceRecorder'
import { ConversationCallControls } from '@/features/calls/ConversationCallControls'

function useCopy(): ChatCopy {
  const { locale } = useI18n()
  return chatCopyFor(locale)
}

/** A row's name: the group's own title, else the other members, else its kind. */
export function conversationName(c: ChatConversation, selfId: string | undefined, copy: ChatCopy): string {
  if (c.title) return c.title
  if (c.learner?.name) return c.learner.name
  const others = (c.members ?? []).filter((m) => m.actorId !== selfId && m.displayName)
  if (others.length > 0) return others.map((m) => m.displayName).join('، ')
  return copy.kind[c.type] ?? c.type
}

function errorText(error: unknown, locale: string, fallback: string): string {
  return error instanceof ApiError ? error.localized(locale as 'ar' | 'en') : fallback
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: ChatConversation[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const copy = useCopy()
  const { staff } = useSession()
  const { time } = useI18n()

  if (conversations.length === 0) return <EmptyState title={copy.empty} />

  return (
    <ul className="column__scroll" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label={copy.title}>
      {conversations.map((c) => {
        const unread = c.unreadCount ?? 0
        return (
          <li key={c.id}>
            <button
              type="button"
              className="row"
              aria-current={c.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(c.id)}
              style={{ width: '100%', textAlign: 'start' }}
            >
              <div className="row__top">
                <span className="row__name">{conversationName(c, staff?.id, copy)}</span>
                <span className="row__wait">{time(c.lastActivityAt)}</span>
              </div>
              <div className="row__meta">
                <span>{copy.kind[c.type] ?? c.type}</span>
                {c.needsReply && <Badge tone="now">{copy.needsReply}</Badge>}
                {unread > 0 && (
                  <span className="rail__count" aria-label={copy.unread(unread)}>
                    {unread}
                  </span>
                )}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

interface PendingSend {
  clientMessageId: string
  body: string
  visibility: 'customer' | 'internal'
  status: 'sending' | 'failed'
  error?: unknown
}

function MessageView({
  message,
  selfId,
  approvalId,
  onDecided,
}: {
  message: ChatMessage
  selfId: string | undefined
  /** Present when this held message is in the caller's approval queue. */
  approvalId?: string
  onDecided?: () => void
}) {
  const copy = useCopy()
  const { time, locale } = useI18n()
  const [deciding, setDeciding] = useState(false)
  const [decisionError, setDecisionError] = useState<unknown>(null)

  async function decide(approve: boolean) {
    if (!approvalId) return
    let reason = ''
    if (!approve) {
      reason = window.prompt(copy.rejectReason)?.trim() ?? ''
      if (!reason) return
    }
    setDeciding(true)
    setDecisionError(null)
    try {
      await (approve ? chatApi.approve(approvalId) : chatApi.reject(approvalId, reason))
      onDecided?.()
    } catch (e) {
      setDecisionError(e)
    } finally {
      setDeciding(false)
    }
  }
  const kind =
    message.visibility === 'internal' ? 'internal'
    : message.authorKind === 'system' ? 'system'
    : message.authorKind === 'staff' ? 'staff'
    : 'contact'
  const author = message.authorId === selfId ? null : message.authorDisplayName
  const role = copy.role[message.authorKind] ?? message.authorKind

  return (
    <article className={`msg msg--${kind}`} data-seq={message.seq ?? undefined}>
      {kind === 'internal' && (
        <div className="msg__meta">
          <Badge tone="internal">{copy.internal}</Badge>
        </div>
      )}
      <div className="msg__bubble">
        {message.deletedForAll ? (
          <em>{copy.deleted}</em>
        ) : kind === 'system' ? (
          systemText(message.body, copy)
        ) : (
          message.body
        )}
        {!message.deletedForAll &&
          message.attachments.map((a) =>
            a.kind === 'voice' || a.mimeType?.startsWith('audio/') ? (
              <VoiceNotePlayer key={a.id} url={a.url} durationMs={a.durationMs} copy={copy} />
            ) : a.url ? (
              <div key={a.id}>
                <a href={a.url} target="_blank" rel="noreferrer">
                  📎 {a.originalName ?? copy.attachment}
                </a>
              </div>
            ) : (
              <div key={a.id}>📎 {copy.attachment}</div>
            ),
          )}
      </div>
      <div className="msg__meta">
        {author && <span>{author}</span>}
        <span>{role}</span>
        <span>{time(message.createdAt)}</span>
        {message.moderation === 'pending' && <Badge tone="waiting">{copy.pending}</Badge>}
        {message.moderation === 'rejected' && <Badge tone="danger">{copy.rejected}</Badge>}
        {message.moderation === 'pending' && approvalId && (
          <>
            <button type="button" className="btn btn--sm btn--primary" disabled={deciding} onClick={() => void decide(true)}>
              {copy.approve}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" disabled={deciding} onClick={() => void decide(false)}>
              {copy.reject}
            </button>
          </>
        )}
        {decisionError !== null && (
          <span role="alert">{errorText(decisionError, locale, copy.decisionFailed)}</span>
        )}
      </div>
    </article>
  )
}

/**
 * One conversation. Mounted with `key={conversationId}`, so switching threads
 * starts from a clean state -- no older pages, pending sends or read watermark
 * of one conversation can leak into the next.
 */
function ThreadPane({ conversationId }: { conversationId: string }) {
  const copy = useCopy()
  const { locale } = useI18n()
  const { staff } = useSession()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const details = useQuery({
    queryKey: chatKeys.conversation(conversationId),
    queryFn: () => chatApi.get(conversationId),
  })
  // The newest page is the live part: every realtime event re-reads it, so a
  // new message, a deletion or a late approval (which keeps its ORIGINAL seq)
  // all arrive the same way.
  const latest = useQuery({
    queryKey: chatKeys.messages(conversationId),
    queryFn: () => chatApi.messages(conversationId),
    // Safety net: a socket emit has no acknowledgement, and a delivery the
    // server refuses to risk is dropped rather than sent unchecked. The next
    // event heals it; this bounds how long it can stay unhealed without one.
    refetchInterval: 60_000,
  })
  // Held messages this admin may act on. The queue is server-filtered to
  // conversations in the caller's charge; whether they may DECIDE is asked of
  // the server when they press the button.
  const approvals = useQuery({
    queryKey: chatKeys.approvals(conversationId),
    queryFn: () => chatApi.pendingApprovals(conversationId),
  })
  const approvalFor = useMemo(
    () => new Map((approvals.data ?? []).map((a) => [a.messageId, a.approvalId])),
    [approvals.data],
  )
  const afterDecision = () => {
    void queryClient.invalidateQueries({ queryKey: chatKeys.approvals(conversationId) })
    void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) })
  }
  const [older, setOlder] = useState<ChatMessage[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [pending, setPending] = useState<PendingSend[]>([])

  const messages = useMemo(() => {
    const byId = new Map<string, ChatMessage>()
    for (const m of older) byId.set(m.id, m)
    for (const m of latest.data?.messages ?? []) byId.set(m.id, m) // the newest read wins
    return [...byId.values()].sort(bySeq)
  }, [older, latest.data])

  // A pending send disappears once the server's copy (same clientMessageId) is
  // in the thread: one message, never an echo plus a copy.
  const delivered = useMemo(
    () => new Set(messages.map((m) => m.clientMessageId).filter((x): x is string => !!x)),
    [messages],
  )
  const shownPending = pending.filter((p) => !delivered.has(p.clientMessageId))

  const cursor = olderCursor === undefined ? latest.data?.nextBefore ?? null : olderCursor

  async function loadOlder() {
    if (!cursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const page = await chatApi.messages(conversationId, cursor)
      setOlder((prev) => [...page.messages, ...prev])
      setOlderCursor(page.nextBefore)
    } finally {
      setLoadingOlder(false)
    }
  }

  // Read state: report the newest seq actually on screen, once per new seq --
  // and only while the page is visible. A tab in the background has not "read"
  // anything; it reports when it comes back into view.
  const newestSeq = messages.length > 0 ? messages[messages.length - 1]!.seq : null
  const reported = useRef<string | null>(null)
  useEffect(() => {
    const report = () => {
      if (!newestSeq || reported.current === newestSeq) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      reported.current = newestSeq
      void chatApi
        .markRead(conversationId, newestSeq)
        .then(() => queryClient.invalidateQueries({ queryKey: chatKeys.list }))
        .catch(() => {
          reported.current = null // try again on the next change
        })
    }
    report()
    document.addEventListener('visibilitychange', report)
    return () => document.removeEventListener('visibilitychange', report)
  }, [conversationId, newestSeq, queryClient])

  // Open at the newest message, and follow new ones while the reader is at the
  // bottom; someone scrolled up into history is left where they are.
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const lastCount = useRef(0)
  useEffect(() => {
    const el = scroller.current
    const count = messages.length + shownPending.length
    if (el && count !== lastCount.current && (atBottom.current || lastCount.current === 0)) {
      el.scrollTop = el.scrollHeight
    }
    lastCount.current = count
  }, [messages.length, shownPending.length])

  const send = useMutation({
    mutationFn: (p: PendingSend) =>
      chatApi.send(conversationId, { body: p.body, clientMessageId: p.clientMessageId, visibility: p.visibility }),
    onSuccess: async (_saved, p) => {
      await queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) })
      setPending((all) => all.filter((x) => x.clientMessageId !== p.clientMessageId))
      void queryClient.invalidateQueries({ queryKey: chatKeys.list })
    },
    onError: (error, p) => {
      // Never left looking sent: it stays visibly failed with the server's
      // reason until the admin retries (same id, so no duplicate) or discards.
      setPending((all) =>
        all.map((x) => (x.clientMessageId === p.clientMessageId ? { ...x, status: 'failed', error } : x)),
      )
    },
  })

  function submit(body: string, visibility: 'customer' | 'internal') {
    const p: PendingSend = { clientMessageId: crypto.randomUUID(), body, visibility, status: 'sending' }
    setPending((all) => [...all, p])
    send.mutate(p)
  }

  function retry(p: PendingSend) {
    const again = { ...p, status: 'sending' as const, error: undefined }
    setPending((all) => all.map((x) => (x.clientMessageId === p.clientMessageId ? again : x)))
    send.mutate(again)
  }

  if (latest.isLoading) return <LoadingState />
  if (latest.error) return <ErrorState error={latest.error} onRetry={() => void latest.refetch()} />

  const conv = details.data

  return (
    <div className="column column--center">
      <div className="column__header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
        <strong>{conv ? conversationName(conv, staff?.id, copy) : ''}</strong>
        {conv?.members && (
          <span className="row__meta" aria-label={copy.members}>
            {conv.members.map((m) => `${m.displayName} (${copy.role[m.actorKind] ?? m.actorKind})`).join(' · ')}
          </span>
        )}
        {conv && (
          <ConversationCallControls
            conversationId={conversationId}
            peerLabel={conversationName(conv, staff?.id, copy)}
            isGroup={conv.type !== 'direct'}
          />
        )}
      </div>

      <div
        className="column__scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        <div className="thread" aria-live="polite">
          {cursor && (
            <button type="button" className="btn btn--sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {copy.loadOlder}
            </button>
          )}
          {messages.length === 0 && shownPending.length === 0 && <EmptyState title={copy.noMessages} />}
          {messages.map((m) => (
            <MessageView
              key={m.id}
              message={m}
              selfId={staff?.id}
              approvalId={approvalFor.get(m.id)}
              onDecided={afterDecision}
            />
          ))}
          {shownPending.map((p) => (
            <article
              key={p.clientMessageId}
              className={`msg ${p.visibility === 'internal' ? 'msg--internal' : 'msg--staff'}`}
              data-pending={p.status}
            >
              <div className="msg__bubble" style={{ opacity: p.status === 'sending' ? 0.6 : 1 }}>
                {p.body}
              </div>
              <div className="msg__meta">
                {p.status === 'sending' ? (
                  <span>{copy.sending}</span>
                ) : (
                  <>
                    <Badge tone="danger">{copy.failed}</Badge>
                    <span role="alert">{errorText(p.error, locale, copy.offline)}</span>
                    <button type="button" className="btn btn--sm" onClick={() => retry(p)}>
                      {copy.retry}
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => setPending((all) => all.filter((x) => x.clientMessageId !== p.clientMessageId))}
                    >
                      {copy.discard}
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      <ChatComposer
        onSend={submit}
        conversationId={conversationId}
        autoStartVoice={searchParams.get('voice') === '1'}
        onVoiceAutoStarted={() => setSearchParams({}, { replace: true })}
        onVoiceSent={() => void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) })}
      />
    </div>
  )
}

function ChatComposer({
  onSend,
  conversationId,
  autoStartVoice,
  onVoiceAutoStarted,
  onVoiceSent,
}: {
  onSend: (body: string, visibility: 'customer' | 'internal') => void
  conversationId: string
  autoStartVoice: boolean
  onVoiceAutoStarted: () => void
  onVoiceSent: () => void
}) {
  const copy = useCopy()
  const { locale } = useI18n()
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState<'customer' | 'internal'>('customer')
  const isInternal = visibility === 'internal'

  function submit() {
    const text = body.trim()
    if (!text) return
    onSend(text, visibility)
    setBody('')
  }

  return (
    <div className="composer">
      <div className="composer__tabs">
        <button type="button" className="composer__tab" aria-pressed={!isInternal} onClick={() => setVisibility('customer')}>
          {copy.customer}
        </button>
        <button
          type="button"
          className="composer__tab composer__tab--internal"
          aria-pressed={isInternal}
          onClick={() => setVisibility('internal')}
        >
          {copy.internal}
        </button>
      </div>
      <textarea
        className={isInternal ? 'composer__input composer__input--internal' : 'composer__input'}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={isInternal ? copy.internalPlaceholder : copy.placeholder}
        aria-label={isInternal ? copy.internal : copy.customer}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="composer__actions">
        <VoiceRecorder
          conversationId={conversationId}
          visibility={visibility}
          copy={copy}
          locale={locale}
          autoStart={autoStartVoice}
          onAutoStarted={onVoiceAutoStarted}
          onSent={onVoiceSent}
        />
        <button type="button" className="btn btn--primary" disabled={!body.trim()} onClick={submit}>
          {copy.send}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * The admin's chat workspace: the same conversations, through the same API, as
 * the parent and teacher apps. What appears in the list is exactly what the
 * server will let this admin open (staff scope); nothing here filters or widens
 * it.
 */
export function ChatPage() {
  const copy = useCopy()
  const navigate = useNavigate()
  const { conversationId } = useParams<{ conversationId: string }>()
  const { state } = useRealtime()

  const list = useQuery({
    queryKey: chatKeys.list,
    queryFn: chatApi.list,
    // A covering admin who is not a member receives no membership event for a
    // brand-new conversation of a family they cover; a slow poll is the
    // fallback for that one case. Everything else arrives by realtime.
    refetchInterval: 60_000,
  })
  const conversations = list.data ?? []
  useChatRealtime(useMemo(() => conversations.map((c) => c.id), [conversations]))

  return (
    <>
      <div className="column column--list">
        <div className="column__header">
          <strong>{copy.title}</strong>
        </div>
        {state !== 'connected' && (
          <div className="banner banner--warn" role="status">
            {copy.offline}
          </div>
        )}
        {list.isLoading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <ConversationList
            conversations={conversations}
            selectedId={conversationId ?? null}
            onSelect={(id) => navigate(`/chat/${encodeURIComponent(id)}`)}
          />
        )}
      </div>
      {conversationId ? (
        <ThreadPane key={conversationId} conversationId={conversationId} />
      ) : (
        <div className="column column--center">
          <EmptyState title={copy.pick} />
        </div>
      )}
    </>
  )
}
