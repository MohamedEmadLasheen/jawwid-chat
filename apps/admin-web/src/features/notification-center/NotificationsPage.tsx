import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { QueryBoundary } from '@/shared/components/States'
import { inboxApi, inboxKeys, routeFor, type InboxEntryDto, type InboxTab, type NotificationSettingsDto } from './api'
import { CATEGORIES, N, SYSTEM, TABS, useCopy } from './copy'
import './notification-center.css'

/**
 * PD-34 `/notifications`: the signed-in staff member's own Notification
 * Center, with the tabs the server says they have, and their own notification
 * settings below it.
 */
export function NotificationsPage() {
  const tx = useCopy()
  const counts = useQuery({ queryKey: inboxKeys.counts, queryFn: inboxApi.counts })
  const tabs = counts.data?.tabs ?? ['all']
  const [chosen, setTab] = useState<InboxTab>('all')
  const tab = tabs.includes(chosen) ? chosen : 'all'

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader title={tx(N.title)} subtitle={tx(N.subtitle)} />
        <div className="nc-tabs">
          <FilterChips<InboxTab>
            label={tx(N.title)}
            value={tab}
            onChange={setTab}
            variant="tabs"
            options={tabs.map((t) => ({ value: t, label: tx(TABS[t]), count: t === 'all' ? undefined : counts.data?.perTab[t] }))}
          />
        </div>
        <TabList key={tab} tab={tab} />
        <SettingsPanel />
      </div>
    </div>
  )
}

function TabList({ tab }: { tab: InboxTab }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const navigate = useNavigate()
  const client = useQueryClient()
  const list = useInfiniteQuery({
    queryKey: inboxKeys.tab(tab),
    queryFn: ({ pageParam }) => inboxApi.list(tab, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  })
  const entries = list.data?.pages.flatMap((p) => p.entries) ?? []
  const refresh = () => void client.invalidateQueries({ queryKey: inboxKeys.all })
  const readAll = useMutation({ mutationFn: () => inboxApi.readAll(tab), onSuccess: refresh })

  const open = async (entry: InboxEntryDto, to: string) => {
    try {
      await inboxApi.acted(entry.id)
    } catch {
      // Recording the click is a courtesy; opening the page is what was asked.
    }
    refresh()
    navigate(to)
  }

  return (
    <QueryBoundary
      isLoading={list.isLoading}
      error={list.error}
      isEmpty={entries.length === 0}
      emptyTitle={tx(N.empty)}
      emptyIcon="notifications"
      onRetry={() => void list.refetch()}
    >
      {entries.some((e) => !e.read) && (
        <button type="button" className="btn btn--sm" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
          {tx(N.markAllRead)}
        </button>
      )}
      <ul className="nc-list">
        {entries.map((entry) => {
          const to = routeFor(entry.action)
          return (
            <li key={entry.id} className={`nc-item${entry.read ? '' : ' nc-item--unread'}`} data-testid={`nc-${entry.id}`}>
              <span className="nc-item__title">{entry.title}</span>
              <time className="nc-item__time" dateTime={entry.at}>
                {dateTime(entry.at)}
              </time>
              <p className="nc-item__body">{entry.body}</p>
              {to && (
                <div className="nc-item__actions">
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => void open(entry, to)}>
                    {tx(N.open)}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {list.hasNextPage && (
        <button type="button" className="btn btn--sm" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
          {tx(N.loadOlder)}
        </button>
      )}
    </QueryBoundary>
  )
}

const toClock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const fromClock = (v: string): number | null => {
  const [h, m] = v.split(':').map(Number)
  return h !== undefined && m !== undefined && Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null
}

function SettingsPanel() {
  const tx = useCopy()
  const client = useQueryClient()
  const settings = useQuery({ queryKey: inboxKeys.settings, queryFn: inboxApi.settings })
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => inboxApi.setSettings(body),
    onSuccess: (next) => client.setQueryData(inboxKeys.settings, next),
  })
  const s = settings.data

  return (
    <section className="nc-settings" aria-labelledby="nc-settings-title">
      <h2 id="nc-settings-title">{tx(N.settings)}</h2>
      <QueryBoundary isLoading={settings.isLoading} error={settings.error} onRetry={() => void settings.refetch()} compact>
        {s && <SettingsForm settings={s} saving={save.isPending} onSave={(body) => save.mutate(body)} />}
      </QueryBoundary>
    </section>
  )
}

function SettingsForm({
  settings,
  saving,
  onSave,
}: {
  settings: NotificationSettingsDto
  saving: boolean
  onSave: (body: Record<string, unknown>) => void
}) {
  const tx = useCopy()
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
      <div className="nc-settings__row">
        <label className="nc-settings__row">
          <input type="checkbox" checked={q.enabled} disabled={saving} onChange={(e) => quiet(e.target.checked)} />
          <strong>{tx(N.quietHours)}</strong>
        </label>
      </div>
      <p className="field__hint">{tx(N.quietHint)}</p>
      <div className="nc-settings__row">
        <label>
          {tx(N.from)} <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {tx(N.until)} <input type="time" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <button type="button" className="btn btn--sm" disabled={saving} onClick={() => quiet(true)}>
          {tx(N.save)}
        </button>
        {!q.isDefault && (
          <button type="button" className="btn btn--sm btn--ghost" disabled={saving} onClick={() => onSave({ quietHours: null })}>
            {tx(N.useDefault)}
          </button>
        )}
      </div>
      <h3>{tx(N.pushHeading)}</h3>
      <p className="field__hint">{tx(N.pushHint)}</p>
      {settings.categories.map((c) => (
        <label key={c.category} className="nc-settings__row">
          <input
            type="checkbox"
            checked={c.locked || c.push}
            disabled={c.locked || saving}
            onChange={(e) => onSave({ categories: [{ category: c.category, push: e.target.checked }] })}
          />
          {tx(CATEGORIES[c.category] ?? SYSTEM)}
          {c.locked && <span className="field__hint">{tx(N.alwaysOn)}</span>}
        </label>
      ))}
    </>
  )
}
