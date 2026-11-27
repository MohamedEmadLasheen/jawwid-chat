import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { newIdempotencyKey } from '@/core/api/client'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, LoadingState } from '@/shared/components/States'
import { countWords } from '@/features/instalments/copy'
import { bySeq, type ChatConversation } from '@/features/chat/chatApi'
import { supportAdminApi, supportClient, supportKeys, supportTokens, type SupportSession } from './api'
import { KIND_LABEL, MINUTES, S, describeError, isEnded, useCopy } from './copy'
import './support.css'

type Tab = 'chats' | 'profile'

/** The session's last minutes are said in terracotta, so the end is not a surprise. */
const LAST_MINUTES = 5

/**
 * PD-21: a support session -- the administrator sees and acts as a parent or
 * teacher, on the record.
 *
 * The page holds the support token in memory (supportTokens) and asks for a
 * fresh one with the administrator's own session when it has none (a reload)
 * or wants more time. Exit ends the session on the server; the
 * administrator's own session is never touched, so they are simply back.
 *
 * What may be done here is decided by the server: reads freely (no receipts
 * are sent), sending a message (labelled "Sent by support"), the person's own
 * profile. The rest is refused there whatever this page offers.
 *
 * The masthead says whose account this is and never leaves the screen: a gold
 * tag, the person's name, the time left, "Keep working" and the way out. Under
 * it the person's chats are a workspace in the chat's own language (the list,
 * the open thread, a composer), one pane at a time on a phone.
 */
export function SupportSessionPage() {
  const { impersonationId = '' } = useParams()
  const tx = useCopy()
  const { locale, time } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Handed over by the Accounts page when it started the session; absent after a reload.
  const [token, setToken] = useState<string | null>(() => supportTokens.get(impersonationId)?.accessToken ?? null)
  const [session, setSession] = useState<SupportSession | null>(() => supportTokens.get(impersonationId)?.session ?? null)
  const [ended, setEnded] = useState(false)
  const [tab, setTab] = useState<Tab>('chats')

  const refresh = useMutation({
    mutationFn: () => supportAdminApi.token(impersonationId),
    onSuccess: (r) => {
      supportTokens.set(r)
      setToken(r.accessToken)
      setSession(r.session)
    },
    onError: (e) => {
      if (isEnded(e)) setEnded(true)
    },
  })

  // No token in memory (a reload, a bookmark): ask for one with the administrator's own session.
  useEffect(() => {
    if (!supportTokens.get(impersonationId)) refresh.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impersonationId])

  const exit = useMutation({
    mutationFn: () => supportAdminApi.end(impersonationId),
    onSettled: () => {
      supportTokens.forget(impersonationId)
      queryClient.removeQueries({ queryKey: supportKeys.all })
      navigate('/accounts')
    },
  })

  const client = useMemo(() => (token ? supportClient(token) : null), [token])
  const onEnded = useCallback(() => {
    supportTokens.forget(impersonationId)
    setEnded(true)
  }, [impersonationId])
  const minutes = useMinutesLeft(session?.expiresAt)

  if (ended) {
    return (
      <div className="page">
        <div className="page__inner">
          <EmptyState icon="lock" title={tx(S.ended)} />
          <p className="support-center">
            <Link to="/accounts" className="btn">
              {tx(S.backToAccounts)}
            </Link>
          </p>
        </div>
      </div>
    )
  }
  if (!client || !session) {
    return refresh.error ? (
      <div className="page">
        <div className="page__inner">
          <EmptyState icon="alert" title={describeError(refresh.error, locale)} />
        </div>
      </div>
    ) : (
      <LoadingState />
    )
  }

  const kind = tx(KIND_LABEL[session.target.kind])
  const family = session.target.kind === 'family'
  return (
    <div className="page support">
      <div className="page__inner">
        <PageHeader
          lead={<Avatar name={session.target.name} seed={session.target.accountId} size="lg" />}
          title={session.target.name}
          status={<Badge tone="gold">{tx(S.tag)}</Badge>}
          subtitle={tx(S.acting, { name: session.target.name, kind })}
          actions={
            <>
              <span className={minutes !== null && minutes <= LAST_MINUTES ? 'support-left support-left--last' : 'support-left'} role="timer">
                <Icon name="timer" size={16} />
                <span>
                  {minutes !== null && <strong>{tx(S.left, { time: countWords(minutes, MINUTES, locale) })}</strong>}
                  <span className="support-left__until">{tx(S.until, { time: time(session.expiresAt) })}</span>
                </span>
              </span>
              <button type="button" className="btn" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
                {tx(S.extend)}
              </button>
              <button type="button" className="btn btn--primary" disabled={exit.isPending} onClick={() => exit.mutate()}>
                <Icon name="signOut" size={16} />
                {tx(S.exit)}
              </button>
            </>
          }
          tabs={
            family && (
              <div className="seg support-tabs" role="tablist" aria-label={tx(S.tabsLabel, { name: session.target.name })}>
                {(['chats', 'profile'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    id={`support-tab-${t}`}
                    className="seg__item"
                    aria-selected={tab === t}
                    aria-controls={`support-panel-${t}`}
                    onClick={() => setTab(t)}
                  >
                    {tx(t === 'chats' ? S.tabChats : S.tabProfile)}
                  </button>
                ))}
              </div>
            )
          }
        />
        <div
          className="support-panel"
          role={family ? 'tabpanel' : undefined}
          id={family ? `support-panel-${tab}` : undefined}
          aria-labelledby={family ? `support-tab-${tab}` : undefined}
        >
          {tab === 'chats' ? (
            <Chats id={impersonationId} client={client} session={session} onEnded={onEnded} />
          ) : (
            <ParentProfile id={impersonationId} client={client} onEnded={onEnded} />
          )}
        </div>
        {session.target.kind === 'teacher' && <p className="support-foot">{tx(S.teacherProfileHint)}</p>}
      </div>
    </div>
  )
}

/** Whole minutes until `iso`, counted down while the page is open; null without a time. */
function useMinutesLeft(iso: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!iso) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 20_000)
    return () => window.clearInterval(timer)
  }, [iso])
  if (!iso) return null
  const end = Date.parse(iso)
  return Number.isNaN(end) ? null : Math.max(0, Math.ceil((end - now) / 60_000))
}

type Client = ReturnType<typeof supportClient>

/** The person's chats: the list, and the open one beside it (after it on a phone). */
function Chats({ id, client, session, onEnded }: { id: string; client: Client; session: SupportSession; onEnded: () => void }) {
  const tx = useCopy()
  const { locale, time, date, number } = useI18n()
  const [open, setOpen] = useState<string | null>(null)
  const list = useQuery({ queryKey: supportKeys.conversations(id), queryFn: client.conversations, refetchInterval: 15_000 })
  useEffect(() => {
    if (isEnded(list.error)) onEnded()
  }, [list.error, onEnded])

  const conversations = list.data ?? []
  const current = conversations.find((c) => c.id === open) ?? null
  // Today's activity is a time; anything older is its day.
  const today = date(new Date().toISOString())
  const when = (iso: string) => (date(iso) === today ? time(iso) : date(iso))
  return (
    <div className={open ? 'support-work support-work--open' : 'support-work'}>
      <section className="support-side" aria-label={tx(S.tabChats)}>
        <header className="support-side__head">
          <h2 className="support-side__title">{tx(S.tabChats)}</h2>
          {list.data && conversations.length > 0 && <span className="support-side__count">{number(conversations.length)}</span>}
        </header>
        <ul className="support-list" aria-label={tx(S.tabChats)}>
          {list.error && !isEnded(list.error) && <li className="support-list__note support-list__note--error">{describeError(list.error, locale)}</li>}
          {list.data && conversations.length === 0 && <li className="support-list__note">{tx(S.noChats)}</li>}
          {conversations.map((c) => {
            const title = titleOf(c, tx(S.untitled))
            const last = c.lastMessage && !c.lastMessage.deleted && !c.lastMessage.systemKind ? c.lastMessage.text : null
            return (
              <li key={c.id}>
                <button type="button" className="support-row" aria-current={c.id === open ? 'true' : undefined} onClick={() => setOpen(c.id)}>
                  <Avatar name={title} seed={c.id} src={c.avatarUrl} />
                  <span className="support-row__body">
                    <span className="support-row__top">
                      <span className={c.unreadCount ? 'support-row__name support-row__name--unread' : 'support-row__name'}>
                        <bdi>{title}</bdi>
                      </span>
                      <time className="support-row__time" dateTime={c.lastActivityAt}>
                        {when(c.lastActivityAt)}
                      </time>
                    </span>
                    {(last || c.unreadCount) && (
                      <span className="support-row__bottom">
                        <span className="support-row__sub">{last && <bdi>{last}</bdi>}</span>
                        {c.unreadCount ? <span className="count">{number(c.unreadCount)}</span> : null}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
      <section className="support-thread" aria-label={current ? titleOf(current, tx(S.untitled)) : tx(S.pickChat)}>
        {open ? (
          <Thread
            key={open}
            id={id}
            client={client}
            conversationId={open}
            title={current ? titleOf(current, tx(S.untitled)) : tx(S.untitled)}
            person={session.target}
            onBack={() => setOpen(null)}
            onEnded={onEnded}
          />
        ) : (
          <p className="support-thread__none">
            <Icon name="conversations" size={22} />
            {tx(S.pickChat)}
          </p>
        )}
      </section>
    </div>
  )
}

function Thread({
  id,
  client,
  conversationId,
  title,
  person,
  onBack,
  onEnded,
}: {
  id: string
  client: Client
  conversationId: string
  title: string
  person: SupportSession['target']
  onBack: () => void
  onEnded: () => void
}) {
  const tx = useCopy()
  const { locale, dateTime, number } = useI18n()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const body = useRef<HTMLDivElement>(null)
  const key = supportKeys.messages(id, conversationId)
  const page = useQuery({ queryKey: key, queryFn: () => client.messages(conversationId), refetchInterval: 10_000 })
  const send = useMutation({
    mutationFn: (text: string) => client.send(conversationId, text, newIdempotencyKey()),
    onSuccess: () => {
      setDraft('')
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
  useEffect(() => {
    if (isEnded(page.error) || isEnded(send.error)) onEnded()
  }, [page.error, send.error, onEnded])

  const messages = [...(page.data?.messages ?? [])].sort(bySeq)
  // The newest message is the one to see: the thread opens, and stays, at its end.
  const count = messages.length
  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count])
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (text && !send.isPending) send.mutate(text)
  }

  return (
    <>
      <header className="support-thread__head">
        <button type="button" className="btn btn--ghost btn--icon support-thread__back" onClick={onBack} aria-label={tx(S.backToChats)}>
          <Icon name="arrowBack" size={18} />
        </button>
        <h2 className="support-thread__title">
          <bdi>{title}</bdi>
        </h2>
      </header>
      <div ref={body} className="support-thread__body">
        <p className="support-thread__note">{tx(S.readOnlyHint, { name: person.name })}</p>
        <ol className="support-msgs">
          {page.data && messages.length === 0 && <li className="support-msgs__none">{tx(S.noMessages)}</li>}
          {messages.map((m, i) => {
            // As the person sees it: what they wrote sits on their side.
            const mine = m.authorId !== null && m.authorId === person.actorId
            const sameAuthor = i > 0 && messages[i - 1]!.authorId === m.authorId
            return (
              <li key={m.id} className={mine ? 'support-msg support-msg--mine' : 'support-msg'}>
                {!mine && !sameAuthor && m.authorDisplayName && (
                  <span className="support-msg__author">
                    <bdi>{m.authorDisplayName}</bdi>
                  </span>
                )}
                <div className={m.sentBySupport ? 'support-bubble support-bubble--support' : 'support-bubble'}>
                  {m.sentBySupport && (
                    <span className="support-bubble__flag">
                      <Icon name="headset" size={14} />
                      {tx(S.sentBySupport)}
                    </span>
                  )}
                  {m.deletedForAll ? (
                    <span className="support-bubble__gone">—</span>
                  ) : m.body ? (
                    <div className="support-bubble__text" dir="auto">{m.body}</div>
                  ) : m.attachments.length ? (
                    <span className="support-bubble__files">
                      <Icon name="paperclip" size={15} /> <span className="ltr">{number(m.attachments.length)}</span>
                    </span>
                  ) : null}
                  <time className="support-bubble__meta" dateTime={m.createdAt}>
                    {dateTime(m.createdAt)}
                  </time>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
      <form className="support-composer" onSubmit={onSubmit}>
        <p className="support-composer__flag">
          <Icon name="headset" size={14} />
          {tx(S.labelNote, { name: person.name })}
        </p>
        {send.error && !isEnded(send.error) && (
          <div className="field__error" role="alert">
            {describeError(send.error, locale)}
          </div>
        )}
        <div className="support-composer__bar">
          <textarea
            className="support-composer__input"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            dir="auto"
            aria-label={tx(S.write)}
            placeholder={tx(S.write)}
          />
          <button type="submit" className="support-send" disabled={!draft.trim() || send.isPending} aria-label={tx(S.send)} title={tx(S.send)}>
            <Icon name="send" size={18} />
          </button>
        </div>
      </form>
    </>
  )
}

function ParentProfile({ id, client, onEnded }: { id: string; client: Client; onEnded: () => void }) {
  const tx = useCopy()
  const { locale, number } = useI18n()
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: supportKeys.profile(id), queryFn: client.parentProfile })
  const [name, setName] = useState<string | null>(null)
  const [about, setAbout] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () =>
      client.updateParentProfile({
        ...(name !== null ? { name } : {}),
        ...(about !== null ? { about: about.trim() ? about : null } : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(supportKeys.profile(id), data)
      setName(null)
      setAbout(null)
    },
  })
  useEffect(() => {
    if (isEnded(profile.error) || isEnded(save.error)) onEnded()
  }, [profile.error, save.error, onEnded])

  if (!profile.data) return profile.error ? <p className="field__error">{describeError(profile.error, locale)}</p> : <LoadingState />
  const p = profile.data
  return (
    <div className="support-profile">
      <form
        className="sheet support-profile__form"
        onSubmit={(e) => {
          e.preventDefault()
          if (name !== null || about !== null) save.mutate()
        }}
      >
        <div className="sheet__head">
          <h2 className="sheet__title">{tx(S.tabProfile)}</h2>
        </div>
        <div className="sheet__body support-profile__fields">
          <label className="field">
            <span className="field__label">{tx(S.name)}</span>
            <input className="input" value={name ?? p.displayName} onChange={(e) => setName(e.target.value)} dir="auto" />
          </label>
          <label className="field">
            <span className="field__label">{tx(S.about)}</span>
            <textarea className="textarea" rows={3} value={about ?? p.about ?? ''} onChange={(e) => setAbout(e.target.value)} dir="auto" />
          </label>
          {save.error && (
            <div className="field__error" role="alert">
              {describeError(save.error, locale)}
            </div>
          )}
          <div className="support-profile__save">
            <button type="submit" className="btn" disabled={(name === null && about === null) || save.isPending}>
              {tx(S.save)}
            </button>
            {save.isSuccess && name === null && about === null && <span className="support-profile__saved" role="status">{tx(S.saved)}</span>}
          </div>
        </div>
      </form>
      <section className="sheet support-profile__children" aria-labelledby="support-children">
        <div className="sheet__head">
          <h2 id="support-children" className="sheet__title">{tx(S.children)}</h2>
          <span className="sheet__count">{number(p.children.length)}</span>
        </div>
        <ul className="support-children">
          {p.children.map((c) => (
            <li key={c.id}>
              <Avatar name={c.displayName} seed={c.id} size="sm" />
              <span className="support-children__name">
                <bdi>{c.displayName}</bdi>
              </span>
              {c.level && (
                <span className="support-children__level">
                  <bdi>{c.level}</bdi>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function titleOf(c: ChatConversation, fallback: string): string {
  if (c.title) return c.title
  if (c.learner?.name) return c.learner.name
  const names = (c.members ?? []).map((m) => m.displayName).filter(Boolean)
  return names.length ? names.join('، ') : fallback
}
