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
import { Avatar } from '@/shared/components/Avatar'
import { Icon, type IconName } from '@/shared/components/Icon'
import { PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { formatMoney } from '@/features/instalments/copy'
import { parentPath } from '@/features/profiles/api'
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
  doNext: { en: 'Do next', ar: 'ابدأ بهذا' },
  replies: { en: 'Waiting for a reply', ar: 'بانتظار رد' },
  lateGroup: { en: 'Late instalments', ar: 'أقساط متأخرة' },
  taskGroup: { en: 'Overdue tasks', ar: 'مهام متأخرة' },
  receiptGroup: { en: 'Receipts to confirm', ar: 'إيصالات للتأكيد' },
  open: { en: 'Open', ar: 'فتح' },
  answer: { en: 'Answer', ar: 'ردّ' },
  review: { en: 'Review', ar: 'مراجعة' },
  file: { en: 'Open file', ar: 'فتح الملف' },
  seeAll: { en: 'See all', ar: 'عرض الكل' },
  daysLate: { en: '{n} days late', ar: 'متأخر {n} يومًا' },
  dayLate: { en: '1 day late', ar: 'متأخر يومًا واحدًا' },
  clear: { en: 'Nothing is waiting on you. New replies, late instalments, overdue tasks and receipts appear here, most urgent first.', ar: 'لا شيء بانتظارك. تظهر هنا الردود الجديدة والأقساط المتأخرة والمهام المتأخرة والإيصالات، الأشد إلحاحًا أولًا.' },
  goChats: { en: 'Open conversations', ar: 'فتح المحادثات' },
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
  requests: { en: 'All requests', ar: 'كل الطلبات' },
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
  // The requests queue gathers trials, new students, certificates, renewals and receipts.
  const hasRequests = pathTo('/trials') !== null || pathTo('/certificates') !== null || paymentsPath !== null

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

  const copy = chatCopyFor(locale)

  const needsReply = [...(chats.data ?? [])]
    .filter((c) => c.needsReply || (c.unreadCount ?? 0) > 0)
    .sort((a, b) => Number(b.needsReply) - Number(a.needsReply) || String(a.lastActivityAt ?? '').localeCompare(String(b.lastActivityAt ?? '')))
  const late = (instalments.data?.items ?? []).filter((i) => i.status === 'overdue').sort((a, b) => b.days - a.days)
  const overdueTasks = tasks.data?.items ?? []
  const pending = receipts.data?.items ?? []
  // The conversation that has waited longest for a reply comes first.
  const first = needsReply[0]

  const figures: MastFigure[] = []
  if (instalmentsPath && instalments.data) {
    const c = instalments.data.counts
    figures.push({ key: 'late', label: tx(T.late), value: num.format(c.overdue), note: c.due > 0 ? fillN(tx(T.dueToday), num.format(c.due)) : undefined, tone: c.overdue > 0 ? 'urgent' : 'quiet', to: instalmentsPath })
  }
  if (chatPath === '/chat' && chats.data) figures.push({ key: 'chats', label: tx(T.replies), value: num.format(needsReply.length), tone: needsReply.length > 0 ? 'key' : 'quiet', to: '/chat' })
  if (tasksPath && tasks.data) figures.push({ key: 'tasks', label: tx(T.tasks), value: num.format(overdueTasks.length), tone: overdueTasks.length > 0 ? undefined : 'quiet', to: tasksPath })
  if (paymentsPath && receipts.data) figures.push({ key: 'receipts', label: tx(T.receipts), value: num.format(receipts.data.counts.pending ?? pending.length), tone: pending.length > 0 ? undefined : 'quiet', to: paymentsPath })

  /** One thing to do: what it is, the one fact that makes it urgent, and where it is done. */
  interface Todo { key: string; icon: IconName; title: string; line?: string; fact?: string; age?: string; urgent?: boolean; to: string; action: string }
  const groups: Array<{ key: string; label: string; urgent: boolean; total: number; all: string; items: Todo[] }> = []
  if (chatPath === '/chat' && needsReply.length > 0) {
    groups.push({
      key: 'replies', label: tx(T.replies), urgent: needsReply.some((c) => c.needsReply), total: needsReply.length, all: '/chat',
      items: needsReply.slice(0, 4).map((c) => ({
        key: c.id, icon: 'conversations' as const, title: conversationName(c, staff?.id, copy), line: c.lastMessage?.text ?? undefined,
        age: relativeTime(c.lastActivityAt, locale), urgent: c.needsReply, to: `/chat/${encodeURIComponent(c.id)}`, action: tx(T.answer),
      })),
    })
  }
  if (instalmentsPath && late.length > 0) {
    groups.push({
      key: 'late', label: tx(T.lateGroup), urgent: true, total: late.length, all: instalmentsPath,
      items: late.slice(0, 4).map((i) => ({
        key: i.id, icon: 'instalments' as const, title: i.account.name || i.family.name, line: [i.child?.name, i.label].filter(Boolean).join(locale === 'ar' ? '، ' : ', ') || i.family.name,
        fact: formatMoney(i.amountMinor, i.currency, locale), age: i.days === 1 ? tx(T.dayLate) : fillN(tx(T.daysLate), num.format(i.days)), urgent: true,
        to: i.account.id ? parentPath(i.account.id) : instalmentsPath, action: tx(T.file),
      })),
    })
  }
  if (tasksPath && overdueTasks.length > 0) {
    groups.push({
      key: 'tasks', label: tx(T.taskGroup), urgent: true, total: overdueTasks.length, all: tasksPath,
      items: overdueTasks.slice(0, 4).map((t) => ({
        key: t.id, icon: 'tasks' as const, title: t.title, line: t.createdBy?.name ?? undefined,
        age: t.dueAt ? relativeTime(t.dueAt, locale) : undefined, urgent: true, to: tasksPath, action: tx(T.open),
      })),
    })
  }
  if (paymentsPath && pending.length > 0) {
    groups.push({
      key: 'receipts', label: tx(T.receiptGroup), urgent: false, total: receipts.data?.counts.pending ?? pending.length, all: paymentsPath,
      items: pending.slice(0, 3).map((r) => ({
        key: r.id, icon: 'payments' as const, title: r.family?.name ?? r.label, line: r.label,
        fact: formatMoney(r.amountMinor, r.currency, locale), to: paymentsPath, action: tx(T.review),
      })),
    })
  }
  const loadingQueue = (chatPath === '/chat' && chats.isLoading) || (instalmentsPath !== null && instalments.isLoading) || (tasksPath !== null && tasks.isLoading)

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
        <PageHeader
          title={tx(T.title)}
          subtitle={locale === 'ar' ? `${gregorian}، ${hijri}` : `${gregorian}, ${hijri}`}
          figures={figures}
          actions={
            first ? (
              <Link to={`/chat/${encodeURIComponent(first.id)}`} className="btn btn--primary">
                <Icon name="conversations" size={18} />
                {tx(T.first)} {conversationName(first, staff?.id, copy)}
              </Link>
            ) : chatPath === '/chat' ? (
              <Link to="/chat" className="btn">
                {tx(T.goChats)}
              </Link>
            ) : undefined
          }
        />

        <div className="split split--wide-aside">
          <section className="today__queue" aria-labelledby="today-next">
            <div className="today__queue-head">
              <h2 className="today__h" id="today-next">
                {tx(T.doNext)}
              </h2>
              {hasRequests && (
                <Link to="/requests" className="card__link">
                  {tx(T.requests)}
                </Link>
              )}
            </div>
            {groups.length === 0 && !loadingQueue && (
              <div className="sheet">
                <p className="today__clear">
                  <Icon name="checkCircle" size={20} />
                  {tx(T.clear)}
                </p>
              </div>
            )}
            {groups.map((g) => (
              <section className="sheet today__group" key={g.key} aria-label={g.label}>
                <header className="sheet__head">
                  <h3 className="sheet__title">
                    {g.label}
                    <span className={g.urgent ? 'count count--urgent today__count' : 'count today__count'}>{num.format(g.total)}</span>
                  </h3>
                  {g.total > g.items.length && (
                    <Link to={g.all} className="card__link">
                      {tx(T.seeAll)}
                    </Link>
                  )}
                </header>
                <ul className="todo">
                  {g.items.map((it) => (
                    <li key={it.key} className={it.urgent ? 'todo__row todo__row--urgent' : 'todo__row'}>
                      <Avatar name={it.title} />
                      <span className="todo__main">
                        <bdi className="todo__title">{it.title}</bdi>
                        {it.line && <bdi className="todo__line">{it.line}</bdi>}
                      </span>
                      <span className="todo__facts">
                        {it.fact && <bdi className="todo__fact">{it.fact}</bdi>}
                        {it.age && <span className={it.urgent ? 'todo__age todo__age--late' : 'todo__age'}>{it.age}</span>}
                      </span>
                      <Link to={it.to} className="btn btn--sm">
                        {it.action}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </section>

          <aside className="today__aside">
            {calendarPath && (
              <section className="aside-group" aria-labelledby="today-lessons">
                <div className="today__section-head">
                  <h2 className="aside-group__title" id="today-lessons">
                    {tx(T.lessons)}
                    {lessons.length > 0 && <span className="count count--quiet today__count">{num.format(lessons.length)}</span>}
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
                          <time className="tl__time ltr" dateTime={l.startsAt}>
                            {clock12In(l.startsAt, ACADEMY_ZONE, locale)}
                          </time>
                          <span className="tl__who">
                            <bdi>{who}</bdi>
                            <bdi className="tl__teacher">{teacherName(l.teacherId)}</bdi>
                          </span>
                          {tagText && <span className={problem ? 'badge badge--danger' : 'badge badge--info'}>{tagText}</span>}
                        </li>
                      )
                    })}
                  </ol>
                )}
                {week.data && weekDays.some((d) => d.lessons > 0) && (
                  <ol className="weekticks" aria-label={tx(T.week)}>
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
                )}
              </section>
            )}

            <section className="aside-group" aria-labelledby="today-activity">
              <div className="today__section-head">
                <h2 className="aside-group__title" id="today-activity">
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
                  {inbox.data!.entries.slice(0, 6).map((e) => (
                    <li key={e.id} className="today__line">
                      <span className={e.read ? 'today__dot' : 'today__dot today__dot--new'} aria-hidden="true" />
                      <span className="today__line-text">
                        <strong>{e.title}</strong>
                        {e.body && !e.body.startsWith(e.title) && <span> {e.body}</span>}
                        {e.body && e.body.startsWith(e.title) && e.body.length > e.title.length && <span>{e.body.slice(e.title.length)}</span>}
                      </span>
                      <time className="today__line-time" dateTime={e.at}>
                        {relativeTime(e.at, locale)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}
