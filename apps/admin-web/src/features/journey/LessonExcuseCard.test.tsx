import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { LessonExcuseCard, readLessonExcuseCard } from './LessonExcuseCard'

/**
 * Owner report 2026-10-29: "the reason for the excuse and the make-up lesson
 * date are not displayed in the group chat, especially in Admin Web". Before,
 * every one of these cards was its plain-text body: no make-up time at all, and
 * no reason for a staff-recorded excuse. Times on the academy's (Cairo) clock.
 * Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
let fetchMock: ReturnType<typeof vi.fn>
let outcomeNote: string | null
const lessonGets = () => fetchMock.mock.calls.filter(([u]) => /\/lessons\/l-1$/.test(String(u))).length

beforeEach(() => {
  outcomeNote = null
  fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    /\/lessons\/l-1$/.test(String(input))
      ? json({ id: 'l-1', outcome: 'student_apology', outcomeNote })
      : json({ error: { code: 'unrouted', message: 'no mock' } }, 404),
  )
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const staff = makeStaff({ role: 'admin' })
const base = {
  lessonId: 'l-1', learnerName: 'Child Alpha', teacherName: 'Teacher One',
  startsAt: '2026-11-02T15:00:00Z', endsAt: '2026-11-02T15:30:00Z', durationMinutes: 30,
}

describe('an excused lesson\'s card', () => {
  it('shows the family\'s reason and, once booked, the make-up\'s day, date and time', () => {
    const card = readLessonExcuseCard('lesson_apology', {
      ...base, timing: 'before_start', makeupOwed: true, reason: 'Travelling to Umrah', makeupStartsAt: '2026-11-04T16:30:00Z',
    })!
    renderWithProviders(<LessonExcuseCard card={card} />, { staff })
    const group = screen.getByRole('group', { name: '🙏 Child Alpha has an excuse and will not attend the lesson' })
    expect(group).toHaveTextContent('ReasonTravelling to Umrah')
    expect(group).toHaveTextContent('LessonMon 2 Nov 17:00 · Cairo time')
    expect(group).toHaveTextContent('Make-up lessonWed 4 Nov 18:30 · Cairo time')
    // Booked: the "can be arranged" line is gone; the family's reason needs no lookup.
    expect(group).not.toHaveTextContent('can be arranged')
    expect(lessonGets()).toBe(0)
  })

  it('before a make-up is booked, says one can be arranged', () => {
    renderWithProviders(<LessonExcuseCard card={readLessonExcuseCard('lesson_teacher_apology', { ...base, makeupOwed: true })!} />, { staff })
    expect(screen.getByRole('group')).toHaveTextContent('A make-up lesson will be arranged.')
  })

  it('a staff-recorded reason is read from the lesson record and labelled staff and the teacher only', async () => {
    outcomeNote = 'Hospital visit'
    renderWithProviders(<LessonExcuseCard card={readLessonExcuseCard('lesson_apology', { ...base, timing: 'after_start', makeupOwed: true })!} />, { staff })
    await waitFor(() => expect(screen.getByRole('group')).toHaveTextContent('Reason (staff and the teacher only)Hospital visit'))
    expect(lessonGets()).toBe(1)
  })

  it('PD-50: the category is shown; the free text beside it is a staff-and-teacher note', async () => {
    outcomeNote = 'Fever since yesterday'
    renderWithProviders(
      <LessonExcuseCard card={readLessonExcuseCard('lesson_apology', { ...base, timing: 'after_start', makeupOwed: true, reasonCategory: 'illness' })!} />,
      { staff },
    )
    const group = screen.getByRole('group')
    expect(group).toHaveTextContent('ReasonIllness')
    await waitFor(() => expect(group).toHaveTextContent('Note (staff and the teacher only)Fever since yesterday'))
  })

  it('an unknown category code is not drawn', () => {
    expect(readLessonExcuseCard('lesson_teacher_apology', { ...base, reasonCategory: 'secret' })?.category).toBeNull()
  })

  it('a record that cannot be read shows no reason, never an error', async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: 'lesson_not_found', message: 'x' } }, 404))
    renderWithProviders(<LessonExcuseCard card={readLessonExcuseCard('lesson_teacher_apology', { ...base, makeupOwed: true })!} />, { staff })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByRole('group')).not.toHaveTextContent('Reason')
  })

  it('in Arabic, with Arabic dates', () => {
    const card = readLessonExcuseCard('lesson_apology', {
      ...base, timing: 'before_start', makeupOwed: true, reason: 'سفر', makeupStartsAt: '2026-11-04T16:30:00Z',
    })!
    renderWithProviders(<LessonExcuseCard card={card} />, { staff, locale: 'ar' })
    const group = screen.getByRole('group', { name: '🙏 لدى Child Alpha عذر ولن يتمكن من حضور الحصة' })
    expect(group).toHaveTextContent('السببسفر')
    expect(group).toHaveTextContent('الحصة التعويضية')
    expect(group).toHaveTextContent('بتوقيت القاهرة')
    expect(group).toHaveTextContent('الأربعاء')
  })
})

describe('the make-up card', () => {
  it('shows the make-up\'s day, date and time and the lesson it replaces', () => {
    const card = readLessonExcuseCard('lesson_makeup_booked', {
      ...base, startsAt: '2026-11-04T16:30:00Z', makeupFor: 'l-0', missedStartsAt: '2026-11-02T15:00:00Z', missedOutcome: 'student_apology',
    })!
    renderWithProviders(<LessonExcuseCard card={card} />, { staff })
    const group = screen.getByRole('group', { name: '📅 A make-up lesson is scheduled for Child Alpha' })
    expect(group).toHaveTextContent('Make-up lessonWed 4 Nov 18:30 · Cairo time')
    expect(group).toHaveTextContent('Instead of the lesson onMon 2 Nov 17:00 · Cairo time')
    expect(group).toHaveTextContent('Teacher One · 30 min')
    expect(lessonGets()).toBe(0)
  })
})

describe('readLessonExcuseCard', () => {
  it('draws only the cards about an excuse or a make-up; anything else keeps its body', () => {
    expect(readLessonExcuseCard('lesson_cancelled', { ...base, outcome: 'admin_cancelled' })).toBeNull()
    expect(readLessonExcuseCard('lesson_ruling', { ...base, decision: 'teacher_credited' })).toBeNull()
    expect(readLessonExcuseCard('lesson_report', base)).toBeNull()
    expect(readLessonExcuseCard('lesson_apology', { lessonId: 'l-1' })).toBeNull()
    expect(readLessonExcuseCard('lesson_cancelled', { ...base, outcome: 'teacher_no_show' })?.kind).toBe('teacher_absent')
    expect(readLessonExcuseCard('lesson_ruling', { ...base, decision: 'excused' })?.makeupOwed).toBe(true)
  })
})
