import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { opsApi } from '@/features/teachers/opsApi'
import type { LessonNow } from './api'
import { LessonNowNote, TIMED_CARD_KINDS, lessonNowText } from './LessonNowNote'

/**
 * CHATSCHED-002 (PD-46 PR-3b): an old lesson card is never rewritten, but a
 * card that announced a time says where its lesson stands now -- moved since,
 * held at another time, cancelled or missed -- and nothing while it is right.
 * Synthetic lessons only.
 */
const SHOWN = '2026-10-31T19:00:00Z' // Sat 31 Oct, 21:00 in Cairo
const LATER = '2026-10-31T20:00:00Z' // 22:00
const now = (startsAt: string, status: LessonNow['status']): LessonNow => ({
  lessonId: 'l-2', currentLessonId: 'l-3', startsAt, endsAt: startsAt, status,
})

describe('what an old time card says now', () => {
  it('moved since: the new time; held elsewhere: "Held"; still right: nothing', () => {
    expect(lessonNowText(now(LATER, 'upcoming'), SHOWN, 'en')).toBe('Now: Sat 31 Oct 22:00')
    expect(lessonNowText(now(LATER, 'held'), SHOWN, 'en')).toBe('Held: Sat 31 Oct 22:00')
    expect(lessonNowText(now(SHOWN, 'upcoming'), SHOWN, 'en')).toBeNull()
    expect(lessonNowText(undefined, SHOWN, 'en')).toBeNull()
  })

  it('cancelled or missed, in both languages, never why', () => {
    expect(lessonNowText(now(SHOWN, 'cancelled'), SHOWN, 'en')).toBe('This lesson was cancelled')
    expect(lessonNowText(now(SHOWN, 'cancelled'), SHOWN, 'ar')).toBe('أُلغيت هذه الحصة')
    expect(lessonNowText(now(SHOWN, 'missed'), SHOWN, 'ar')).toBe('لم تُعقد هذه الحصة')
  })

  it('only the cards that announce a time get it', () => {
    expect([...TIMED_CARD_KINDS].sort()).toEqual(['lesson_makeup_booked', 'lesson_moved', 'lesson_scheduled'])
  })
})

describe('over the network', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (/\/conversations\/c-1\/lesson-now$/.test(String(url))) {
        return new Response(JSON.stringify({ lessons: [now(LATER, 'upcoming')] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ id: 'l-9' }), { status: 201, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('the note under a card reads the conversation\'s lesson-now', async () => {
    renderWithProviders(<LessonNowNote conversationId="c-1" lessonId="l-2" shownStartsAt={SHOWN} />)
    expect(await screen.findByTestId('lesson-now')).toHaveTextContent('Now: Sat 31 Oct 22:00')
  })

  it('CHATSCHED-007: "Add lesson" sends its Idempotency-Key', async () => {
    await opsApi.schedule({ learnerId: 'k-1', startsAt: SHOWN, endsAt: LATER }, 'add-lesson:seed:t:30')
    const [, init] = fetchMock.mock.calls.find(([u]) => /\/lessons$/.test(String(u)))!
    expect((init as RequestInit).headers).toMatchObject({ 'Idempotency-Key': 'add-lesson:seed:t:30' })
  })
})
