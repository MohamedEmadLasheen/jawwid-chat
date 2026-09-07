import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { CurrentSection, HistorySection, HistoryRow } from '@/shared/components/History'
import { familyIsActive, splitCurrent } from '@/shared/types/directory'

/**
 * The Phase 3 UI rule, asserted rather than assumed: a former relationship is
 * never rendered where the current one belongs.
 */
describe('current state and history are visually distinct', () => {
  it('puts the current teacher and the former teacher in different labelled sections', () => {
    render(
      <>
        <CurrentSection title="Teacher" empty="none">
          <li>Mahmoud</li>
        </CurrentSection>
        <HistorySection title="Previous teachers" empty="none">
          <HistoryRow who="Islam" started="2026-01-01T00:00:00.000Z" ended="2026-06-01T00:00:00.000Z" />
        </HistorySection>
      </>,
    )

    const current = screen.getByRole('heading', { name: /Teacher Current/i }).closest('section')!
    const history = screen
      .getByRole('heading', { name: /Previous teachers History/i })
      .closest('section')!

    // Mahmoud is current; Islam is not in the current section at all.
    expect(within(current).getByText('Mahmoud')).toBeInTheDocument()
    expect(within(current).queryByText('Islam')).toBeNull()

    // Islam appears only in history, and the row states when it ENDED.
    expect(within(history).getByText('Islam')).toBeInTheDocument()
    expect(within(history).getByText(/2026-06-01/)).toBeInTheDocument()
  })

  it('labels each section in words, not by colour alone', () => {
    render(
      <CurrentSection title="Supervisor" empty="none">
        <li>Dina</li>
      </CurrentSection>,
    )
    // "Current" is text inside the heading, so the distinction survives for a
    // reader who cannot see the badge tone.
    expect(screen.getByRole('heading', { name: /Supervisor Current/i })).toBeInTheDocument()
  })

  it('splitCurrent separates rows by isCurrent, never by position', () => {
    const rows = [
      { id: 'a', isCurrent: false },
      { id: 'b', isCurrent: true },
      { id: 'c', isCurrent: false },
    ]
    const { current, former } = splitCurrent(rows)
    expect(current.map((r) => r.id)).toEqual(['b'])
    expect(former.map((r) => r.id)).toEqual(['a', 'c'])
  })
})

describe('the family lifecycle mirror', () => {
  it('classifies the six states exactly as the database function does', () => {
    expect(familyIsActive('onboarding')).toBe(true)
    expect(familyIsActive('active')).toBe(true)
    // A family at risk is still a customer.
    expect(familyIsActive('at_risk')).toBe(true)
    expect(familyIsActive('renewal_due')).toBe(true)
    expect(familyIsActive('paused')).toBe(false)
    expect(familyIsActive('churned')).toBe(false)
  })
})
