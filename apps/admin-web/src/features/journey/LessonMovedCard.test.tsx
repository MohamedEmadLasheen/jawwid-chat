import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { LESSON_CARD_KINDS } from './api'
import { LessonMovedCard, readLessonMovedCard } from './LessonMovedCard'

/** PD-31: the `lesson_moved` card, "previous → new" on the academy's (Cairo) clock. Synthetic people only. */
const PAYLOAD = {
  lessonId: 'l-2',
  learnerName: 'Child Alpha',
  teacherName: 'Teacher One',
  startsAt: '2026-11-04T16:30:00Z',
  endsAt: '2026-11-04T17:00:00Z',
  durationMinutes: 30,
  previousStartsAt: '2026-11-02T15:00:00Z',
  movedBy: 'family',
}

describe('the lesson_moved card', () => {
  it('reads previous → new in Cairo, with the teacher, the length and who moved it', () => {
    const card = readLessonMovedCard(PAYLOAD)!
    renderWithProviders(<LessonMovedCard card={card} />)
    const group = screen.getByRole('group', { name: "📅 Child Alpha's lesson was moved" })
    expect(group).toHaveTextContent('Mon 2 Nov 17:00 → Wed 4 Nov 18:30')
    expect(group).toHaveTextContent('Teacher One · 30 min')
    expect(group).toHaveTextContent('Moved by the family')
  })

  it('in Arabic', () => {
    renderWithProviders(<LessonMovedCard card={readLessonMovedCard(PAYLOAD)!} />, { locale: 'ar' })
    expect(screen.getByRole('group', { name: '📅 تغيّر موعد حصة Child Alpha' })).toHaveTextContent('نقلتها الأسرة')
  })

  it('opens its lesson record like the other lesson cards; an unreadable payload falls back to the body', () => {
    expect(LESSON_CARD_KINDS.has('lesson_moved')).toBe(true)
    expect(readLessonMovedCard({ lessonId: 'l-2' })).toBeNull()
  })
})
