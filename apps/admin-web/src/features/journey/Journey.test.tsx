import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { LessonCardDialog } from './LessonCardDialogs'
import { LessonRecordDialog } from './LessonRecordDialog'
import { GroupChildren } from './GroupChildren'
import type { GroupLearner, LessonRecord, LessonTicket } from './api'

/**
 * PD-15's Admin Web side, with `fetch` answered at the network boundary: the
 * supervisor's cards send exactly what the API takes, required reasons are
 * refused before anything is sent, a report is deleted / resent / corrected
 * only through the lesson record, and a group's children are shown one by one.
 * What the server allows is proven in student-journey-pd015.spec.ts.
 * Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response
let routes: Array<[string, RegExp, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([method, pattern, handler])
const sent = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls
    .filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
    .map(([, i]) => JSON.parse(String((i as RequestInit).body ?? '{}')) as Record<string, unknown>)

const staff = makeStaff({ role: 'admin' })

const ticket = (ticketKind: string, lessonId: string, name = 'Child Alpha', startsAt = '2026-10-21T15:00:00Z'): LessonTicket => ({
  ticket: ticketKind, lessonId, learner: { id: `k-${name}`, name }, startsAt, endsAt: startsAt,
})

const record = (over: Partial<LessonRecord> = {}): LessonRecord => ({
  id: 'l-9',
  learner: { id: 'k-1', name: 'Child Alpha' },
  teacher: { id: 't-1', name: 'Teacher One' },
  kind: 'regular',
  startsAt: '2026-10-20T15:00:00Z',
  endsAt: '2026-10-20T15:30:00Z',
  outcome: 'held',
  apologyTiming: null,
  outcomeNote: null,
  report: {
    lessonNumber: 7, coveredTopics: ['revision'], covered: 'Al-Mulk 1-10', rating: 4, nextTasks: ['revise_previous'],
    homework: null, note: 'tired', version: 1, submittedAt: '2026-10-20T16:00:00Z', updatedAt: '2026-10-20T16:00:00Z',
    deletedAt: null, messageId: 'm-1',
  },
  corrections: [],
  ...over,
})

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [m, pattern, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the supervisor\'s Student excuse card', () => {
  it('after the start: a category and the note are required and sent to late-excuse; before the start: the category only', async () => {
    on('POST', /\/lessons\/l-2\/late-excuse$/, () => json(record({ id: 'l-2', outcome: 'student_apology', apologyTiming: 'after_start' })))
    on('POST', /\/lessons\/l-1\/apology$/, () => json(record({ id: 'l-1', outcome: 'student_apology', apologyTiming: 'before_start' })))
    const tickets = [ticket('apology', 'l-1', 'Child Alpha', '2026-10-22T15:00:00Z'), ticket('late_excuse', 'l-2', 'Child Beta')]
    const { unmount } = renderWithProviders(<LessonCardDialog conversationId="c-1" kind="student_excuse" tickets={tickets} onClose={() => {}} />, { staff })
    const dialog = await screen.findByRole('dialog', { name: 'Student excuse' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Lesson'), 'l-2')
    expect(within(dialog).getByRole('radio', { name: /Excuse before the lesson starts/ })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('radio', { name: /Excuse after the lesson started/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    // PD-50: the category (which the family reads) and the note (which it does not) are both required.
    expect(within(dialog).getAllByText('Required')).toHaveLength(2)
    expect(sent('POST', /late-excuse$/)).toEqual([])
    expect(within(dialog).getByRole('radiogroup', { name: 'Reason (the family sees this)' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('radio', { name: 'An emergency' }))
    await userEvent.type(within(dialog).getByLabelText('Note (staff and the teacher only)'), 'family emergency')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sent('POST', /\/lessons\/l-2\/late-excuse$/)).toEqual([{ reason: 'family emergency', reasonCategory: 'emergency' }]))
    unmount()

    renderWithProviders(<LessonCardDialog conversationId="c-1" kind="student_excuse" tickets={tickets} onClose={() => {}} />, { staff })
    const again = await screen.findByRole('dialog', { name: 'Student excuse' })
    await userEvent.selectOptions(within(again).getByLabelText('Lesson'), 'l-1')
    await userEvent.click(within(again).getByRole('radio', { name: /Excuse before the lesson starts/ }))
    expect(within(again).queryByLabelText('Note (staff and the teacher only)')).not.toBeInTheDocument()
    // Before the start the note is optional (staff and the teacher read it, never the family).
    expect(within(again).getByLabelText('Note (staff and the teacher only, optional)')).toBeInTheDocument()
    await userEvent.click(within(again).getByRole('button', { name: 'Send' }))
    expect(sent('POST', /\/lessons\/l-1\/apology$/)).toEqual([])
    await userEvent.click(within(again).getByRole('radio', { name: 'Travel' }))
    await userEvent.click(within(again).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sent('POST', /\/lessons\/l-1\/apology$/)).toEqual([{ reasonCategory: 'travel' }]))
  })

  it('before the start: an optional note, when typed, is sent with the category', async () => {
    on('POST', /\/lessons\/l-1\/apology$/, () => json(record({ id: 'l-1', outcome: 'student_apology', apologyTiming: 'before_start' })))
    const tickets = [ticket('apology', 'l-1', 'Child Alpha', '2026-10-22T15:00:00Z')]
    renderWithProviders(<LessonCardDialog conversationId="c-1" kind="student_excuse" tickets={tickets} onClose={() => {}} />, { staff })
    const dialog = await screen.findByRole('dialog', { name: 'Student excuse' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Lesson'), 'l-1')
    await userEvent.click(within(dialog).getByRole('radio', { name: /Excuse before the lesson starts/ }))
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Exams' }))
    await userEvent.type(within(dialog).getByLabelText('Note (staff and the teacher only, optional)'), 'school exams')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sent('POST', /\/lessons\/l-1\/apology$/)).toEqual([{ reason: 'school exams', reasonCategory: 'exams' }]))
  })

  it('the teacher excuse names its category too', async () => {
    on('POST', /\/lessons\/l-5\/teacher-apology$/, () => json(record({ id: 'l-5', outcome: 'teacher_apology' })))
    renderWithProviders(<LessonCardDialog conversationId="c-1" kind="teacher_excuse" tickets={[ticket('teacher_apology', 'l-5')]} onClose={() => {}} />, { staff, locale: 'ar' })
    const dialog = await screen.findByRole('dialog', { name: 'عذر المعلم' })
    await userEvent.click(within(dialog).getByRole('radio', { name: 'مرض' }))
    await userEvent.type(within(dialog).getByLabelText('ملاحظة (للإدارة والمعلم فقط)'), 'موعد طبيب')
    await userEvent.click(within(dialog).getByRole('button', { name: 'إرسال' }))
    await waitFor(() => expect(sent('POST', /\/lessons\/l-5\/teacher-apology$/)).toEqual([{ reason: 'موعد طبيب', reasonCategory: 'illness' }]))
  })

  it('says so when no lesson can take the card', async () => {
    renderWithProviders(<LessonCardDialog conversationId="c-1" kind="teacher_excuse" tickets={[]} onClose={() => {}} />, { staff })
    expect(await screen.findByText(/No lesson in this group can take this card/)).toBeInTheDocument()
  })
})

describe('Reschedule a make-up class', () => {
  it('records the agreed date and time; free times are suggestions', async () => {
    on('GET', /\/lessons\/l-3\/makeup-slots$/, () => json({ lessonId: 'l-3', durationMinutes: 30, timezone: 'Africa/Cairo', slots: [] }))
    on('POST', /\/lessons\/l-3\/makeup$/, () => json(record({ id: 'l-30', kind: 'makeup', outcome: null })))
    renderWithProviders(<LessonCardDialog conversationId="c-1" kind="makeup" tickets={[ticket('book_makeup', 'l-3')]} onClose={() => {}} />, { staff })
    const dialog = await screen.findByRole('dialog', { name: 'Reschedule a make-up class' })
    await userEvent.type(within(dialog).getByLabelText('Date'), '2026-10-25')
    await userEvent.type(within(dialog).getByLabelText('Time (Cairo time)'), '17:30')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sent('POST', /\/lessons\/l-3\/makeup$/)).toHaveLength(1))
    // PD-22: 17:30 on the academy's clock (Cairo, still UTC+3 on 25 October), whatever the
    // browser's zone -- not the browser's 17:30.
    expect(sent('POST', /\/lessons\/l-3\/makeup$/)[0]!.startsAt).toBe('2026-10-25T14:30:00.000Z')
  })
})

describe('the lesson record', () => {
  it('PD-35: asks the teacher to correct the report, with a reason; never without one', async () => {
    on('GET', /\/lessons\/l-9$/, () => json(record()))
    on('POST', /\/lessons\/l-9\/correction-requests$/, () => json({ id: 'q-1' }))
    renderWithProviders(<LessonRecordDialog lessonId="l-9" conversationId="c-1" onClose={() => {}} />, { staff })
    await userEvent.click(within(await screen.findByRole('dialog', { name: /Lesson record — Child Alpha/ })).getByRole('button', { name: 'Request correction' }))
    const ask = await screen.findByRole('dialog', { name: /Request correction — Child Alpha/ })
    await userEvent.click(within(ask).getByRole('button', { name: 'Save' }))
    expect(sent('POST', /correction-requests$/)).toEqual([])
    await userEvent.type(within(ask).getByLabelText('What needs correcting'), 'Wrong surah range')
    await userEvent.click(within(ask).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/lessons\/l-9\/correction-requests$/)).toEqual([{ reason: 'Wrong surah range', kind: 'correction' }]))
  })

  it('PD-35: a started lesson with no report offers to ask for it', async () => {
    on('GET', /\/lessons\/l-9$/, () => json(record({ outcome: null, report: null })))
    renderWithProviders(<LessonRecordDialog lessonId="l-9" conversationId="c-1" onClose={() => {}} />, { staff })
    const view = await screen.findByRole('dialog', { name: /Lesson record — Child Alpha/ })
    expect(within(view).getByRole('button', { name: 'Ask for the report' })).toBeInTheDocument()
    expect(within(view).queryByRole('button', { name: 'Request correction' })).not.toBeInTheDocument()
  })

  it('deleting a report asks how: leaving it unsent sends resend: false with the reason', async () => {
    on('GET', /\/lessons\/l-9$/, () => json(record()))
    on('POST', /\/lessons\/l-9\/report\/delete$/, () => json(record({ outcome: 'voided' })))
    renderWithProviders(<LessonRecordDialog lessonId="l-9" conversationId="c-1" onClose={() => {}} />, { staff })
    const view = await screen.findByRole('dialog', { name: /Lesson record — Child Alpha/ })
    expect(within(view).getByText('Al-Mulk 1-10', { exact: false })).toBeInTheDocument()
    expect(within(view).getByText('tired')).toBeInTheDocument()
    await userEvent.click(within(view).getByRole('button', { name: 'Delete report' }))
    const del = await screen.findByRole('dialog', { name: /Delete report/ })
    await userEvent.click(within(del).getByRole('button', { name: 'Save' }))
    expect(sent('POST', /report\/delete$/)).toEqual([])
    await userEvent.click(within(del).getByRole('radio', { name: /Leave it unsent/ }))
    await userEvent.type(within(del).getByLabelText('Reason (staff only)'), 'duplicate lesson')
    await userEvent.click(within(del).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/lessons\/l-9\/report\/delete$/)).toEqual([{ reason: 'duplicate lesson', resend: false }]))
  })

  it('editing a report sends the whole report, chosen by taps', async () => {
    on('GET', /\/lessons\/l-9$/, () => json(record()))
    on('POST', /\/lessons\/l-9\/report\/edit$/, () => json(record()))
    renderWithProviders(<LessonRecordDialog lessonId="l-9" conversationId="c-1" onClose={() => {}} />, { staff })
    await userEvent.click(within(await screen.findByRole('dialog', { name: /Lesson record — Child Alpha/ })).getByRole('button', { name: 'Edit report' }))
    const edit = await screen.findByRole('dialog', { name: /Edit report/ })
    await userEvent.click(within(edit).getByRole('button', { name: 'Tajweed rules' }))
    await userEvent.click(within(edit).getByRole('radio', { name: 'Excellent' }))
    await userEvent.click(within(edit).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /report\/edit$/)).toHaveLength(1))
    expect(sent('POST', /report\/edit$/)[0]).toMatchObject({ lessonNumber: 7, coveredTopics: ['revision', 'tajweed'], rating: 5, note: 'tired' })
  })

  it('correcting to a student excuse needs its timing and a reason', async () => {
    on('GET', /\/lessons\/l-9$/, () => json(record({ outcome: 'student_no_show', report: null })))
    on('POST', /\/lessons\/l-9\/correction$/, () => json(record({ outcome: 'student_apology', apologyTiming: 'after_start' })))
    renderWithProviders(<LessonRecordDialog lessonId="l-9" conversationId="c-1" onClose={() => {}} />, { staff })
    const view = await screen.findByRole('dialog', { name: /Lesson record — Child Alpha/ })
    expect(within(view).queryByRole('button', { name: 'Delete report' })).not.toBeInTheDocument()
    await userEvent.click(within(view).getByRole('button', { name: 'Correct outcome' }))
    const form = await screen.findByRole('dialog', { name: /Correct outcome/ })
    await userEvent.selectOptions(within(form).getByLabelText('Correct to'), 'student_apology')
    await userEvent.type(within(form).getByLabelText('Reason (staff only)'), 'parent called the supervisor')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(sent('POST', /correction$/)).toEqual([])
    await userEvent.selectOptions(within(form).getByLabelText('When was the student excused?'), 'after_start')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(sent('POST', /\/lessons\/l-9\/correction$/)).toEqual([
        { outcome: 'student_apology', reason: 'parent called the supervisor', apologyTiming: 'after_start' },
      ]),
    )
  })

  it('a lesson the viewer may not open reads as unavailable', async () => {
    on('GET', /\/lessons\/l-9$/, () => json({ error: { code: 'COMM.LESSON_NOT_FOUND', message: 'lesson not found' } }, 404))
    renderWithProviders(<LessonRecordDialog lessonId="l-9" conversationId="c-1" onClose={() => {}} />, { staff })
    expect(await screen.findByText('You cannot open this lesson\'s record.')).toBeInTheDocument()
  })
})

describe('a group\'s children', () => {
  it('shows each child apart -- age, course, times, package -- and offers editing only where the server allows', async () => {
    const kids: GroupLearner[] = [
      { id: 'k-1', name: 'Child Alpha', age: 9, birthDate: '2016-03-01', course: { id: 'co-1', name: 'Quran memorization' }, packageLessons: 12,
        teacher: { id: 't-1', name: 'Teacher One' }, schedule: [{ weekday: 1, start: '17:00', durationMinutes: 30, timezone: 'Africa/Cairo' }], canEdit: true },
      { id: 'k-2', name: 'Child Beta', age: null, course: null, packageLessons: 8, teacher: { id: 't-1', name: 'Teacher One' }, schedule: [], canEdit: false },
    ]
    on('GET', /\/conversations\/c-1\/learners$/, () => json({ learners: kids }))
    on('GET', /\/courses$/, () => json({ canManage: false, courses: [{ id: 'co-1', name: 'Quran memorization', isActive: true }] }))
    on('POST', /\/learners\/k-1\/enrollment$/, () => json({}))
    renderWithProviders(<GroupChildren conversationId="c-1" />, { staff })
    const items = await screen.findAllByRole('listitem')
    const alpha = items.find((li) => li.textContent?.includes('Child Alpha'))!
    const beta = items.find((li) => li.textContent?.includes('Child Beta'))!
    expect(alpha).toHaveTextContent('9 years')
    expect(alpha).toHaveTextContent('Quran memorization')
    expect(alpha).toHaveTextContent('Monday · 17:00 · 30 min')
    expect(alpha).toHaveTextContent('12 lessons')
    expect(beta).toHaveTextContent('8 lessons')
    expect(beta).toHaveTextContent('No regular times yet')
    expect(within(beta).queryByRole('button', { name: /Edit details/ })).not.toBeInTheDocument()

    await userEvent.click(within(alpha).getByRole('button', { name: /Edit details/ }))
    const dialog = await screen.findByRole('dialog')
    const pkg = within(dialog).getByLabelText('Package')
    await userEvent.clear(pkg)
    await userEvent.type(pkg, '16')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(sent('POST', /\/learners\/k-1\/enrollment$/)).toEqual([{ birthDate: '2016-03-01', courseId: 'co-1', packageLessons: 16 }]),
    )
  })
})
