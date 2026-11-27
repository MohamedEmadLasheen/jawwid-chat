import { useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon, type IconName } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { inboxApi, inboxKeys, routeFor, type InboxEntryDto, type InboxTab, type NotificationSettingsDto } from './api'
import { CATEGORIES, N, SYSTEM, TABS, useCopy, type Pair } from './copy'
import { fill, relativeTime } from '@/features/admin/copy'
import './notification-center.css'

type View = InboxTab | 'settings'

const CATEGORY_ICON: Record<string, IconName> = {
  lesson: 'calendar',
  payment: 'card',
  conversation: 'conversations',
  call: 'calls',
  task: 'tasks',
  announcement: 'megaphoneSimple',
  system: 'info',
}

const DAY_MS = 86_400_000

/** What an entry's one action opens, said on its button. */
const OPEN_LABEL: Record<string, Pair> = {
  open_conversation: { en: 'Open conversation', ar: 'افتح المحادثة' },
  open_calls: { en: 'Open calls', ar: 'افتح المكالمات' },
  view_payments: { en: 'Open payments', ar: 'افتح المدفوعات' },
  open_case: { en: 'Open escalation', ar: 'افتح التصعيد' },
  open_task: { en: 'Open task', ar: 'افتح المهمة' },
  open_teacher_records: { en: "Open teacher's record", ar: 'افتح سجل المعلم' },
}

/** The reader's own calendar day of an instant, as a sortable key. */
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * PD-34 `/notifications`: the signed-in staff member's own Notification
 * Center, with the tabs the server says they have, and their own notification
 * settings as the last tab.
 *
 * An agenda: the masthead says how many are unread and marks them read; the
 * entries are grouped by day (today, yesterday, then dates), each a line with
 * its kind, what happened and when, and the way to its page at the end.
 */
export function NotificationsPage() {
  const tx = useCopy()
  const client = useQueryClient()
  const counts = useQuery({
    queryKey: inboxKeys.counts,
    queryFn: inboxApi.counts,
  })
  const tabs = counts.data?.tabs ?? ['all']
  const [chosen, setView] = useState<View>('all')
  const view: View = chosen === 'settings' || tabs.includes(chosen) ? chosen : 'all'
  const tab: InboxTab = view === 'settings' ? 'all' : view
  const readAll = useMutation({
    mutationFn: () => inboxApi.readAll(tab),
    onSuccess: () => void client.invalidateQueries({ queryKey: inboxKeys.all }),
  })
  const unread = counts.data?.unread

  return (
    <div className="page nc-page">
      <div className="page__inner">
        <PageHeader
          title={tx(N.title)}
          actions={
            view !== 'settings' && (unread ?? 0) > 0 ? (
              <button type="button" className="btn" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
                <Icon name="doubleCheck" size={16} />
                {tx(N.markAllRead)}
              </button>
            ) : undefined
          }
          tabs={
            <FilterChips<View>
              label={tx(N.title)}
              value={view}
              onChange={setView}
              variant="tabs"
              options={[
                ...tabs.map((t) => ({
                  value: t as View,
                  label: tx(TABS[t]),
                  count: t === 'all' || !counts.data?.perTab[t] ? undefined : counts.data.perTab[t],
                })),
                { value: 'settings' as View, label: tx(N.settingsTab) },
              ]}
            />
          }
        />
        {view === 'settings' ? <SettingsPanel /> : <Agenda key={tab} tab={tab} onShowAll={() => setView('all')} />}
      </div>
    </div>
  )
}

function Agenda({ tab, onShowAll }: { tab: InboxTab; onShowAll: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const navigate = useNavigate()
  const client = useQueryClient()
  const list = useInfiniteQuery({
    queryKey: inboxKeys.tab(tab),
    queryFn: ({ pageParam }) => inboxApi.list(tab, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  })
  const entries = useMemo(() => list.data?.pages.flatMap((p) => p.entries) ?? [], [list.data])
  const refresh = () => void client.invalidateQueries({ queryKey: inboxKeys.all })

  const open = async (entry: InboxEntryDto, to: string) => {
    try {
      await inboxApi.acted(entry.id)
    } catch {
      // Recording the click is a courtesy; opening the page is what was asked.
    }
    refresh()
    navigate(to)
  }

  // What still asks the reader to act leads, the nearest breach first (no due time last).
  const asks = useMemo(
    () =>
      entries
        .filter((e) => e.requiresAction && !e.acted)
        .sort((x, y) => (x.dueAt ? Date.parse(x.dueAt) : Infinity) - (y.dueAt ? Date.parse(y.dueAt) : Infinity)),
    [entries],
  )
  // The rest, grouped by the reader's own day, newest first as the server sends them.
  const days = useMemo(() => {
    const out: Array<{ key: string; entries: InboxEntryDto[] }> = []
    for (const e of entries) {
      if (e.requiresAction && !e.acted) continue
      const key = dayKey(new Date(e.at))
      const last = out[out.length - 1]
      if (last && last.key === key) last.entries.push(e)
      else out.push({ key, entries: [e] })
    }
    return out
  }, [entries])
  const now = new Date()
  const today = dayKey(now)
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const dayFmt = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  // The reader's own clock, as the days are the reader's own.
  const clock = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    hour: 'numeric',
    minute: '2-digit',
  })
  const dayLabel = (key: string) => (key === today ? tx(N.today) : key === yesterday ? tx(N.yesterday) : dayFmt.format(new Date(`${key}T12:00:00`)))

  const row = (entry: InboxEntryDto) => {
    const to = routeFor(entry.action)
    const waiting = entry.requiresAction && !entry.acted
    // Time to breach, where the server gives a due time: amber in the last day, red once it has passed.
    const due = waiting && entry.dueAt ? Date.parse(entry.dueAt) - now.getTime() : null
    const breach = due === null ? null : due < 0 ? 'late' : due < DAY_MS ? 'soon' : 'later'
    return (
      <li key={entry.id} className={`nc-item${entry.read ? '' : ' nc-item--unread'}`} data-testid={`nc-${entry.id}`}>
        <span className="nc-item__icon" title={tx(CATEGORIES[entry.category] ?? SYSTEM)}>
          <Icon name={entry.action?.kind === 'open_case' ? 'needsAction' : (CATEGORY_ICON[entry.category] ?? 'info')} size={18} />
          {!entry.read && <span className="nc-item__dot" role="img" aria-label={tx(TABS.unread)} />}
        </span>
        <div className="nc-item__text">
          <span className="nc-item__title">
            <bdi>{entry.title}</bdi>
          </span>
          {entry.body && (
            <p className="nc-item__body">
              <bdi>{entry.body}</bdi>
            </p>
          )}
          {waiting && (
            <p className={`nc-item__due${breach ? ` nc-item__due--${breach}` : ''}`}>
              <span className="nc-item__ask">{tx(TABS.action)}</span>
              {entry.dueAt && (
                <span>
                  {fill(tx(breach === 'late' ? N.wasDue : N.dueBy), {
                    when: relativeTime(entry.dueAt, locale, now),
                  })}
                </span>
              )}
            </p>
          )}
        </div>
        <time className="nc-item__time" dateTime={entry.at}>
          {clock.format(new Date(entry.at))}
        </time>
        <div className="nc-item__actions">
          {to && (
            <button
              type="button"
              className={waiting ? 'btn btn--sm nc-item__open' : 'btn btn--sm btn--ghost nc-item__open'}
              onClick={() => void open(entry, to)}
            >
              {tx(OPEN_LABEL[entry.action?.kind ?? ''] ?? N.open)}
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <div className="sheet nc-sheet">
      <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
        {entries.length === 0 && (
          <EmptyState
            title={tx(tab === 'all' ? N.empty : N.emptyTab)}
            hint={tx(tab === 'all' ? N.emptyHint : N.emptyTabHint)}
            action={
              tab === 'all' ? undefined : (
                <button type="button" className="btn btn--sm" onClick={onShowAll}>
                  {tx(N.showAll)}
                </button>
              )
            }
          />
        )}
        {asks.length > 0 && (
          <section className="nc-day nc-day--asks" aria-labelledby="nc-asks">
            <h2 className="nc-day__head" id="nc-asks">
              <span>{tx(N.asks)}</span>
              <span className="count count--urgent">{asks.length}</span>
            </h2>
            <ul className="nc-list">{asks.map(row)}</ul>
          </section>
        )}
        {days.map((day) => (
          <section key={day.key} className="nc-day" aria-labelledby={`nc-day-${day.key}`}>
            <h2 className="nc-day__head" id={`nc-day-${day.key}`}>
              <span>{dayLabel(day.key)}</span>
            </h2>
            <ul className="nc-list">{day.entries.map(row)}</ul>
          </section>
        ))}
        {list.hasNextPage && (
          <div className="nc-more">
            <button type="button" className="btn btn--sm" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {tx(N.loadOlder)}
            </button>
          </div>
        )}
      </QueryBoundary>
    </div>
  )
}

const toClock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const fromClock = (v: string): number | null => {
  const [h, m] = v.split(':').map(Number)
  return h !== undefined && m !== undefined && Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null
}

type Group = 'push' | 'quiet'

/** Settings: the groups at the start, one group's sheet beside them. */
function SettingsPanel() {
  const tx = useCopy()
  const client = useQueryClient()
  const [group, setGroup] = useState<Group>('push')
  const settings = useQuery({
    queryKey: inboxKeys.settings,
    queryFn: inboxApi.settings,
  })
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => inboxApi.setSettings(body),
    onSuccess: (next) => client.setQueryData(inboxKeys.settings, next),
  })
  const s = settings.data
  const groups: Array<{ key: Group; label: string; icon: IconName }> = [
    { key: 'push', label: tx(N.pushHeading), icon: 'notifications' },
    { key: 'quiet', label: tx(N.quietHours), icon: 'bellOff' },
  ]

  return (
    <section className="nc-settings" aria-labelledby="nc-settings-title">
      <h2 id="nc-settings-title" className="sr-only">
        {tx(N.settings)}
      </h2>
      <nav className="nc-settings__nav" aria-label={tx(N.settings)}>
        {groups.map((g) => (
          <button key={g.key} type="button" className="nc-settings__link" aria-current={group === g.key ? 'true' : undefined} onClick={() => setGroup(g.key)}>
            <Icon name={g.icon} size={18} />
            {g.label}
          </button>
        ))}
      </nav>
      <div className="sheet nc-settings__sheet">
        <div className="sheet__head">
          <h3 className="sheet__title">{groups.find((g) => g.key === group)!.label}</h3>
        </div>
        <div className="sheet__body">
          <QueryBoundary isLoading={settings.isLoading} error={settings.error} onRetry={() => void settings.refetch()} compact>
            {s && group === 'push' && <PushForm settings={s} saving={save.isPending} onSave={(body) => save.mutate(body)} />}
            {s && group === 'quiet' && <QuietForm settings={s} saving={save.isPending} onSave={(body) => save.mutate(body)} />}
          </QueryBoundary>
        </div>
      </div>
    </section>
  )
}

interface FormProps {
  settings: NotificationSettingsDto
  saving: boolean
  onSave: (body: Record<string, unknown>) => void
}

function PushForm({ settings, saving, onSave }: FormProps) {
  const tx = useCopy()
  return (
    <>
      <p className="field__hint nc-settings__hint">{tx(N.pushHint)}</p>
      <ul className="nc-kinds">
        {settings.categories.map((c) => (
          <li key={c.category}>
            <label className={c.locked ? 'nc-check nc-check--locked' : 'nc-check'}>
              <input
                type="checkbox"
                checked={c.locked || c.push}
                disabled={c.locked || saving}
                onChange={(e) =>
                  onSave({
                    categories: [{ category: c.category, push: e.target.checked }],
                  })
                }
              />
              <Icon name={CATEGORY_ICON[c.category] ?? 'info'} size={18} />
              <span className="nc-check__name">{tx(CATEGORIES[c.category] ?? SYSTEM)}</span>
              {c.locked && (
                <span className="nc-check__note">
                  <Icon name="lock" size={14} />
                  {tx(N.alwaysOn)}
                </span>
              )}
            </label>
          </li>
        ))}
      </ul>
    </>
  )
}

function QuietForm({ settings, saving, onSave }: FormProps) {
  const tx = useCopy()
  const ids = useId()
  const q = settings.quietHours
  const [from, setFrom] = useState(toClock(q.startMinute))
  const [until, setUntil] = useState(toClock(q.endMinute))
  const quiet = (enabled: boolean) => {
    const startMinute = fromClock(from)
    const endMinute = fromClock(until)
    if (startMinute === null || endMinute === null) return
    onSave({ quietHours: { enabled, startMinute, endMinute } })
  }
  return (
    <>
      <label className="nc-check nc-check--lead">
        <input type="checkbox" checked={q.enabled} disabled={saving} onChange={(e) => quiet(e.target.checked)} />
        <strong>{tx(N.quietHours)}</strong>
      </label>
      <p className="field__hint nc-settings__hint">{tx(N.quietHint)}</p>
      <div className="nc-hours">
        <div className="field">
          <label className="field__label" htmlFor={`${ids}-from`}>
            {tx(N.from)}
          </label>
          {/* A native time control: left to right in both languages, under its label. */}
          <input id={`${ids}-from`} className="input" type="time" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${ids}-until`}>
            {tx(N.until)}
          </label>
          <input id={`${ids}-until`} className="input" type="time" dir="ltr" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
      </div>
      <div className="nc-settings__actions">
        <button type="button" className="btn btn--primary" disabled={saving} onClick={() => quiet(true)}>
          {tx(N.save)}
        </button>
        {!q.isDefault && (
          <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => onSave({ quietHours: null })}>
            {tx(N.useDefault)}
          </button>
        )}
      </div>
    </>
  )
}
