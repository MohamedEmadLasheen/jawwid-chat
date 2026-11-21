import { useDeferredValue, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { studentPath } from '@/features/profiles/api'
import { describeError, isProfileRefusal, useCopy, type Pair } from '@/features/profiles/copy'
import { STUDENTS_PAGE_SIZE, type StudentQuery, type StudentStatus } from './api'
import { useStudentList } from './hooks'
import '@/features/profiles/profiles.css'

const S = {
  title: { en: 'Students', ar: 'الطلاب' },
  subtitle: {
    en: 'Every student you may open, with their family, teacher and weekly times. Open a student for the full profile.',
    ar: 'كل طالب يحق لك فتح ملفه، مع عائلته ومعلمه ومواعيده الأسبوعية. افتح الطالب لعرض ملفه كاملًا.',
  },
  search: { en: 'Search by student or family name', ar: 'ابحث باسم الطالب أو العائلة' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  allTeachers: { en: 'All teachers', ar: 'كل المعلمين' },
  noTeacherFilter: { en: 'No teacher yet', ar: 'بلا معلم بعد' },
  supervisor: { en: 'Supervisor', ar: 'المشرف' },
  allSupervisors: { en: 'All supervisors', ar: 'كل المشرفين' },
  status: { en: 'Status', ar: 'الحالة' },
  allStatuses: { en: 'All statuses', ar: 'كل الحالات' },
  active: { en: 'Active', ar: 'نشط' },
  paused: { en: 'Paused', ar: 'متوقف مؤقتًا' },
  stopped: { en: 'Stopped', ar: 'متوقف نهائيًا' },
  student: { en: 'Student', ar: 'الطالب' },
  family: { en: 'Family', ar: 'العائلة' },
  noTeacher: { en: 'No teacher', ar: 'بلا معلم' },
  weekly: { en: 'Weekly times', ar: 'المواعيد الأسبوعية' },
  until: { en: 'back {day}', ar: 'يعود {day}' },
  none: { en: 'No students match.', ar: 'لا يوجد طلاب مطابقون.' },
  total: { en: '{n} students', ar: '{n} طالب' },
  pageOf: { en: 'Page {page} of {pages}', ar: 'صفحة {page} من {pages}' },
  prev: { en: 'Previous', ar: 'السابق' },
  next: { en: 'Next', ar: 'التالي' },
  pager: { en: 'Pages', ar: 'الصفحات' },
} satisfies Record<string, Pair>

const TONE = { active: 'ok', paused: 'warn', stopped: 'danger' } as const

/**
 * PD-60: People -> Students. A paginated, searchable list of the students the
 * server lets this viewer open (the same rule as the Student Profile); each row
 * links to that profile. Filters and paging are the server's: this page asks,
 * the API decides and bounds.
 */
export function StudentDirectoryPage() {
  const tx = useCopy()
  const { locale, t } = useI18n()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const deferred = useDeferredValue(q.trim())
  const teacher = params.get('teacher') ?? ''
  const supervisor = params.get('supervisor') ?? ''
  const asked = params.get('status')
  const status: StudentStatus | '' = asked === 'active' || asked === 'paused' || asked === 'stopped' ? asked : ''
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)

  const set = (patch: Record<string, string>, keepPage = false) =>
    setParams((current) => {
      const p = new URLSearchParams(current)
      for (const [k, v] of Object.entries(patch)) {
        if (v) p.set(k, v)
        else p.delete(k)
      }
      if (!keepPage) p.delete('page')
      return p
    }, { replace: true })

  // A changed search starts on the first page; the first render leaves the URL alone.
  const [searched, setSearched] = useState(deferred)
  useEffect(() => {
    if (deferred === searched) return
    setSearched(deferred)
    set({ q: deferred })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferred])

  const query: StudentQuery = { q: deferred, teacher, supervisor, status, page }
  const list = useStudentList(query)
  const data = list.data
  const pages = data ? Math.max(1, Math.ceil(data.total / (data.limit || STUDENTS_PAGE_SIZE))) : 1

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader title={tx(S.title)} subtitle={tx(S.subtitle)} />
        <div className="toolbar">
          <SearchField value={q} onChange={setQ} label={tx(S.search)} clearLabel={t('common.cancel')} />
          <label>
            <span className="field__label">{tx(S.teacher)}</span>
            <SearchableSelect className="select" value={teacher} onValueChange={(v) => set({ teacher: v })} aria-label={tx(S.teacher)}>
              <option value="">{tx(S.allTeachers)}</option>
              <option value="none">{tx(S.noTeacherFilter)}</option>
              {(data?.filters.teachers ?? []).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </SearchableSelect>
          </label>
          <label>
            <span className="field__label">{tx(S.supervisor)}</span>
            <SearchableSelect className="select" value={supervisor} onValueChange={(v) => set({ supervisor: v })} aria-label={tx(S.supervisor)}>
              <option value="">{tx(S.allSupervisors)}</option>
              {(data?.filters.supervisors ?? []).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </SearchableSelect>
          </label>
          <label>
            <span className="field__label">{tx(S.status)}</span>
            <SearchableSelect className="select" value={status} onValueChange={(v) => set({ status: v })} aria-label={tx(S.status)}>
              <option value="">{tx(S.allStatuses)}</option>
              <option value="active">{tx(S.active)}</option>
              <option value="paused">{tx(S.paused)}</option>
              <option value="stopped">{tx(S.stopped)}</option>
            </SearchableSelect>
          </label>
        </div>
        {isProfileRefusal(list.error) ? (
          <EmptyState icon="lock" title={describeError(list.error, locale)} />
        ) : (
          <QueryBoundary
            isLoading={list.isLoading}
            error={list.error}
            isEmpty={(data?.students.length ?? 0) === 0}
            emptyTitle={tx(S.none)}
            onRetry={() => void list.refetch()}
          >
            <p className="field__hint">{tx(S.total, { n: String(data?.total ?? 0) })}</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tx(S.student)}</th>
                    <th scope="col">{tx(S.family)}</th>
                    <th scope="col">{tx(S.teacher)}</th>
                    <th scope="col">{tx(S.supervisor)}</th>
                    <th scope="col">{tx(S.status)}</th>
                    <th scope="col">{tx(S.weekly)}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.students ?? []).map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link to={studentPath(s.id)} className="pf-person">
                          <Avatar name={s.name} seed={s.id} size="sm" />
                          <span dir="auto">{s.name}</span>
                        </Link>
                      </td>
                      <td dir="auto">{s.family.displayName}</td>
                      <td dir="auto">{s.teacher ? s.teacher.name : <span className="muted">{tx(S.noTeacher)}</span>}</td>
                      <td dir="auto">{s.supervisor ? s.supervisor.name : '—'}</td>
                      <td>
                        <Badge tone={TONE[s.status]} dot>{tx(S[s.status])}</Badge>
                        {s.status === 'paused' && s.returnOn && <> <span className="muted">{tx(S.until, { day: s.returnOn })}</span></>}
                      </td>
                      <td>{s.weeklySlots}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="toolbar" aria-label={tx(S.pager)}>
              <button type="button" className="btn btn--sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, true)}>
                {tx(S.prev)}
              </button>
              <span>{tx(S.pageOf, { page: String(page), pages: String(pages) })}</span>
              <button type="button" className="btn btn--sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) }, true)}>
                {tx(S.next)}
              </button>
            </nav>
          </QueryBoundary>
        )}
      </div>
    </div>
  )
}
