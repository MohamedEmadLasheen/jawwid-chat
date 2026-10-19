import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { dayLabel } from '@/features/admin/copy'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { Menu, type MenuItem } from '@/shared/components/Menu'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import { bySeq, chatApi, chatKeys, type ChatAttachment, type ChatMessage, type UploadedAttachment } from './chatApi'
import { chatCopyFor, systemText, type ChatCopy } from './copy'
import { ChatComposer, type ComposerSend, type ReplyTarget } from './ChatComposer'
import { ConversationAvatar, conversationName, isGroup, isMuted } from './chatView'
import { useConversationPreferences } from './useChatActions'

/** The quick reactions, the same six as the mobile app. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

interface PendingSend {
  clientMessageId: string
  body: string
  visibility: 'customer' | 'internal'
  files: File[]
  replyToMessageId?: string
  /** Uploaded once; a retry re-sends the message without uploading again. */
  uploaded?: UploadedAttachment[]
  status: 'sending' | 'failed'
  error?: unknown
}

type Side = 'in' | 'out' | 'internal' | 'system'

/**
 * WhatsApp's rule: the viewer's own messages on the right, everyone else's --
 * parents, teachers and colleagues alike -- on the left, each under their
 * picture and name.
 */
function sideOf(m: ChatMessage, selfId: string | undefined): Side {
  if (m.visibility === 'internal') return 'internal'
  if (m.authorKind === 'system' || m.type === 'system') return 'system'
  return m.authorId === selfId ? 'out' : 'in'
}

/**
 * Who wrote it, shown at the start of each run of one sender's messages: the
 * picture beside the bubble and the name inside it ('lead'); later messages of
 * the run keep the picture's space so they stay aligned ('follow'). Never on
 * the viewer's own messages, and not in a 1:1 the viewer is part of, where the
 * other person is the header.
 */
type Identity = 'lead' | 'follow' | 'none'

/** One of eight name colours, stable per sender (as WhatsApp colours names in a group). */
function nameTone(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return (Math.abs(h) % 8) + 1
}

const SIDE_CLASS: Record<Side, string> = {
  in: 'bubble-row--contact',
  out: 'bubble-row--staff',
  internal: 'bubble-row--internal',
  system: 'bubble-row--system',
}

function errorText(error: unknown, locale: 'ar' | 'en', fallback: string): string {
  return error instanceof ApiError ? error.localized(locale) : fallback
}

function authorName(m: ChatMessage, copy: ChatCopy): string {
  return m.authorDisplayName || (copy.role[m.authorKind] ?? m.authorKind)
}

function bodyPreview(m: ChatMessage, copy: ChatCopy): string {
  if (m.deletedForAll) return copy.deleted
  if (m.body) return m.body
  const kind = m.attachments[0]?.kind ?? m.type
  return copy.preview[kind] ?? copy.attachment
}

/**
 * One conversation. Mounted with `key={conversationId}`, so switching threads
 * starts from a clean state -- no older pages, pending sends or read watermark
 * of one conversation can leak into the next.
 */
export function ChatThread({
  conversationId,
  backTo,
  infoShown,
  onToggleInfo,
}: {
  conversationId: string
  backTo: string
  infoShown: boolean
  onToggleInfo: () => void
}) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const { staff } = useSession()
  const queryClient = useQueryClient()
  const prefs = useConversationPreferences()

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
  const refreshThread = () => {
    void queryClient.invalidateQueries({ queryKey: chatKeys.approvals(conversationId) })
    void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) })
  }
  const [older, setOlder] = useState<ChatMessage[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [pending, setPending] = useState<PendingSend[]>([])
  const [reply, setReply] = useState<ReplyTarget | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)

  const messages = useMemo(() => {
    const byId = new Map<string, ChatMessage>()
    for (const m of older) byId.set(m.id, m)
    for (const m of latest.data?.messages ?? []) byId.set(m.id, m) // the newest read wins
    return [...byId.values()].sort(bySeq)
  }, [older, latest.data])
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])

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
    mutationFn: async (p: PendingSend) => {
      let uploaded = p.uploaded
      if (!uploaded && p.files.length > 0) {
        uploaded = await Promise.all(p.files.map((f) => chatApi.upload(conversationId, f, p.visibility)))
        setPending((all) => all.map((x) => (x.clientMessageId === p.clientMessageId ? { ...x, uploaded } : x)))
      }
      return chatApi.send(conversationId, {
        body: p.body,
        clientMessageId: p.clientMessageId,
        visibility: p.visibility,
        replyToMessageId: p.replyToMessageId,
        attachments: uploaded,
      })
    },
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

  function submit(input: ComposerSend) {
    const p: PendingSend = {
      clientMessageId: crypto.randomUUID(),
      body: input.body,
      visibility: input.visibility,
      files: input.files,
      replyToMessageId: reply?.messageId,
      status: 'sending',
    }
    setReply(null)
    setPending((all) => [...all, p])
    send.mutate(p)
  }

  function retry(p: PendingSend) {
    const again = { ...p, status: 'sending' as const, error: undefined }
    setPending((all) => all.map((x) => (x.clientMessageId === p.clientMessageId ? again : x)))
    send.mutate(again)
  }

  /** A message action that changes the thread: run it, then re-read the server's copy. */
  async function act(run: () => Promise<unknown>) {
    setActionError(null)
    try {
      await run()
    } catch (e) {
      setActionError(e)
    } finally {
      refreshThread()
    }
  }

  if (latest.isLoading) return <LoadingState />
  if (latest.error) return <ErrorState error={latest.error} onRetry={() => void latest.refetch()} />

  const conv = details.data
  const group = conv ? isGroup(conv) : false
  const name = conv ? conversationName(conv, staff?.id, copy) : ''
  const muted = conv ? isMuted(conv) : false
  const pinned = !!conv?.viewerState?.pinned
  const archived = !!conv?.viewerState?.archived
  const memberCount = conv?.members?.length ?? 0
  // A group always names its senders; so does a 1:1 the viewer is only
  // overseeing (two other people talking), but not one the viewer is in.
  const showsSenders = group || !(conv?.members ?? []).some((x) => x.actorId === staff?.id)

  return (
    <>
      <header className="thread-head">
        <Link to={backTo} className="btn btn--ghost btn--icon thread-head__back" aria-label={copy.back}>
          <Icon name="arrowBack" size={20} />
        </Link>
        {conv && (
          <button type="button" className="cw-head__who" onClick={onToggleInfo} aria-label={group ? copy.groupInfo : copy.contactInfo}>
            <ConversationAvatar c={conv} name={name} selfId={staff?.id} />
            <span className="thread-head__text">
              <span className="thread-head__name" dir="auto">{name}</span>
              <span className="thread-head__sub">
                {copy.kind[conv.type] ?? conv.type}
                {memberCount > 0 && ` · ${copy.membersCount(memberCount)}`}
              </span>
            </span>
          </button>
        )}
        <div className="cw-head__actions">
          {muted && (
            <span className="cw-row__mark" title={copy.mutedMark} aria-label={copy.mutedMark}>
              <Icon name="bellOff" size={16} />
            </span>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={onToggleInfo}
            aria-pressed={infoShown}
            aria-label={copy.info}
            title={copy.info}
          >
            <Icon name="panel" />
          </button>
          {conv && (
            <Menu
              label={copy.chatActions}
              items={[
                { key: 'info', label: group ? copy.groupInfo : copy.contactInfo, icon: 'info', onSelect: onToggleInfo },
                { key: 'mute', label: muted ? copy.unmute : copy.mute, icon: muted ? 'notifications' : 'bellOff', onSelect: () => prefs.mute(conv.id, !muted) },
                { key: 'pin', label: pinned ? copy.unpin : copy.pin, icon: 'pin', onSelect: () => prefs.pin(conv.id, !pinned) },
                { key: 'archive', label: archived ? copy.unarchive : copy.archive, icon: 'archive', onSelect: () => prefs.archive(conv.id, !archived) },
              ]}
            />
          )}
        </div>
      </header>

      <div
        className="thread-body"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {cursor && (
          <div className="cw-older">
            <button type="button" className="btn btn--sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {copy.loadOlder}
            </button>
          </div>
        )}
        {messages.length === 0 && shownPending.length === 0 ? (
          <EmptyState compact icon="conversations" title={copy.noMessages} />
        ) : (
          <ol className="athread" aria-live="polite">
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const newDay = !prev || dayLabel(prev.createdAt, locale) !== dayLabel(m.createdAt, locale)
              const side = sideOf(m, staff?.id)
              const runStart =
                newDay || !prev || prev.authorId !== m.authorId || sideOf(prev, staff?.id) !== side
              const identity: Identity =
                side === 'out' || side === 'system' || !showsSenders ? 'none' : runStart ? 'lead' : 'follow'
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <li className="athread__day">
                      <span>{dayLabel(m.createdAt, locale)}</span>
                    </li>
                  )}
                  <MessageItem
                    m={m}
                    side={side}
                    identity={identity}
                    runStart={runStart}
                    selfId={staff?.id}
                    canModerate={staff?.role === 'manager'}
                    quoted={m.replyToMessageId ? byId.get(m.replyToMessageId) ?? null : undefined}
                    approvalId={approvalFor.get(m.id)}
                    onDecided={refreshThread}
                    onReply={() =>
                      setReply({ messageId: m.id, author: m.authorId === staff?.id ? copy.you : authorName(m, copy), preview: bodyPreview(m, copy) })
                    }
                    onReact={(emoji) => {
                      const mine = m.reactions?.find((r) => r.actorId === staff?.id)
                      void act(() =>
                        mine?.emoji === emoji ? chatApi.unreact(conversationId, m.id) : chatApi.react(conversationId, m.id, emoji),
                      )
                    }}
                    onDeleteForMe={() => void act(() => chatApi.deleteForMe(conversationId, m.id))}
                    onDeleteForEveryone={() => void act(() => chatApi.deleteForEveryone(conversationId, m.id))}
                  />
                </Fragment>
              )
            })}
            {shownPending.map((p) => (
              <li
                key={p.clientMessageId}
                className={`bubble-row ${p.visibility === 'internal' ? 'bubble-row--internal' : 'bubble-row--staff'}`}
                data-pending={p.status}
              >
                <div className="bubble" style={{ opacity: p.status === 'sending' ? 0.6 : 1 }}>
                  {p.body && <span dir="auto">{p.body}</span>}
                  {p.files.map((f, i) => (
                    <span key={i} className="bubble__attachment">
                      <Icon name="paperclip" size={14} />
                      <span dir="auto">{f.name}</span>
                    </span>
                  ))}
                  <span className="bubble__meta">
                    {p.status === 'sending' ? (p.files.length > 0 && !p.uploaded ? copy.uploading : copy.sending) : null}
                  </span>
                </div>
                {p.status === 'failed' && (
                  <div className="cw-failed">
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
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {actionError !== null && (
        <div className="banner banner--warn cw-action-error" role="alert">
          {errorText(actionError, locale, copy.actionFailed)}
          <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={copy.discard} onClick={() => setActionError(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <ChatComposer onSend={submit} reply={reply} onCancelReply={() => setReply(null)} />
    </>
  )
}

function MessageItem({
  m,
  side,
  identity,
  runStart,
  selfId,
  canModerate,
  quoted,
  approvalId,
  onDecided,
  onReply,
  onReact,
  onDeleteForMe,
  onDeleteForEveryone,
}: {
  m: ChatMessage
  side: Side
  identity: Identity
  runStart: boolean
  selfId: string | undefined
  canModerate: boolean
  /** The message this one replies to: the message, null when it is not loaded, undefined when it is no reply. */
  quoted: ChatMessage | null | undefined
  approvalId?: string
  onDecided: () => void
  onReply: () => void
  onReact: (emoji: string) => void
  onDeleteForMe: () => void
  onDeleteForEveryone: () => void
}) {
  const { locale, time } = useI18n()
  const copy = chatCopyFor(locale)
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
      onDecided()
    } catch (e) {
      setDecisionError(e)
    } finally {
      setDeciding(false)
    }
  }

  if (side === 'system') {
    return (
      <li className="bubble-row bubble-row--system">
        <span className="sys-pill">
          {systemText(m.body, copy)}
          <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
        </span>
      </li>
    )
  }

  const mine = m.authorId === selfId
  const live = !m.deletedForAll
  const reactions = summarize(m.reactions ?? [], selfId)
  const items: MenuItem[] = live
    ? [
        { key: 'reply', label: copy.reply, icon: 'reply', onSelect: onReply },
        ...(m.body
          ? [{ key: 'copy', label: copy.copy, icon: 'copy' as const, onSelect: () => void navigator.clipboard?.writeText(m.body ?? '') }]
          : []),
        { key: 'delete-me', label: copy.deleteForMe, icon: 'trash', onSelect: onDeleteForMe },
        // The server allows it to the author within the window, or a manager; it answers anyone else.
        ...(mine || canModerate
          ? [{ key: 'delete-all', label: copy.deleteForEveryone, icon: 'trash' as const, danger: true, onSelect: onDeleteForEveryone }]
          : []),
      ]
    : [{ key: 'delete-me', label: copy.deleteForMe, icon: 'trash', onSelect: onDeleteForMe }]

  return (
    <li
      className={`bubble-row ${SIDE_CLASS[side]} cw-msg${runStart ? ' cw-msg--run-start' : ''}${identity !== 'none' ? ' cw-msg--with-sender' : ''}`}
      data-seq={m.seq ?? undefined}
    >
      <div className="cw-msg__line">
        {identity === 'lead' && (
          <span className={`cw-msg__avatar cw-tone--${nameTone(m.authorId ?? m.authorKind)}`} title={authorName(m, copy)}>
            <Avatar name={authorName(m, copy)} seed={m.authorId ?? m.authorKind} src={m.authorAvatarUrl} />
          </span>
        )}
        {identity === 'follow' && <span className="cw-msg__avatar" aria-hidden="true" />}
        <div className="bubble">
          {identity === 'lead' && (
            <span className="cw-sender">
              <span className={`cw-sender__name cw-sender__name--${nameTone(m.authorId ?? m.authorKind)}`} dir="auto">
                {authorName(m, copy)}
              </span>
              <span className={`kind-chip kind-chip--${m.authorKind}`}>{copy.role[m.authorKind] ?? m.authorKind}</span>
            </span>
          )}
          {side === 'internal' && (
            <span className="bubble__flag">
              <Icon name="lock" size={12} />
              {copy.internal}
            </span>
          )}
          {quoted !== undefined && live && (
            <div className="cw-quote cw-quote--inline">
              <span className="cw-quote__author" dir="auto">
                {quoted ? (quoted.authorId === selfId ? copy.you : authorName(quoted, copy)) : copy.quotedMissing}
              </span>
              {quoted && <span className="cw-quote__text" dir="auto">{bodyPreview(quoted, copy)}</span>}
            </div>
          )}
          {m.deletedForAll ? (
            <em className="bubble__deleted">{copy.deleted}</em>
          ) : (
            <>
              {m.attachments.map((a) => (
                <AttachmentView key={a.id} a={a} copy={copy} />
              ))}
              {m.body && <span dir="auto">{m.body}</span>}
            </>
          )}
          <span className="bubble__meta">
            {m.moderation === 'pending' && <Badge tone="waiting">{copy.pending}</Badge>}
            {m.moderation === 'rejected' && <Badge tone="danger">{copy.rejected}</Badge>}
            <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
          </span>
        </div>
        <Menu
          label={copy.messageActions}
          className="cw-msg__menu"
          align={side === 'out' ? 'end' : 'start'}
          items={items}
          header={
            live
              ? (close) => (
                  <div className="cw-react-row" role="group" aria-label={copy.react}>
                    {QUICK_REACTIONS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        className="cw-react-row__emoji"
                        aria-label={`${copy.react} ${e}`}
                        aria-pressed={reactions.find((r) => r.emoji === e)?.mine ?? false}
                        onClick={() => {
                          close()
                          onReact(e)
                        }}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )
              : undefined
          }
        />
      </div>
      {reactions.length > 0 && (
        <div className="cw-reactions">
          {reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              className={r.mine ? 'cw-reaction cw-reaction--mine' : 'cw-reaction'}
              aria-pressed={r.mine}
              aria-label={`${r.emoji} ${r.count}`}
              onClick={() => onReact(r.emoji)}
            >
              {r.emoji} {r.count > 1 && <span>{r.count}</span>}
            </button>
          ))}
        </div>
      )}
      {m.moderation === 'pending' && approvalId && (
        <div className="cw-decide">
          <button type="button" className="btn btn--sm btn--primary" disabled={deciding} onClick={() => void decide(true)}>
            {copy.approve}
          </button>
          <button type="button" className="btn btn--sm btn--ghost" disabled={deciding} onClick={() => void decide(false)}>
            {copy.reject}
          </button>
          {decisionError !== null && <span role="alert">{errorText(decisionError, locale, copy.decisionFailed)}</span>}
        </div>
      )}
    </li>
  )
}

function summarize(reactions: Array<{ actorId: string; emoji: string }>, selfId: string | undefined) {
  const out = new Map<string, { emoji: string; count: number; mine: boolean }>()
  for (const r of reactions) {
    const e = out.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false }
    e.count += 1
    if (r.actorId === selfId) e.mine = true
    out.set(r.emoji, e)
  }
  return [...out.values()]
}

function AttachmentView({ a, copy }: { a: ChatAttachment; copy: ChatCopy }) {
  if (!a.url) {
    return (
      <span className="bubble__attachment">
        <Icon name="paperclip" size={14} />
        {copy.preview[a.kind] ?? copy.attachment}
      </span>
    )
  }
  if (a.kind === 'image') {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="cw-media">
        <img src={a.thumbnailUrl ?? a.url} alt={a.originalName ?? copy.preview.image ?? ''} loading="lazy" />
      </a>
    )
  }
  if (a.kind === 'video') return <video className="cw-media" src={a.url} controls preload="metadata" />
  if (a.kind === 'voice') return <audio className="cw-audio" src={a.url} controls preload="metadata" />
  return (
    <a href={a.url} target="_blank" rel="noreferrer" className="bubble__attachment">
      <Icon name="paperclip" size={14} />
      <span dir="auto">{a.originalName ?? copy.attachment}</span>
    </a>
  )
}
