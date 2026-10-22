import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { newIdempotencyKey } from '@/core/api/client'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { EmptyState, LoadingState } from '@/shared/components/States'
import { bySeq, type ChatConversation } from '@/features/chat/chatApi'
import { supportAdminApi, supportClient, supportKeys, supportTokens, type SupportSession } from './api'
import { KIND_LABEL, S, describeError, isEnded, useCopy } from './copy'
import './support.css'

type Tab = 'chats' | 'profile'

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
  return (
    <div className="page support">
      <div className="support-banner" role="status">
        <strong dir="auto">{tx(S.banner, { name: session.target.name, kind })}</strong>
        <span className="support-banner__until">{tx(S.until, { time: time(session.expiresAt) })}</span>
        <span className="support-banner__actions">
          <button type="button" className="btn btn--sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {tx(S.extend)}
          </button>
          <button type="button" className="btn btn--sm btn--danger" disabled={exit.isPending} onClick={() => exit.mutate()}>
            {tx(S.exit)}
          </button>
        </span>
      </div>
      <div className="page__inner">
        {session.target.kind === 'family' && (
          <FilterChips
            label={tx(S.tabChats)}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'chats', label: tx(S.tabChats) },
              { value: 'profile', label: tx(S.tabProfile) },
            ]}
          />
        )}
        {tab === 'chats' ? (
          <Chats id={impersonationId} client={client} session={session} onEnded={onEnded} />
        ) : (
          <ParentProfile id={impersonationId} client={client} onEnded={onEnded} />
        )}
        {session.target.kind === 'teacher' && <p className="field__hint">{tx(S.teacherProfileHint)}</p>}
      </div>
    </div>
  )
}

type Client = ReturnType<typeof supportClient>

function Chats({ id, client, session, onEnded }: { id: string; client: Client; session: SupportSession; onEnded: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const [open, setOpen] = useState<string | null>(null)
  const list = useQuery({ queryKey: supportKeys.conversations(id), queryFn: client.conversations, refetchInterval: 15_000 })
  useEffect(() => {
    if (isEnded(list.error)) onEnded()
  }, [list.error, onEnded])

  const conversations = list.data ?? []
  return (
    <div className="support-chats">
      <ul className="support-list" aria-label={tx(S.tabChats)}>
        {list.error && !isEnded(list.error) && <li className="field__error">{describeError(list.error, locale)}</li>}
        {list.data && conversations.length === 0 && <li className="field__hint">{tx(S.noChats)}</li>}
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={c.id === open ? 'support-list__item support-list__item--open' : 'support-list__item'}
              aria-current={c.id === open ? 'true' : undefined}
              onClick={() => setOpen(c.id)}
            >
              <span dir="auto">{titleOf(c, tx(S.untitled))}</span>
              {c.unreadCount ? <Badge tone="info">{c.unreadCount}</Badge> : null}
            </button>
          </li>
        ))}
      </ul>
      <div className="support-thread">
        {open ? (
          <Thread id={id} client={client} conversationId={open} personName={session.target.name} onEnded={onEnded} />
        ) : (
          <p className="field__hint">{tx(S.pickChat)}</p>
        )}
      </div>
    </div>
  )
}

function Thread({
  id,
  client,
  conversationId,
  personName,
  onEnded,
}: {
  id: string
  client: Client
  conversationId: string
  personName: string
  onEnded: () => void
}) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const key = supportKeys.messages(id, conversationId)
  const page = useQuery({ queryKey: key, queryFn: () => client.messages(conversationId), refetchInterval: 10_000 })
  const send = useMutation({
    mutationFn: (body: string) => client.send(conversationId, body, newIdempotencyKey()),
    onSuccess: () => {
      setDraft('')
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
  useEffect(() => {
    if (isEnded(page.error) || isEnded(send.error)) onEnded()
  }, [page.error, send.error, onEnded])

  const messages = [...(page.data?.messages ?? [])].sort(bySeq)
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (body && !send.isPending) send.mutate(body)
  }

  return (
    <>
      <p className="field__hint">{tx(S.readOnlyHint, { name: personName })}</p>
      <ol className="support-messages">
        {page.data && messages.length === 0 && <li className="field__hint">{tx(S.noMessages)}</li>}
        {messages.map((m) => (
          <li key={m.id} className="support-message">
            <div className="support-message__meta">
              <strong dir="auto">{m.authorDisplayName ?? ''}</strong> <span>{dateTime(m.createdAt)}</span>{' '}
              {m.sentBySupport && <Badge tone="internal">{tx(S.sentBySupport)}</Badge>}
            </div>
            <div dir="auto" className="support-message__body">
              {m.deletedForAll ? '—' : m.body ?? (m.attachments.length ? `📎 ${m.attachments.length}` : '')}
            </div>
          </li>
        ))}
      </ol>
      <form className="support-composer" onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">{tx(S.write)}</span>
          <textarea className="textarea" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} dir="auto" />
          <span className="field__hint">{tx(S.labelNote, { name: personName })}</span>
        </label>
        {send.error && !isEnded(send.error) && (
          <div className="field__error" role="alert">
            {describeError(send.error, locale)}
          </div>
        )}
        <button type="submit" className="btn btn--primary" disabled={!draft.trim() || send.isPending}>
          {tx(S.send)}
        </button>
      </form>
    </>
  )
}

function ParentProfile({ id, client, onEnded }: { id: string; client: Client; onEnded: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
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
    <form
      className="support-profile"
      onSubmit={(e) => {
        e.preventDefault()
        if (name !== null || about !== null) save.mutate()
      }}
    >
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
      {save.isSuccess && name === null && about === null && <p className="field__hint" role="status">{tx(S.saved)}</p>}
      <button type="submit" className="btn btn--primary" disabled={(name === null && about === null) || save.isPending}>
        {tx(S.save)}
      </button>
      <h2 className="support-profile__heading">{tx(S.children)}</h2>
      <ul>
        {p.children.map((c) => (
          <li key={c.id} dir="auto">
            {c.displayName}
            {c.level ? ` · ${c.level}` : ''}
          </li>
        ))}
      </ul>
    </form>
  )
}

function titleOf(c: ChatConversation, fallback: string): string {
  if (c.title) return c.title
  if (c.learner?.name) return c.learner.name
  const names = (c.members ?? []).map((m) => m.displayName).filter(Boolean)
  return names.length ? names.join('، ') : fallback
}
