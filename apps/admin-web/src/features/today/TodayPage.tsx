import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ACADEMY_ZONE, clock12In } from '@/core/time/academyTime'
import { useDestinations } from '@/app/useDestinations'
import { entriesOf } from '@/app/navigation'
import { relativeTime, useText, type Bilingual } from '@/features/admin/copy'
import { chatApi, chatKeys } from '@/features/chat/chatApi'
import { chatCopyFor } from '@/features/chat/copy'
import { conversationName } from '@/features/chat/chatView'
import { instalmentKeys, instalmentsApi } from '@/features/instalments/api'
import { inboxApi, inboxKeys } from '@/features/notification-center/api'
import { paymentKeys, paymentsApi } from '@/features/payments/api'
import { calendarApi, calendarKeys } from '@/features/schedule/api'
import { academyToday, addDays, weekStart } from '@/features/schedule/viewState'
import { tasksApi } from '@/features/tasks/api'
import { Icon } from '@/shared/components/Icon'
import './today.css'

/**
 * Today: what needs this person now, reached from the logo.
 *
 * Every figure comes from a list the account can already open (instalments,
 * conversations, tasks, receipts, the calendar); a figure whose page the
 * account does not have is left out rather than shown as zero.
 */

const T = {
  title: { en: 'Today', ar: 'اليوم' },
  needs: { en: 'Needs you', ar: 'بانتظارك' },
  late: { en: 'Late instalments', ar: 'أقساط متأخرة' },
  dueToday: { en: '{n} due today', ar: 'يستحق اليوم: {n}' },
  chats: { en: 'Unread chats', ar: 'محادثات غير مقروءة' },
  tasks: { en: 'Overdue tasks', ar: 'مهام متأخرة' },
  receipts: { en: 'Receipts to confirm', ar: 'إيصالات للتأكيد' },
  lessons: { en: 'Lessons today', ar: 'حصص اليوم' },
  now: { en: 'Now', ar: 'الآن' },
  noLessons: { en: 'No lessons are booked today. Booked lessons appear here in time order.', ar: 'لا حصص محجوزة اليوم. تظهر الحصص المحجوزة هنا بترتيب الوقت.' },
  calendar: { en: 'Open calendar', ar: 'فتح التقويم' },
  week: { en: 'This week', ar: 'هذا الأسبوع' },
  weekUnit: { en: 'lessons', ar: 'حصة' },
  activity: { en: 'Latest', ar: 'آخر المستجدات' },
  noActivity: { en: 'Nothing new since you last looked. Notifications appear here as they arrive.', ar: 'لا جديد منذ آخر مرة. تظهر الإشعارات هنا عند وصولها.' },
  all: { en: 'All notifications', ar: 'كل الإشعارات' },
  first: { en: 'Reply first', ar: 'ابدأ بالرد على' },
  paused: { en: 'Paused', ar: 'موقوفة' },
  unpaid: { en: 'Held for payment', ar: 'معلّقة للدفع' },
  trial: { en: 'Trial', ar: 'تجريبية' },
  makeup: { en: 'Make-up', ar: 'تعويضية' },
  moved: { en: 'Moved', ar: 'منقولة' },
  private: { en: 'Another supervisor’s lesson', ar: 'حصة لمشرف آخر' },
} satisfies Record<string, Bilingual>

function fillN(template: string, n: number | string): string {
  return template.replace('{n}', String(n))
}

export function TodayPage() {
  const { locale } = useI18n()
  const tx = useText()
  const { staff } = useSession()
  const destinations = useDestinations()
  const paths = useMemo(() => destinations.flatMap(entriesOf).map((e) => e.path), [destinations])
  const pathTo = (suffix: string) => paths.find((p) => p === suffix || p.endsWith(suffix)) ?? null
  const chatPath = pathTo('/chat')
  const tasksPath = pathTo('/tasks')
  const instalmentsPath = pathTo('/instalments')
  const paymentsPath = pathTo('/payments')
  const calendarPath = pathTo('/schedule')

  const today = academyToday()
  const from = weekStart(today)
  const dayQuery = { from: today, to: addDays(today, 1) }
  const weekQuery = { from, to: addDays(from, 7) }

  const chats = useQuery({ queryKey: chatKeys.list, queryFn: chatApi.list, enabled: chatPath === '/chat', staleTime: 30_000 })
  const instalmentQuery = { responsible: 'all' as const, paid: false }
  const instalments = useQuery({
    queryKey: instalmentKeys.list(instalmentQuery),
    queryFn: () => instalmentsApi.list(instalmentQuery),
    enabled: instalmentsPath !== null,
    staleTime: 60_000,
    retry: false,
  })
  const taskQuery = { view: 'mine' as const, state: 'open' as const, overdue: true }
  const tasks = useQuery({
    queryKey: ['tasks', 'list', taskQuery],
    queryFn: () => tasksApi.list(taskQuery),
    enabled: tasksPath !== null,
    staleTime: 60_000,
    retry: false,
  })
  const receipts = useQuery({
    queryKey: paymentKeys.receipts('pending'),
    queryFn: () => paymentsApi.receipts('pending'),
    enabled: paymentsPath !== null,
    staleTime: 60_000,
    retry: false,
  })
  const day = useQuery({
    queryKey: calendarKeys.window(dayQuery),
    queryFn: () => calendarApi.window(dayQuery),
    enabled: calendarPath !== null,
    staleTime: 60_000,
    retry: false,
  })
  const week = useQuery({
    queryKey: calendarKeys.summary(weekQuery),
    queryFn: () => calendarApi.summary(weekQuery),
    enabled: calendarPath !== null,
    staleTime: 60_000,
    retry: false,
  })
  const inbox = useQuery({ queryKey: inboxKeys.tab('all'), queryFn: () => inboxApi.list('all'), staleTime: 30_000, retry: false })

  const tag = LOCALE_TAG[locale]
  const nowDate = new Date()
  const gregorian = new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: ACADEMY_ZONE }).format(nowDate)
  // The Hijri date beside it (Umm al-Qura), in the app's own digit style.
  const hijri = new Intl.DateTimeFormat(`${tag.replace(/-u-.*/, '')}-u-ca-islamic-umalqura-nu-latn`, { day: 'numeric', month: 'long', year: 'numeric', timeZone: ACADEMY_ZONE }).format(nowDate)
  const num = new Intl.NumberFormat(tag)

  const unread = (chats.data ?? []).filter((c) => (c.unreadCount ?? 0) > 0)
  const copy = chatCopyFor(locale)
  // The conversation that has waited longest for a reply comes first.
  const first = [...unread].sort((a, b) => String(a.lastMessage?.createdAt ?? '').localeCompare(String(b.lastMessage?.createdAt ?? '')))[0]

  const cells: Array<{ key: string; label: string; value: number; note?: string; to: string; late?: boolean }> = []
  if (instalmentsPath && instalments.data) {
    const c = instalments.data.counts
    cells.push({ key: 'late', label: tx(T.late), value: c.overdue, note: c.due > 0 ? fillN(tx(T.dueToday), num.format(c.due)) : undefined, to: instalmentsPath, late: c.overdue > 0 })
  }
  if (chatPath === '/chat' && chats.data) cells.push({ key: 'chats', label: tx(T.chats), value: unread.length, to: '/chat' })
  if (tasksPath && tasks.data) cells.push({ key: 'tasks', label: tx(T.tasks), value: tasks.data.items.length, to: tasksPath, late: tasks.data.items.length > 0 })
  if (paymentsPath && receipts.data) cells.push({ key: 'receipts', label: tx(T.receipts), value: receipts.data.counts.pending ?? receipts.data.items.length, to: paymentsPath })

  const lessons = useMemo(() => [...(day.data?.lessons ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [day.data])
  const teacherName = (id: string) => day.data?.teachers.find((t) => t.id === id)?.name ?? ''
  const nowIso = nowDate.toISOString()
  const nowIndex = lessons.findIndex((l) => l.endsAt > nowIso)

  const weekDays = useMemo(() => {
    const out: Array<{ day: string; lessons: number }> = []
    for (let i = 0; i < 7; i++) out.push({ day: addDays(from, i), lessons: 0 })
    for (const c of week.data?.cells ?? []) {
      const slot = out.find((d) => d.day === c.day)
      if (slot) slot.lessons += c.lessons
    }
    return out
  }, [week.data, from])
  const weekMax = Math.max(1, ...weekDays.map((d) => d.lessons))
  const weekdayFmt = new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'UTC' })

  return (
    <div className="page today">
      <div className="page__inner">
        <header className="today__head">
          <h1 className="page-header__title">{tx(T.title)}</h1>
          <p className="today__date">
            <span>{hijri}</span>
            <span className="today__date-sep" aria-hidden="true" />
            <span>{gregorian}</span>
          </p>
        </header>

        {cells.length > 0 && (
          <section aria-labelledby="today-needs">
            <h2 className="section-label today__label" id="today-needs">
              {tx(T.needs)}
            </h2>
            <div className="ledger">
              {cells.map((c) => (
                <Link key={c.key} to={c.to} className={c.late ? 'ledger__cell ledger__cell--late' : 'ledger__cell'}>
                  <span className="ledger__label">{c.label}</span>
                  <span className={c.value === 0 ? 'ledger__value ledger__value--none' : 'ledger__value'}>{num.format(c.value)}</span>
                  {c.note && <span className="ledger__note">{c.note}</span>}
                </Link>
              ))}
            </div>
          </section>
        )}

        {first && (
          <p className="today__first">
            <span className="today__first-k">{tx(T.first)}</span>
            <Link to={`/chat/${encodeURIComponent(first.id)}`} className="today__first-link">
              {conversationName(first, staff?.id, copy)}
              <Icon name="chevronForward" size={16} />
            </Link>
          </p>
        )}

        <div className="today__cols">
          {calendarPath && (
            <section className="today__lessons" aria-labelledby="today-lessons">
              <div className="today__section-head">
                <h2 className="section-label" id="today-lessons">
                  {tx(T.lessons)}
                </h2>
                <Link to={calendarPath} className="card__link">
                  {tx(T.calendar)}
                </Link>
              </div>
              {lessons.length === 0 ? (
                <p className="today__empty">{tx(T.noLessons)}</p>
              ) : (
                <ol className="tl">
                  {lessons.map((l, i) => {
                    const problem = !l.anonymous && (l.suspendedFor === 'payment' || l.status === 'paused')
                    const tagText = l.anonymous
                      ? null
                      : l.suspendedFor === 'payment'
                        ? tx(T.unpaid)
                        : l.status === 'paused'
                          ? tx(T.paused)
                          : l.status === 'moved'
                            ? tx(T.moved)
                            : l.kind === 'trial'
                              ? tx(T.trial)
                              : l.kind === 'makeup'
                                ? tx(T.makeup)
                                : null
                    const who = l.anonymous ? tx(T.private) : (l.learner?.name ?? l.prospect?.name ?? '')
                    return (
                      <li key={l.id} className={`tl__row${problem ? ' tl__row--problem' : ''}${l.endsAt <= nowIso ? ' tl__row--past' : ''}`}>
                        {i === nowIndex && (
                          <span className="tl__now" aria-label={tx(T.now)}>
                            <span className="tl__now-text">{tx(T.now)}</span>
                          </span>
                        )}
                        {/* A time axis reads left to right in both languages. */}
                        <time className="tl__time" dir="ltr" dateTime={l.startsAt}>
                          {clock12In(l.startsAt, ACADEMY_ZONE, locale)}
                        </time>
                        <span className="tl__who">{who}</span>
                        <span className="tl__teacher">{teacherName(l.teacherId)}</span>
                        {tagText && <span className="tl__tag">{tagText}</span>}
                      </li>
                    )
                  })}
                </ol>
              )}

              {week.data && weekDays.some((d) => d.lessons > 0) && (
                <div className="today__week" aria-label={tx(T.week)}>
                  <h2 className="section-label">{tx(T.week)}</h2>
                  <ol className="weekticks">
                    {weekDays.map((d) => (
                      <li key={d.day} className={d.day === today ? 'weekticks__day weekticks__day--today' : 'weekticks__day'}>
                        <span className="weekticks__bar" aria-hidden="true">
                          <span style={{ blockSize: `${Math.round((d.lessons / weekMax) * 100)}%` }} />
                        </span>
                        <span className="weekticks__n">{num.format(d.lessons)}</span>
                        <span className="weekticks__name">{weekdayFmt.format(new Date(`${d.day}T12:00:00Z`))}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          )}

          <section className="today__activity" aria-labelledby="today-activity">
            <div className="today__section-head">
              <h2 className="section-label" id="today-activity">
                {tx(T.activity)}
              </h2>
              <Link to="/notifications" className="card__link">
                {tx(T.all)}
              </Link>
            </div>
            {(inbox.data?.entries.length ?? 0) === 0 ? (
              <p className="today__empty">{tx(T.noActivity)}</p>
            ) : (
              <ul className="ruled today__lines">
                {inbox.data!.entries.slice(0, 8).map((e) => (
                  <li key={e.id} className="today__line">
                    <span className={e.read ? 'today__dot' : 'today__dot today__dot--new'} aria-hidden="true" />
                    <span className="today__line-text">
                      <strong>{e.title}</strong>
                      {e.body && <span> {e.body}</span>}
                    </span>
                    <time className="today__line-time" dateTime={e.at}>
                      {relativeTime(e.at, locale)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
