import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { fill, useText } from '@/features/admin/copy'
import { useDestinations, useEntryLabel } from '@/app/useDestinations'
import { entriesOf } from '@/app/navigation'
import { chatApi, chatKeys } from '@/features/chat/chatApi'
import { chatCopyFor } from '@/features/chat/copy'
import { conversationName } from '@/features/chat/chatView'
import { parentPath, profileKeys, profilesApi, studentPath } from '@/features/profiles/api'
import { studentKeys, studentsApi } from '@/features/students/api'
import { Icon, type IconName } from '@/shared/components/Icon'
import { S } from './copy'
import { findMatch, normalize, type Match } from './normalize'
import './search.css'

/**
 * Global search: one field for people, conversations, pages and a few
 * actions. Opens with Ctrl/Cmd+K or "/".
 *
 * It reads only what the account can already read: the conversation list, the
 * Parents list and the student directory (each asked for only if the account
 * has that page), and the navigation. Matching is done here (normalize.ts).
 */

type GroupKey = 'parents' | 'students' | 'conversations' | 'pages' | 'actions'

interface Hit {
  id: string
  group: GroupKey
  icon: IconName
  text: string
  sub?: string
  match: Match | null
  to: string
}

const PER_GROUP = 5
const RECENT_KEY = 'jawwid.search.recent'
const GROUP_ORDER: GroupKey[] = ['parents', 'students', 'conversations', 'pages', 'actions']

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 5) : []
  } catch {
    return []
  }
}

function remember(q: string): void {
  const term = q.trim()
  if (term.length < 2) return
  try {
    const next = [term, ...readRecent().filter((r) => r !== term)].slice(0, 5)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* private mode: nothing to remember */
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

function Highlight({ text, match }: { text: string; match: Match | null }): ReactNode {
  if (!match) return text
  return (
    <>
      {text.slice(0, match.start)}
      <mark className="palette__mark">{text.slice(match.start, match.end)}</mark>
      {text.slice(match.end)}
    </>
  )
}

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const { locale } = useI18n()
  const tx = useText()
  const navigate = useNavigate()
  const { staff } = useSession()
  const destinations = useDestinations()
  const entryLabel = useEntryLabel()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [recent] = useState(readRecent)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const restore = useRef<Element | null>(null)
  const listId = useId()
  const q = query.trim()
  const slowQ = useDebounced(q, 220)

  const entries = useMemo(() => destinations.flatMap(entriesOf), [destinations])
  const has = useCallback((path: string) => entries.some((e) => e.path === path), [entries])
  const canChat = has('/chat')
  const canParents = has('/parents')
  const canStudents = has('/students')

  const chats = useQuery({ queryKey: chatKeys.list, queryFn: chatApi.list, enabled: canChat, staleTime: 30_000 })
  const parents = useQuery({
    queryKey: profileKeys.parents('', 'all', 'all'),
    queryFn: () => profilesApi.parents(''),
    enabled: canParents,
    staleTime: 60_000,
  })
  // The Parents list is capped by the server: past the cap, ask it for the name typed.
  const moreParents = useQuery({
    queryKey: profileKeys.parents(slowQ, 'all', 'all'),
    queryFn: () => profilesApi.parents(slowQ),
    enabled: canParents && parents.data?.truncated === true && slowQ.length >= 2,
    staleTime: 60_000,
  })
  const studentQuery = { q: slowQ, teacher: '', supervisor: '', status: '' as const, page: 1 }
  const students = useQuery({
    queryKey: studentKeys.list(studentQuery),
    queryFn: () => studentsApi.list(studentQuery),
    enabled: canStudents && slowQ.length >= 2,
    staleTime: 60_000,
  })

  const hits = useMemo<Hit[]>(() => {
    if (!q) return []
    const out: Hit[] = []
    const take = (group: GroupKey, rows: Array<Omit<Hit, 'group' | 'match'> & { alt?: string }>) => {
      let n = 0
      for (const r of rows) {
        if (n >= PER_GROUP) break
        const match = findMatch(r.text, q)
        const altMatch = match ? null : r.sub ? findMatch(r.sub, q) : null
        const hidden = match || altMatch ? null : r.alt ? findMatch(r.alt, q) : null
        if (!match && !altMatch && !hidden) continue
        out.push({ id: r.id, group, icon: r.icon, text: r.text, sub: r.sub, match, to: r.to })
        n++
      }
    }

    const seen = new Set<string>()
    const parentRows = [...(parents.data?.items ?? []), ...(moreParents.data?.items ?? [])].filter((p) => {
      if (seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })
    take('parents', parentRows.map((p) => ({
      id: `p:${p.id}`,
      icon: 'parents' as const,
      text: p.name,
      sub: p.family.name,
      to: parentPath(p.id),
    })))

    take('students', (students.data?.students ?? []).map((s) => ({
      id: `s:${s.id}`,
      icon: 'students' as const,
      text: s.name,
      sub: [s.family.displayName, s.teacher?.name].filter(Boolean).join(' · '),
      to: studentPath(s.id),
    })))

    const copy = chatCopyFor(locale)
    take('conversations', (chats.data ?? []).map((c) => ({
      id: `c:${c.id}`,
      icon: 'conversations' as const,
      text: conversationName(c, staff?.id, copy),
      sub: copy.kind[c.type] ?? undefined,
      alt: (c.members ?? []).map((m) => m.displayName).join(' '),
      to: `/chat/${encodeURIComponent(c.id)}`,
    })))

    const pages = [
      { id: 'page:today', icon: 'home' as const, text: tx(S.today), to: '/today' },
      { id: 'page:requests', icon: 'requests' as const, text: tx(S.requests), to: '/requests' },
      ...entries.filter((e) => !e.inDevelopment).map((e) => ({ id: `page:${e.path}`, icon: e.icon, text: entryLabel(e), to: e.path })),
      { id: 'page:notifications', icon: 'notifications' as const, text: tx(S.notifications), to: '/notifications' },
      { id: 'page:profile', icon: 'staff' as const, text: tx(S.profile), to: '/profile' },
    ]
    take('pages', pages)

    const actions = [
      has('/payments') && { id: 'act:pay', icon: 'payments' as const, text: tx(S.recordPayment), to: '/payments?tab=transactions' },
      has('/instalments') && { id: 'act:late', icon: 'instalments' as const, text: tx(S.lateInstalments), to: '/instalments' },
      canChat && { id: 'act:chat', icon: 'conversations' as const, text: tx(S.newChat), to: '/chat' },
      has('/trials') && { id: 'act:trial', icon: 'trials' as const, text: tx(S.bookTrial), to: '/trials' },
      has('/tasks') && { id: 'act:tasks', icon: 'tasks' as const, text: tx(S.newTask), to: '/tasks' },
    ].filter((a): a is Exclude<typeof a, false> => a !== false)
    take('actions', actions)
    return out
  }, [q, parents.data, moreParents.data, students.data, chats.data, entries, entryLabel, has, canChat, locale, staff?.id, tx])

  // Grouped for display, flat for the keyboard.
  const groups = GROUP_ORDER.map((g) => ({ key: g, items: hits.filter((h) => h.group === g) })).filter((g) => g.items.length > 0)
  const flat = groups.flatMap((g) => g.items)

  useEffect(() => setActive(0), [q])

  useEffect(() => {
    restore.current = document.activeElement
    inputRef.current?.focus()
    return () => {
      if (restore.current instanceof HTMLElement) restore.current.focus()
    }
  }, [])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const open = (hit: Hit) => {
    remember(q)
    onClose()
    navigate(hit.to)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0))
    } else if (e.key === 'Enter') {
      const hit = flat[active]
      if (hit) {
        e.preventDefault()
        open(hit)
      }
    } else if (e.key === 'Tab') {
      // The palette is one field and one list: Tab stays inside it.
      e.preventDefault()
    }
  }

  const loading = q.length >= 2 && (students.isFetching || moreParents.isFetching || (q !== slowQ && (canStudents || parents.data?.truncated === true)))

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={tx(S.open)} onKeyDown={onKeyDown}>
        <div className="palette__field">
          <Icon name="search" size={20} />
          <input
            ref={inputRef}
            className="palette__input"
            type="text"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            aria-label={tx(S.placeholder)}
            placeholder={tx(S.input)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <span className="spinner palette__spinner" aria-hidden="true" />}
          <button type="button" className="kbd palette__esc" onClick={onClose} aria-label={tx(S.close)}>
            Esc
          </button>
        </div>

        <div className="palette__body" id={listId} role="listbox" aria-label={tx(S.results)} ref={listRef}>
          {!q && recent.length > 0 && (
            <div className="palette__group">
              <p className="palette__heading">{tx(S.recent)}</p>
              {recent.map((r) => (
                <button type="button" key={r} className="palette__row palette__row--recent" onClick={() => setQuery(r)} tabIndex={-1}>
                  <Icon name="clock" size={17} />
                  <span className="palette__text">{r}</span>
                </button>
              ))}
            </div>
          )}
          {!q && recent.length === 0 && <p className="palette__hint">{tx(S.start)}</p>}
          {q && flat.length === 0 && !loading && <p className="palette__hint">{fill(tx(S.none), { q })}</p>}
          {groups.map((g) => (
            <div className="palette__group" key={g.key} role="group" aria-label={tx(S[g.key])}>
              <p className="palette__heading" aria-hidden="true">
                {tx(S[g.key])}
              </p>
              {g.items.map((hit) => {
                const i = flat.indexOf(hit)
                return (
                  <div
                    key={hit.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className="palette__row"
                    onMouseMove={() => setActive(i)}
                    onClick={() => open(hit)}
                  >
                    <Icon name={hit.icon} size={18} />
                    <span className="palette__text">
                      <Highlight text={hit.text} match={hit.match} />
                    </span>
                    {hit.sub && <span className="palette__sub">{hit.sub}</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="palette__foot" aria-hidden="true">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> {tx(S.move)}
          </span>
          <span>
            <span className="kbd">↵</span> {tx(S.go)}
          </span>
          <span>
            <span className="kbd">Esc</span> {tx(S.close)}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Ctrl/Cmd+K anywhere, or "/" when not typing, opens the palette. */
export function useSearchShortcut(open: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        open()
        return
      }
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (typing) return
      e.preventDefault()
      open()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])
}

export { normalize }
