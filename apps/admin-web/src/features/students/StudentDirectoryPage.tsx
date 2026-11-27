import { useDeferredValue, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { SearchField } from '@/shared/components/SearchField'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { countWords, type CountForms } from '@/features/instalments/copy'
import { studentPath } from '@/features/profiles/api'
import { describeError, isProfileRefusal, useCopy, type Pair } from '@/features/profiles/copy'
import { STUDENTS_PAGE_SIZE, type StudentQuery, type StudentRow, type StudentStatus } from './api'
import { useStudentList } from './hooks'
import { useRememberWalk } from '@/features/profiles/RecordHead'
import '@/features/profiles/profiles.css'

const S = {
  title: { en: 'Students', ar: 'الطلاب' },
  subtitle: {
    en: 'Every student you may open, with family, teacher and weekly times.',
    ar: 'كل طالب يحق لك فتح ملفه، مع عائلته ومعلمه ومواعيده الأسبوعية.',
  },
  search: { en: 'Search by student or family name', ar: 'ابحث باسم الطالب أو العائلة' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  allTeachers: { en: 'All teachers', ar: 'كل المعلمين' },
  noTeacherFilter: { en: 'No teacher yet', ar: 'بلا معلم بعد' },
  supervisor: { en: 'Supervisor', ar: 'المشرف' },
  allSupervisors: { en: 'All supervisors', ar: 'كل المشرفين' },
  noSupervisor: { en: 'No supervisor', ar: 'بلا مشرف' },
  status: { en: 'Status', ar: 'الحالة' },
  active: { en: 'Active', ar: 'نشط' },
  paused: { en: 'Paused', ar: 'متوقف مؤقتًا' },
  stopped: { en: 'Stopped', ar: 'متوقف نهائيًا' },
  student: { en: 'Student', ar: 'الطالب' },
  family: { en: 'Family', ar: 'العائلة' },
  noTeacher: { en: 'No teacher', ar: 'بلا معلم' },
  weekly: { en: 'Weekly times', ar: 'المواعيد الأسبوعية' },
  noWeekly: { en: 'None yet', ar: 'لا مواعيد بعد' },
  until: { en: 'back {day}', ar: 'يعود {day}' },
  none: { en: 'No students match.', ar: 'لا يوجد طلاب مطابقون.' },
  noneHint: { en: 'Clear the search or a filter to widen the list.', ar: 'امسح البحث أو أحد عوامل التصفية لتوسيع القائمة.' },
  all: { en: 'All', ar: 'الكل' },
  onThisPage: { en: '{n} on this page', ar: '{n} في هذه الصفحة' },
  open: { en: 'Open', ar: 'فتح' },
  more: { en: 'More actions: {name}', ar: 'إجراءات أخرى: {name}' },
  pageOf: { en: 'Page {page} of {pages}', ar: 'صفحة {page} من {pages}' },
  prev: { en: 'Previous', ar: 'السابق' },
  next: { en: 'Next', ar: 'التالي' },
  pager: { en: 'Pages', ar: 'الصفحات' },
} satisfies Record<string, Pair>

const STUDENTS_COUNT: CountForms = { en: ['{n} student', '{n} students'], ar: ['طالب واحد', 'طالبان', '{n} طلاب', '{n} طالبًا'] }
const WEEKLY_COUNT: CountForms = {
  en: ['{n} weekly time', '{n} weekly times'],
  ar: ['موعد أسبوعي واحد', 'موعدان أسبوعيان', '{n} مواعيد أسبوعية', '{n} موعدًا أسبوعيًا'],
}

// A pause is waiting on a return day (gold); a stop is said quietly: nothing here is a fault to chase.
// Active reads as it does in a record's head; paused waits on a date; stopped is a fact.
const TONE = { active: 'ok', paused: 'warn', stopped: 'outline' } as const
const STATUSES: ReadonlyArray<StudentStatus | ''> = ['', 'active', 'paused', 'stopped']

interface Group {
  key: string
  teacher: StudentRow['teacher']
  rows: StudentRow[]
}

/** The loaded page under its teachers: those with no teacher first, then each teacher by name. */
function byTeacher(rows: StudentRow[], locale: string): Group[] {
  const groups = new Map<string, Group>()
  for (const row of rows) {
    const key = row.teacher?.id ?? ''
    const group = groups.get(key) ?? { key, teacher: row.teacher, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.teacher || !b.teacher) return a.teacher ? 1 : b.teacher ? -1 : 0
    return a.teacher.name.localeCompare(b.teacher.name, locale)
  })
}

/**
 * PD-60: People -> Students. A paginated, searchable list of the students the
 * server lets this viewer open (the same rule as the Student Profile); each row
 * links to that profile. Filters and paging are the server's: this page asks,
 * the API decides and bounds.
 *
 * A directory: the masthead counts the list, one sheet holds it with the
 * search and filters that narrow it, and the loaded page is set out under each
 * teacher, those still without a teacher first.
 */
export function StudentDirectoryPage() {
  const tx = useCopy()
  const { locale, t, number } = useI18n()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
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
  const groups = byTeacher(data?.students ?? [], locale)
  // A student's file walks this page of the list in the order it is shown: teacher by teacher.
  useRememberWalk('students', data ? groups.flatMap((g) => g.rows) : undefined)


  return (
    <div className="page dir">
      <div className="page__inner">
        <PageHeader title={tx(S.title)} />
        <section className="sheet dir-sheet">
          <div className="sheet-bar">
            <SearchField value={q} onChange={setQ} label={tx(S.search)} clearLabel={t('common.cancel')} />
            <div className="chips" role="group" aria-label={tx(S.status)}>
              {STATUSES.map((s) => (
                <button key={s || 'all'} type="button" className="chip" aria-pressed={status === s} onClick={() => set({ status: s })}>
                  {tx(s ? S[s] : S.all)}
                </button>
              ))}
            </div>
            <div className="sheet-bar__end dir-pickers">
              <SearchableSelect className="select" value={teacher} onValueChange={(v) => set({ teacher: v })} aria-label={tx(S.teacher)}>
                <option value="">{tx(S.allTeachers)}</option>
                <option value="none">{tx(S.noTeacherFilter)}</option>
                {(data?.filters.teachers ?? []).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </SearchableSelect>
              <SearchableSelect className="select" value={supervisor} onValueChange={(v) => set({ supervisor: v })} aria-label={tx(S.supervisor)}>
                <option value="">{tx(S.allSupervisors)}</option>
                {(data?.filters.supervisors ?? []).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </SearchableSelect>
            </div>
          </div>
          {isProfileRefusal(list.error) ? (
            <EmptyState icon="lock" title={describeError(list.error, locale)} />
          ) : (
            <QueryBoundary
              isLoading={list.isLoading}
              error={list.error}
              isEmpty={(data?.students.length ?? 0) === 0}
              emptyTitle={tx(S.none)}
              emptyHint={tx(S.noneHint)}
              onRetry={() => void list.refetch()}
            >
              <table className="dir-table dir-table--grouped">
                <thead>
                  <tr>
                    <th scope="col">{tx(S.student)}</th>
                    <th scope="col">{tx(S.supervisor)}</th>
                    <th scope="col">{tx(S.weekly)}</th>
                    <th scope="col">{tx(S.status)}</th>
                    <th scope="col" className="cell-actions" aria-hidden="true" />
                  </tr>
                </thead>
                {groups.map((g) => (
                  <tbody key={g.key || 'none'} className={g.teacher ? 'dir-group' : 'dir-group dir-group--unplaced'}>
                    <tr className="dir-group__head">
                      <th colSpan={5} scope="rowgroup">
                        <span className="dir-group__title">
                          {g.teacher ? (
                            <>
                              <span className="dir-group__label">{tx(S.teacher)}</span>
                              <bdi>{g.teacher.name}</bdi>
                            </>
                          ) : (
                            <Badge tone="waiting">{tx(S.noTeacher)}</Badge>
                          )}
                          <span className="count count--quiet" title={tx(S.onThisPage, { n: number(g.rows.length) })}>
                            {number(g.rows.length)}
                          </span>
                        </span>
                      </th>
                    </tr>
                    {g.rows.map((s) => (
                      <tr
                        key={s.id}
                        className="dir-row"
                        onClick={(e) => {
                          // The whole row opens the file; the name is the link the keyboard uses.
                          if (!(e.target as HTMLElement).closest('a, button, input')) navigate(studentPath(s.id))
                        }}
                      >
                        <td className="dir-cell-who">
                          <span className="dir-who">
                            <Avatar name={s.name} seed={s.id} />
                            <span className="dir-who__text">
                              <Link to={studentPath(s.id)} className="dir-name">
                                <bdi>{s.name}</bdi>
                              </Link>
                              <span className="dir-sub">
                                <bdi>{s.family.displayName}</bdi>
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="dir-cell-quiet" data-label={tx(S.supervisor)}>
                          {s.supervisor ? <bdi>{s.supervisor.name}</bdi> : <span className="dir-none">{tx(S.noSupervisor)}</span>}
                        </td>
                        <td className={s.weeklySlots > 0 ? 'dir-cell-quiet' : 'dir-cell-quiet dir-cell-quiet--none'} data-label={tx(S.weekly)}>
                          {s.weeklySlots > 0 ? countWords(s.weeklySlots, WEEKLY_COUNT, locale) : <span className="dir-none">{tx(S.noWeekly)}</span>}
                        </td>
                        <td className="dir-cell-state">
                          <Badge tone={TONE[s.status]} dot={s.status === 'active'}>
                            {tx(S[s.status])}
                          </Badge>
                          {s.status === 'paused' && s.returnOn && <span className="dir-state__note">{tx(S.until, { day: s.returnOn })}</span>}
                        </td>
                        <td className="cell-actions">
                          <RowActions
                            label={tx(S.more, { name: s.name })}
                            primary={
                              // The name is the link; this is only a larger target for the pointer.
                              <Link to={studentPath(s.id)} className="btn btn--sm" tabIndex={-1} aria-hidden="true">
                                {tx(S.open)}
                              </Link>
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
              <nav className="dir-foot" aria-label={tx(S.pager)}>
                <span className="dir-total">{countWords(data?.total ?? 0, STUDENTS_COUNT, locale)}</span>
                <span className="dir-pager">
                  <button type="button" className="btn btn--sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, true)}>
                    {tx(S.prev)}
                  </button>
                  <span>{tx(S.pageOf, { page: String(page), pages: String(pages) })}</span>
                  <button type="button" className="btn btn--sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) }, true)}>
                    {tx(S.next)}
                  </button>
                </span>
              </nav>
            </QueryBoundary>
          )}
        </section>
      </div>
    </div>
  )
}
