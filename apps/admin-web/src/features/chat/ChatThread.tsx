import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { EDIT_WINDOW_MS, bySeq, chatApi, chatKeys, type ChatAttachment, type ChatConversation, type ChatMessage, type UploadedAttachment } from './chatApi'
import { chatCopyFor, systemText, type ChatCopy } from './copy'
import { ChatComposer, type ComposerSend, type EditTarget, type ReplyTarget } from './ChatComposer'
import { PaymentLockBanner } from '@/features/subscriptions/PaymentLockBanner'
import { ForwardDialog } from './ForwardDialog'
import { LabelChip, LabelsDialog } from './LabelsDialog'
import { ExportDialog } from './ExportDialog'
import { ThemeDialog } from './ThemeDialog'
import { ThreadSearch } from './ThreadSearch'
import { Highlighted, searchable } from './search'
import { ConversationAvatar, conversationName, isGroup, isMuted } from './chatView'
import { useConversationPreferences } from './useChatActions'
import { VoiceNotePlayer } from './VoiceRecorder'
import { ConversationCallControls } from '@/features/calls/ConversationCallControls'
import { useCallCapability } from '@/features/calls/useCallCapability'
import { ScheduleCallDialog } from '@/features/calls-page/ScheduleCallDialog'
import { TrialCardDialog, TrialGroupBar } from '@/features/trials/TrialCardDialog'
import { SeatBar } from './SeatParts'
import { TR } from '@/features/trials/copy'
import { useCallsCopy } from '@/features/calls-page/hooks'
import { useLessonCards } from '@/features/journey/LessonCardDialogs'
import { LessonRecordDialog } from '@/features/journey/LessonRecordDialog'
import { LESSON_CARD_KINDS } from '@/features/journey/api'
import { LessonMovedCard, readLessonMovedCard } from '@/features/journey/LessonMovedCard'
import { journeyCopyFor } from '@/features/journey/journeyCopyFor'
import {
  SCHEDULED_CALL_CARD_KINDS,
  ScheduledCallCard,
  readScheduledCallCard,
} from '@/features/calls-page/ScheduledCallCard'
import { TrialBadge, isTrialGroup } from '@/shared/components/TrialBadge'

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

/** A failed message action, worded here for the codes the server words only in English. */
function actionErrorText(error: unknown, locale: 'ar' | 'en', copy: ChatCopy): string {
  if (error instanceof ApiError) {
    if (error.code === 'COMM.EDIT_WINDOW_EXPIRED') return copy.editWindowExpired
    if (error.code === 'COMM.MESSAGE_NOT_EDITABLE') return copy.notEditable
  }
  return errorText(error, locale, copy.actionFailed)
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
  focusMessageId,
  onFocused,
}: {
  conversationId: string
  backTo: string
  infoShown: boolean
  onToggleInfo: () => void
  /** Open at this message (a search hit, a star): older history is loaded until it is on screen. */
  focusMessageId?: string | null
  onFocused?: () => void
}) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const { staff } = useSession()
  const queryClient = useQueryClient()
  const prefs = useConversationPreferences()
  const [searchParams, setSearchParams] = useSearchParams()

  const details = useQuery({
    queryKey: chatKeys.conversation(conversationId),
    queryFn: () => chatApi.get(conversationId),
  })
  // The newest page is the live part: every realtime event re-reads it, so a
  // new message, an edit or a deletion all arrive the same way.
  const latest = useQuery({
    queryKey: chatKeys.messages(conversationId),
    queryFn: () => chatApi.messages(conversationId),
    // Safety net: a socket emit has no acknowledgement, and a delivery the
    // server refuses to risk is dropped rather than sent unchecked. The next
    // event heals it; this bounds how long it can stay unhealed without one.
    refetchInterval: 60_000,
  })
  // PD-14: whose messages this admin may edit or delete after they were sent.
  const moderates = useMemo(() => new Set(details.data?.viewerModerates ?? []), [details.data?.viewerModerates])
  const refreshThread = () => {
    void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) })
    void queryClient.invalidateQueries({ queryKey: chatKeys.pins(conversationId) })
    void queryClient.invalidateQueries({ queryKey: chatKeys.starred })
  }
  const [older, setOlder] = useState<ChatMessage[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [pending, setPending] = useState<PendingSend[]>([])
  const [reply, setReply] = useState<ReplyTarget | null>(null)
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  // Select mode: a set of message ids, and the bulk actions over them.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [forwarding, setForwarding] = useState<string[] | null>(null)
  const [labeling, setLabeling] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  // A trial group's "+ -> Trial" card (trial journey).
  const [trialCard, setTrialCard] = useState(false)
  const [theming, setTheming] = useState(false)
  // PD-15: the supervisor's lesson cards under "+", and a lesson card's record.
  const lessonGroup = details.data?.type === 'student_group' || details.data?.type === 'family_group'
  const lessonCards = useLessonCards(conversationId, lessonGroup)
  const [recordOf, setRecordOf] = useState<string | null>(null)
  const callsCopy = useCallsCopy()
  // Schedule call rides the SAME advisory answer (and cache) as the call
  // button: absent, not disabled, when this viewer may not start a call here.
  const { canCall: canSchedule } = useCallCapability(conversationId)
  const [searching, setSearching] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const revealRun = useRef(0)
  const [notice, setNotice] = useState<string | null>(null)
  const stopSelecting = () => {
    setSelecting(false)
    setSelected([])
  }
  const flash = (text: string) => {
    setNotice(text)
    setTimeout(() => setNotice(null), 2500)
  }

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

  /**
   * Bring a message onto the screen: page back through older history until it
   * is loaded (bounded), then scroll to it once it renders. The history stays
   * contiguous, so "Load older" carries on from where this stopped.
   */
  async function reveal(messageId: string) {
    // Only the latest request acts: an older one still paging (a fast second
    // step, a new search) stops without touching the history.
    const run = ++revealRun.current
    atBottom.current = false
    if (!byId.has(messageId)) {
      let next = cursor
      const fetched: ChatMessage[] = []
      for (let i = 0; next && i < 40 && !fetched.some((m) => m.id === messageId); i += 1) {
        const page = await chatApi.messages(conversationId, next)
        if (run !== revealRun.current) return
        fetched.push(...page.messages)
        next = page.nextBefore
      }
      if (fetched.length > 0) {
        setOlder((prev) => [...fetched, ...prev])
        setOlderCursor(next)
      }
      // Not within reach: leave no target behind to jump to later.
      if (!fetched.some((m) => m.id === messageId)) return
    }
    setTarget(messageId)
  }
  useEffect(() => {
    if (!target) return
    const el = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-msg-id]') ?? [])].find((node) => node.dataset.msgId === target)
    if (!el) return
    el.scrollIntoView?.({ block: 'center' })
    el.classList.add('cw-msg--flash')
    setTimeout(() => el.classList.remove('cw-msg--flash'), 1200)
    setTarget(null)
  }, [target, messages])
  const loaded = latest.data !== undefined
  useEffect(() => {
    if (!focusMessageId || !loaded) return
    void reveal(focusMessageId).finally(() => onFocused?.())
    // Once per requested message, after the first page is in.
  }, [focusMessageId, loaded])

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

  /** Save an edit: the server decides whether it may still be edited, and its copy replaces ours. */
  async function saveEdit(target: EditTarget, body: string) {
    setEditing(null)
    if (body === target.body) return
    await act(async () => {
      const saved = await chatApi.editMessage(conversationId, target.messageId, body)
      setOlder((all) => all.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)))
    })
    void queryClient.invalidateQueries({ queryKey: chatKeys.list })
  }

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
  const favorite = !!conv?.viewerState?.favorite
  const memberCount = conv?.members?.length ?? 0
  const trialGroup = conv?.type === 'trial_group'
  const trialCopy = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
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
              <span className="thread-head__name" dir="auto">
                {name} {isTrialGroup(conv) && <TrialBadge />}
              </span>
              <span className="thread-head__sub">
                {copy.kind[conv.type] ?? conv.type}
                {memberCount > 0 && ` · ${copy.membersCount(memberCount)}`}
              </span>
              {conv.cover && (
                <span className="thread-head__cover" dir="auto">
                  {copy.coverLine(conv.cover)}
                </span>
              )}
              {(conv.labels ?? []).length > 0 && (
                <span className="cw-row__labels" aria-label={copy.labels}>
                  {conv.labels!.map((l) => (
                    <LabelChip key={l.id} label={l} />
                  ))}
                </span>
              )}
            </span>
          </button>
        )}
        <div className="cw-head__actions">
          {conv && <ConversationCallControls conversationId={conversationId} peerLabel={name} isGroup={group} />}
          {favorite && (
            <span className="cw-row__mark cw-row__mark--favorite" title={copy.favoriteMark} aria-label={copy.favoriteMark}>
              <Icon name="heart" size={16} />
            </span>
          )}
          {muted && (
            <span className="cw-row__mark" title={copy.mutedMark} aria-label={copy.mutedMark}>
              <Icon name="bellOff" size={16} />
            </span>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={() => setSearching((on) => !on)}
            aria-pressed={searching}
            aria-label={copy.searchChat}
            title={copy.searchChat}
          >
            <Icon name="search" />
          </button>
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
                { key: 'select', label: copy.select, icon: 'checkSquare', onSelect: () => setSelecting(true) },
                { key: 'search', label: copy.searchChat, icon: 'search', onSelect: () => setSearching(true) },
                ...(canSchedule
                  ? [{ key: 'schedule', label: copy.scheduleCall, icon: 'calendar' as const, onSelect: () => setScheduling(true) }]
                  : []),
                { key: 'labels', label: copy.labelsMenu, icon: 'tag', onSelect: () => setLabeling(true) },
                { key: 'theme', label: copy.chatTheme, icon: 'image', onSelect: () => setTheming(true) },
                { key: 'mute', label: muted ? copy.unmute : copy.mute, icon: muted ? 'notifications' : 'bellOff', onSelect: () => prefs.mute(conv.id, !muted) },
                { key: 'pin', label: pinned ? copy.unpin : copy.pin, icon: 'pin', onSelect: () => prefs.pin(conv.id, !pinned) },
                { key: 'favorite', label: favorite ? copy.unfavorite : copy.favorite, icon: 'heart', onSelect: () => prefs.favorite(conv.id, !favorite) },
                { key: 'archive', label: archived ? copy.unarchive : copy.archive, icon: 'archive', onSelect: () => prefs.archive(conv.id, !archived) },
                // Exporting copies family data out of the system: the super admin's alone (the server enforces it).
                ...(staff?.role === 'super_admin'
                  ? [{ key: 'export', label: copy.exportChat, icon: 'upload' as const, onSelect: () => setExporting(true) }]
                  : []),
              ]}
            />
          )}
        </div>
      </header>

      {searching && (
        <ThreadSearch
          conversationId={conversationId}
          query={searchQ}
          onQuery={setSearchQ}
          onReveal={(id) => void reveal(id)}
          onClose={() => {
            setSearching(false)
            setSearchQ('')
          }}
        />
      )}

      <PinnedBar conversationId={conversationId} scroller={scroller} />

      <div
        className={threadBackground(conv?.viewerState).className}
        style={threadBackground(conv?.viewerState).style}
        data-theme-key={conv?.viewerState?.theme ?? undefined}
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
                    moderated={m.authorId !== staff?.id && moderates.has(m.authorKind)}
                    quoted={m.replyToMessageId ? byId.get(m.replyToMessageId) ?? null : undefined}
                    onReply={() =>
                      setReply({ messageId: m.id, author: m.authorId === staff?.id ? copy.you : authorName(m, copy), preview: bodyPreview(m, copy) })
                    }
                    onReact={(emoji) => {
                      const mine = m.reactions?.find((r) => r.actorId === staff?.id)
                      void act(() =>
                        mine?.emoji === emoji ? chatApi.unreact(conversationId, m.id) : chatApi.react(conversationId, m.id, emoji),
                      )
                    }}
                    onStar={() => void act(() => (m.starred ? chatApi.unstar(conversationId, m.id) : chatApi.star(conversationId, m.id)))}
                    onForward={() => setForwarding([m.id])}
                    onSelectStart={() => {
                      setSelecting(true)
                      setSelected([m.id])
                    }}
                    selectMode={selecting}
                    isSelected={selected.includes(m.id)}
                    highlight={searching && searchable(searchQ) ? searchQ : undefined}
                    onToggleSelect={() => setSelected((all) => (all.includes(m.id) ? all.filter((x) => x !== m.id) : [...all, m.id]))}
                    onPin={() => void act(() => (m.pinned ? chatApi.unpin(conversationId, m.id) : chatApi.pin(conversationId, m.id)))}
                    onDeleteForMe={() => void act(() => chatApi.deleteForMe(conversationId, m.id))}
                    onDeleteForEveryone={() => void act(() => chatApi.deleteForEveryone(conversationId, m.id))}
                    onEdit={() => setEditing({ messageId: m.id, body: m.body ?? '' })}
                    onOpenLesson={lessonIdOf(m) ? () => setRecordOf(lessonIdOf(m)) : undefined}
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
          {actionErrorText(actionError, locale, copy)}
          <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={copy.discard} onClick={() => setActionError(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {notice && (
        <div className="cw-notice" role="status">
          {notice}
        </div>
      )}

      {/* PD-30: read-only for the parent and the teacher; staff still write. */}
      <PaymentLockBanner lock={details.data?.paymentLock} />

      {selecting ? (
        <div className="cw-select-bar" role="toolbar" aria-label={copy.selectedCount(selected.length)}>
          <button type="button" className="btn btn--ghost btn--icon" onClick={stopSelecting} aria-label={copy.cancelSelect} title={copy.cancelSelect}>
            <Icon name="close" size={18} />
          </button>
          <strong className="cw-select-bar__count">{copy.selectedCount(selected.length)}</strong>
          <div className="cw-select-bar__actions">
            <button type="button" className="btn btn--sm" disabled={selected.length === 0} onClick={() => setForwarding(selected)}>
              <Icon name="forward" size={14} />
              {copy.forward}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              disabled={selected.length === 0}
              onClick={() =>
                void act(async () => {
                  for (const id of selected) await chatApi.star(conversationId, id)
                }).then(stopSelecting)
              }
            >
              <Icon name="star" size={14} />
              {copy.star}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              disabled={selected.length === 0}
              onClick={() => {
                const text = messages
                  .filter((x) => selected.includes(x.id) && x.body && !x.deletedForAll)
                  .map((x) => x.body)
                  .join('\n')
                void navigator.clipboard?.writeText(text)
                flash(copy.copied)
                stopSelecting()
              }}
            >
              <Icon name="copy" size={14} />
              {copy.copy}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              disabled={selected.length === 0}
              onClick={() =>
                void act(async () => {
                  for (const id of selected) await chatApi.deleteForMe(conversationId, id)
                }).then(stopSelecting)
              }
            >
              <Icon name="trash" size={14} />
              {copy.deleteForMe}
            </button>
          </div>
        </div>
      ) : (
        <>
        {conv?.viewerState?.seat && !trialGroup && <SeatBar conversationId={conversationId} />}
        {trialGroup && (
          <TrialGroupBar
            conversationId={conversationId}
            onChanged={() => void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) })}
          />
        )}
        <ChatComposer
          extraItems={[
            ...(trialGroup ? [{ key: 'trial', label: trialCopy(TR.cardLabel), icon: 'calendar' as const, onSelect: () => setTrialCard(true) }] : []),
            ...lessonCards.items,
          ]}
          onSend={submit}
          reply={reply}
          onCancelReply={() => setReply(null)}
          editing={editing}
          onSaveEdit={(body) => editing && void saveEdit(editing, body)}
          onCancelEdit={() => setEditing(null)}
          conversationId={conversationId}
          autoStartVoice={searchParams.get('voice') === '1'}
          onVoiceAutoStarted={() => setSearchParams({}, { replace: true })}
          onVoiceSent={() => void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) })}
        />
        </>
      )}
      {lessonCards.dialog}
      {recordOf && <LessonRecordDialog lessonId={recordOf} conversationId={conversationId} onClose={() => setRecordOf(null)} />}

      {trialCard && <TrialCardDialog conversationId={conversationId} onRecorded={refreshThread} onClose={() => setTrialCard(false)} />}

      {theming && conv && <ThemeDialog conversation={conv} onClose={() => setTheming(false)} />}

      {scheduling && conv && (
        <ScheduleCallDialog
          conversation={conv}
          onClose={() => setScheduling(false)}
          onScheduled={(chatName) => {
            setScheduling(false)
            flash(callsCopy.scheduled(chatName))
          }}
        />
      )}

      {exporting && (
        <ExportDialog
          conversationId={conversationId}
          onClose={() => setExporting(false)}
          onDone={() => {
            setExporting(false)
            flash(copy.exportDone)
          }}
        />
      )}

      {labeling && conv && (
        <LabelsDialog conversationId={conv.id} current={conv.labels ?? []} onClose={() => setLabeling(false)} />
      )}

      {forwarding && (
        <ForwardDialog
          conversationId={conversationId}
          messageIds={forwarding}
          onClose={() => setForwarding(null)}
          onDone={(n) => {
            setForwarding(null)
            stopSelecting()
            flash(copy.forwardDone(n))
          }}
        />
      )}
    </>
  )
}

/**
 * The viewer's own background for this chat: a preset, a photo (dimmed in CSS),
 * or the default. Only the background behind the messages changes.
 */
function threadBackground(state: ChatConversation['viewerState']): { className: string; style?: CSSProperties } {
  const classes = ['thread-body']
  if (state?.theme) classes.push('cw-bg', `cw-bg--${state.theme}`)
  if (state?.wallpaperUrl) {
    classes.push('cw-bg--photo')
    return { className: classes.join(' '), style: { ['--cw-wall' as string]: `url("${state.wallpaperUrl}")` } }
  }
  return { className: classes.join(' ') }
}

function MessageItem({
  m,
  side,
  identity,
  runStart,
  selfId,
  canModerate,
  moderated,
  quoted,
  onReply,
  onReact,
  onStar,
  onForward,
  onSelectStart,
  selectMode,
  isSelected,
  highlight,
  onToggleSelect,
  onPin,
  onDeleteForMe,
  onDeleteForEveryone,
  onEdit,
  onOpenLesson,
}: {
  m: ChatMessage
  side: Side
  identity: Identity
  runStart: boolean
  selfId: string | undefined
  canModerate: boolean
  /** PD-14: someone else's message this admin moderates here -- edit and delete at any time. */
  moderated: boolean
  /** The message this one replies to: the message, null when it is not loaded, undefined when it is no reply. */
  quoted: ChatMessage | null | undefined
  onReply: () => void
  onReact: (emoji: string) => void
  onStar: () => void
  onForward: () => void
  onSelectStart: () => void
  selectMode: boolean
  isSelected: boolean
  /** While searching: the term to mark in the text. */
  highlight?: string
  onToggleSelect: () => void
  onPin: () => void
  onDeleteForMe: () => void
  onDeleteForEveryone: () => void
  onEdit: () => void
  /** PD-15: a lesson card opens its lesson's record (correct, edit, delete / resend). */
  onOpenLesson?: () => void
}) {
  const { locale, time } = useI18n()
  const copy = chatCopyFor(locale)

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
  // A hint only: the server decides (the author within the window, or -- PD-14 --
  // an admin moderating it at any time; a published text either way).
  const editable =
    (moderated || (mine && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS)) &&
    !m.deletedForAll &&
    m.type === 'text' &&
    m.moderation === 'published' &&
    !!m.body
  const live = !m.deletedForAll
  // PD-13: a scheduled-call card is drawn with its Join button; any other card
  // (or one this client cannot read) keeps showing its plain-text body.
  const callCard =
    live && m.type === 'card' && m.card && SCHEDULED_CALL_CARD_KINDS.has(m.card.kind)
      ? readScheduledCallCard(m.card.payload)
      : null
  // PD-31: a moved lesson's card draws "previous → new" on the academy's clock.
  const movedCard = live && m.type === 'card' && m.card?.kind === 'lesson_moved' ? readLessonMovedCard(m.card.payload) : null
  const reactions = summarize(m.reactions ?? [], selfId)
  // A lesson report's card is changed only from its lesson record (PD-15).
  const reportCard = m.type === 'card' && m.card?.kind === 'lesson_report'
  const items: MenuItem[] = live
    ? [
        ...(onOpenLesson ? [{ key: 'lesson', label: journeyCopyFor(locale).openRecord, icon: 'academy' as const, onSelect: onOpenLesson }] : []),
        { key: 'reply', label: copy.reply, icon: 'reply', onSelect: onReply },
        ...(editable ? [{ key: 'edit', label: copy.edit, icon: 'pencil' as const, onSelect: onEdit }] : []),
        // Only what may leave its conversation; the server re-checks both ends.
        ...(m.moderation === 'published' && m.type !== 'card'
          ? [{ key: 'forward', label: copy.forward, icon: 'forward' as const, onSelect: onForward }]
          : []),
        { key: 'select', label: copy.select, icon: 'checkSquare' as const, onSelect: onSelectStart },
        { key: 'star', label: m.starred ? copy.unstar : copy.star, icon: 'star' as const, onSelect: onStar },
        // Only a published message can be pinned; the server decides who may write here.
        ...(m.moderation === 'published'
          ? [{ key: 'pin', label: m.pinned ? copy.unpinMessage : copy.pinMessage, icon: 'pin' as const, onSelect: onPin }]
          : []),
        ...(m.body
          ? [{ key: 'copy', label: copy.copy, icon: 'copy' as const, onSelect: () => void navigator.clipboard?.writeText(m.body ?? '') }]
          : []),
        { key: 'delete-me', label: copy.deleteForMe, icon: 'trash', onSelect: onDeleteForMe },
        // The server allows it to the author within the window, a manager, or an
        // admin moderating it (PD-14); it answers anyone else.
        ...((mine || canModerate || moderated) && !reportCard
          ? [{ key: 'delete-all', label: copy.deleteForEveryone, icon: 'trash' as const, danger: true, onSelect: onDeleteForEveryone }]
          : []),
      ]
    : [{ key: 'delete-me', label: copy.deleteForMe, icon: 'trash', onSelect: onDeleteForMe }]

  return (
    <li
      className={`bubble-row ${SIDE_CLASS[side]} cw-msg${runStart ? ' cw-msg--run-start' : ''}${identity !== 'none' ? ' cw-msg--with-sender' : ''}${selectMode ? ' cw-msg--selectable' : ''}${isSelected ? ' cw-msg--selected' : ''}`}
      data-seq={m.seq ?? undefined}
      data-msg-id={m.id}
      onClick={selectMode ? onToggleSelect : undefined}
    >
      <div className="cw-msg__line">
        {selectMode && (
          <input
            type="checkbox"
            className="cw-msg__check"
            checked={isSelected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            aria-label={`${copy.select}: ${bodyPreview(m, copy)}`}
          />
        )}
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
          {m.forwarded && (
            <span className="cw-forwarded">
              <Icon name="forward" size={12} />
              {copy.forwarded}
            </span>
          )}
          {/* PD-21: an administrator wrote this in a support session, as its author. */}
          {m.sentBySupport && (
            <span className="cw-forwarded cw-support">
              <Icon name="info" size={12} />
              {copy.sentBySupport}
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
          ) : callCard && m.card && m.conversationId ? (
            <ScheduledCallCard cardKind={m.card.kind} card={callCard} conversationId={m.conversationId} />
          ) : movedCard ? (
            <LessonMovedCard card={movedCard} />
          ) : (
            <>
              {m.attachments.map((a) => (
                <AttachmentView key={a.id} a={a} copy={copy} />
              ))}
              {m.body && <span dir="auto">{highlight ? <Highlighted text={m.body} query={highlight} /> : m.body}</span>}
            </>
          )}
          <span className="bubble__meta">
            {m.pinned && (
              <span className="cw-mark" title={copy.pinnedMessageMark} aria-label={copy.pinnedMessageMark}>
                <Icon name="pin" size={12} />
              </span>
            )}
            {m.starred && (
              <span className="cw-mark cw-mark--star" title={copy.starredMark} aria-label={copy.starredMark}>
                <Icon name="star" size={12} />
              </span>
            )}
            {m.moderation === 'pending' && <Badge tone="waiting">{copy.pending}</Badge>}
            {m.moderation === 'rejected' && <Badge tone="danger">{copy.rejected}</Badge>}
            {m.editedAt && !m.deletedForAll && (
              <span className="cw-edited" title={time(m.editedAt)}>
                {copy.edited}
              </span>
            )}
            <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
          </span>
        </div>
        {!selectMode && <Menu
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
        />}
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
  if (a.kind === 'voice') return <VoiceNotePlayer url={a.url} durationMs={a.durationMs} copy={copy} />
  return (
    <a href={a.url} target="_blank" rel="noreferrer" className="bubble__attachment">
      <Icon name="paperclip" size={14} />
      <span dir="auto">{a.originalName ?? copy.attachment}</span>
    </a>
  )
}

/**
 * The conversation's pinned messages (at most three), WhatsApp-style: one bar
 * under the header showing a pin; tapping it scrolls to that message and moves
 * the bar on to the next. Only pins this viewer could read are listed.
 */
function PinnedBar({ conversationId, scroller }: { conversationId: string; scroller: React.RefObject<HTMLDivElement | null> }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const pins = useQuery({ queryKey: chatKeys.pins(conversationId), queryFn: () => chatApi.pins(conversationId) })
  const list = pins.data ?? []
  const [index, setIndex] = useState(0)
  if (list.length === 0) return null
  // Newest first, as WhatsApp shows it; the counter reads oldest = 1.
  const shown = list[list.length - 1 - (index % list.length)]!
  const position = list.length - (index % list.length)
  const m = shown.message

  return (
    <button
      type="button"
      className="cw-pinned"
      aria-label={`${copy.pinnedBar(position, list.length)}${list.length > 1 ? ` · ${copy.pinnedNext}` : ''}`}
      onClick={() => {
        setIndex((i) => i + 1)
        // Matched by value, not by building a selector from the id.
        const el = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-msg-id]') ?? [])].find(
          (node) => node.dataset.msgId === m.id,
        )
        el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
        el?.classList.add('cw-msg--flash')
        setTimeout(() => el?.classList.remove('cw-msg--flash'), 1200)
      }}
    >
      {list.length > 1 && (
        <span className="cw-pinned__ticks" aria-hidden="true">
          {list.map((p, i) => (
            <span key={p.message.id} className={i === position - 1 ? 'cw-pinned__tick cw-pinned__tick--on' : 'cw-pinned__tick'} />
          ))}
        </span>
      )}
      <Icon name="pin" size={16} />
      <span className="cw-pinned__text">
        <span className="cw-pinned__label">{copy.pinnedBar(position, list.length)}</span>
        <span className="cw-pinned__body" dir="auto">
          {m.body || (copy.preview[m.attachments[0]?.kind ?? m.type] ?? copy.attachment)}
        </span>
      </span>
    </button>
  )
}

/** The lesson a lesson card is about (its payload's lessonId), or null. */
function lessonIdOf(m: ChatMessage): string | null {
  if (m.type !== 'card' || !m.card || !LESSON_CARD_KINDS.has(m.card.kind) || m.deletedForAll) return null
  const id = m.card.payload.lessonId
  return typeof id === 'string' ? id : null
}
