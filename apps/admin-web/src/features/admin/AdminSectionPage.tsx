import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { findAdminSection, type AdminSection, type AdminSectionStatus, type LegacyScreen } from './sections'

type Bilingual = { en: string; ar: string }

const STATUS_LABEL: Record<AdminSectionStatus, Bilingual> = {
  read_only: { en: 'Read-only', ar: 'للقراءة فقط' },
  in_development: { en: 'In development', ar: 'قيد التطوير' },
}

const TEXT = {
  notFound: { en: 'There is no such section.', ar: 'لا يوجد قسم بهذا الاسم.' },
  placeholderTitle: {
    en: 'This section is in development.',
    ar: 'هذا القسم قيد التطوير.',
  },
  placeholderBody: {
    en: 'No data is shown because no backend for it exists yet. Nothing here is a real figure.',
    ar: 'لا تُعرض أي بيانات لعدم وجود واجهة خلفية له بعد. لا شيء هنا رقم حقيقي.',
  },
  legacyTitle: { en: 'Earlier prototype screens', ar: 'شاشات تجريبية سابقة' },
  legacyWarn: {
    en: 'These screens predate the current API. Most of what they request does not exist, so expect errors.',
    ar: 'هذه الشاشات أقدم من الواجهة الحالية. معظم ما تطلبه غير موجود، لذا توقّع ظهور أخطاء.',
  },
  truncated: {
    en: 'Showing the first 200 only.',
    ar: 'تُعرض أول 200 فقط.',
  },
  empty: { en: 'Nothing here yet.', ar: 'لا يوجد شيء بعد.' },
  selectConversation: { en: 'Select a conversation to read it.', ar: 'اختر محادثة لقراءتها.' },
  deleted: { en: 'Deleted message', ar: 'رسالة محذوفة' },
  internal: { en: 'Internal note', ar: 'ملاحظة داخلية' },
  unknownAuthor: { en: 'Unknown', ar: 'غير معروف' },
  organization: { en: 'Organization', ar: 'المؤسسة' },
  families: { en: 'Families', ar: 'العائلات' },
  contacts: { en: 'Contacts', ar: 'جهات الاتصال' },
  teachers: { en: 'Teachers', ar: 'المعلمون' },
  messages: { en: 'Messages', ar: 'الرسائل' },
  staffByRole: { en: 'Staff by role', ar: 'الموظفون حسب الدور' },
  conversationsByType: { en: 'Conversations by type', ar: 'المحادثات حسب النوع' },
  storiesByState: { en: 'Stories by state', ar: 'الحالات حسب الوضع' },
  logins: { en: 'Logins', ar: 'حسابات الدخول' },
  active: { en: 'Active', ar: 'نشط' },
  inactive: { en: 'Inactive', ar: 'غير نشط' },
} satisfies Record<string, Bilingual>

function useText() {
  const { locale } = useI18n()
  return (b: Bilingual) => (locale === 'ar' ? b.ar : b.en)
}

export function StatusBadge({ status }: { status: AdminSectionStatus }) {
  const tx = useText()
  return <Badge tone={status === 'read_only' ? 'ok' : 'today'}>{tx(STATUS_LABEL[status])}</Badge>
}

export function AdminSectionPage() {
  const { section: key } = useParams<{ section: string }>()
  const tx = useText()
  const section = findAdminSection(key)
  if (!section) return <EmptyState title={tx(TEXT.notFound)} />

  return (
    <div className="page">
      <h1 className="page__title">
        {tx(section.label)} <StatusBadge status={section.status} />
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBlockStart: 0 }}>{tx(section.note)}</p>
      <SectionBody section={section} />
      {section.legacy && <LegacyLinks screens={section.legacy} />}
    </div>
  )
}

function SectionBody({ section }: { section: AdminSection }) {
  switch (section.key) {
    case 'dashboard':
      return <OverviewView />
    case 'conversations':
      return <ConversationsView />
    case 'users':
      return <UsersView />
    case 'stories':
      return <StoriesView />
    default:
      return <DevelopmentPlaceholder />
  }
}

export function DevelopmentPlaceholder() {
  const tx = useText()
  return (
    <div className="card" role="note" data-testid="development-placeholder">
      <strong>{tx(TEXT.placeholderTitle)}</strong>
      <div style={{ marginBlockStart: 8 }}>{tx(TEXT.placeholderBody)}</div>
    </div>
  )
}

function LegacyLinks({ screens }: { screens: readonly LegacyScreen[] }) {
  const tx = useText()
  return (
    <div className="card">
      <strong>{tx(TEXT.legacyTitle)}</strong>
      <div className="banner banner--warn" style={{ marginBlock: 8 }}>
        {tx(TEXT.legacyWarn)}
      </div>
      <ul style={{ margin: 0 }}>
        {screens.map((screen) => (
          <li key={screen.path}>
            <Link to={screen.path}>{screen.path}</Link>
            {screen.note && <> — {tx(screen.note)}</>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Truncated({ truncated }: { truncated: boolean }) {
  const tx = useText()
  return truncated ? <div className="banner banner--info">{tx(TEXT.truncated)}</div> : null
}

/* --------------------------------------------------------------- overview */

function OverviewView() {
  const tx = useText()
  const { number, dateTime } = useI18n()
  const query = useQuery({ queryKey: qk.adminOverview, queryFn: adminApi.overview })
  const o = query.data

  return (
    <QueryBoundary isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {o && (
        <>
          <div className="grid grid--metrics" style={{ marginBlockEnd: 16 }}>
            <Metric label={tx(TEXT.organization)} value={o.organization.displayName} />
            <Metric label={tx(TEXT.families)} value={number(o.families)} />
            <Metric label={tx(TEXT.contacts)} value={number(o.contacts)} />
            <Metric label={tx(TEXT.teachers)} value={number(o.teachers)} />
            <Metric label={tx(TEXT.messages)} value={number(o.messages)} />
          </div>
          <div className="grid grid--metrics">
            <CountCard title={tx(TEXT.staffByRole)} counts={o.staffByRole} />
            <CountCard title={tx(TEXT.conversationsByType)} counts={o.conversationsByType} />
            <CountCard title={tx(TEXT.storiesByState)} counts={o.storiesByState} />
            <div className="card">
              <strong>{tx(TEXT.logins)}</strong>
              {/* Two cells, never "a / b": in RTL the bidi algorithm reverses
                  the pair, and "0 / 6" reads as six inactive logins. */}
              <table className="table">
                <thead>
                  <tr>
                    <th />
                    <th className="num">{tx(TEXT.active)}</th>
                    <th className="num">{tx(TEXT.inactive)}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(o.accounts).map(([kind, v]) => (
                    <tr key={kind}>
                      <td>{kind}</td>
                      <td className="num">{number(v.active)}</td>
                      <td className="num">{number(v.inactive)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p style={{ color: 'var(--text-subtle)' }}>{dateTime(o.generatedAt)}</p>
        </>
      )}
    </QueryBoundary>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric__value">{value}</div>
      <div className="metric__label">{label}</div>
    </div>
  )
}

function CountCard({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts)
  return (
    <div className="card">
      <strong>{title}</strong>
      {entries.length === 0 ? (
        <div style={{ color: 'var(--text-muted)' }}>0</div>
      ) : (
        <table className="table">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="num">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ users */

function UsersView() {
  const tx = useText()
  const { dateTime } = useI18n()
  const query = useQuery({ queryKey: qk.adminUsers, queryFn: adminApi.users })
  const users = query.data?.users ?? []

  return (
    <QueryBoundary
      isLoading={query.isLoading}
      error={query.error}
      isEmpty={users.length === 0}
      emptyTitle={tx(TEXT.empty)}
      onRetry={() => void query.refetch()}
    >
      <Truncated truncated={Boolean(query.data?.truncated)} />
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Role</th>
            <th>Active</th>
            <th>Login</th>
            <th>Last sign-in</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={`${u.principalKind}:${u.id}`}>
              <td>{u.displayName}</td>
              <td>{u.principalKind}</td>
              <td>{u.staffRole ?? '—'}</td>
              <td>{u.isActive ? 'yes' : 'no'}</td>
              <td>{u.hasLogin ? u.accountStatus : 'none'}</td>
              <td>{u.lastLoginAt ? dateTime(u.lastLoginAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </QueryBoundary>
  )
}

/* ---------------------------------------------------------- conversations */

function ConversationsView() {
  const tx = useText()
  const { dateTime } = useI18n()
  const [selected, setSelected] = useState<string | null>(null)
  const query = useQuery({ queryKey: qk.adminConversations, queryFn: adminApi.conversations })
  const conversations = query.data?.conversations ?? []

  return (
    <QueryBoundary
      isLoading={query.isLoading}
      error={query.error}
      isEmpty={conversations.length === 0}
      emptyTitle={tx(TEXT.empty)}
      onRetry={() => void query.refetch()}
    >
      <Truncated truncated={Boolean(query.data?.truncated)} />
      {/* auto-fit: side by side when there is room, stacked when there is not;
          the list scrolls inside its own cell instead of overlapping the thread. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <div style={{ overflowX: 'auto', minWidth: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Conversation</th>
              <th>Type</th>
              <th>State</th>
              <th className="num">Members</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {conversations.map((c) => (
              <tr
                key={c.id}
                onClick={() => setSelected(c.id)}
                aria-selected={selected === c.id}
                style={{ cursor: 'pointer' }}
              >
                <td>{c.title ?? c.familyName ?? c.id.slice(0, 8)}</td>
                <td>{c.type}</td>
                <td>{c.state}</td>
                <td className="num">{c.liveMembers}</td>
                <td>{dateTime(c.lastActivityAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="card">
          {selected ? <MessagesView conversationId={selected} /> : tx(TEXT.selectConversation)}
        </div>
      </div>
    </QueryBoundary>
  )
}

function MessagesView({ conversationId }: { conversationId: string }) {
  const tx = useText()
  const { dateTime } = useI18n()
  const query = useQuery({
    queryKey: qk.adminMessages(conversationId),
    queryFn: () => adminApi.messages(conversationId),
  })
  const messages = query.data ?? []

  return (
    <QueryBoundary
      isLoading={query.isLoading}
      error={query.error}
      isEmpty={messages.length === 0}
      emptyTitle={tx(TEXT.empty)}
      onRetry={() => void query.refetch()}
    >
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {messages.map((m) => (
          <li key={m.id} style={{ marginBlockEnd: 12 }}>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              {m.authorName ?? tx(TEXT.unknownAuthor)} · {m.authorKind} · {dateTime(m.createdAt)}
              {m.visibility === 'internal' && (
                <>
                  {' '}
                  <Badge tone="internal">{tx(TEXT.internal)}</Badge>
                </>
              )}
            </div>
            <div>{m.deleted ? <em>{tx(TEXT.deleted)}</em> : m.body}</div>
          </li>
        ))}
      </ol>
    </QueryBoundary>
  )
}

/* ---------------------------------------------------------------- stories */

function StoriesView() {
  const tx = useText()
  const { dateTime } = useI18n()
  const query = useQuery({ queryKey: qk.adminStories, queryFn: adminApi.stories })
  const stories = query.data?.stories ?? []

  return (
    <QueryBoundary
      isLoading={query.isLoading}
      error={query.error}
      isEmpty={stories.length === 0}
      emptyTitle={tx(TEXT.empty)}
      onRetry={() => void query.refetch()}
    >
      <Truncated truncated={Boolean(query.data?.truncated)} />
      <table className="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>State</th>
            <th>Author</th>
            <th className="num">Recipients</th>
            <th className="num">Views</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {stories.map((s) => (
            <tr key={s.id}>
              <td>{s.title ?? '—'}</td>
              <td>{s.state}</td>
              <td>{s.creatorName}</td>
              <td className="num">{s.recipients}</td>
              <td className="num">{s.views}</td>
              <td>{dateTime(s.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </QueryBoundary>
  )
}
