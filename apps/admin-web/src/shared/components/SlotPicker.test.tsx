import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { SlotPicker, WeeklySlotPicker, dayPartOf, type WeeklyOption } from './SlotPicker'

/**
 * PD-31's shared picker: free times as day chips, then the chosen day's times
 * grouped Morning / Afternoon / Evening on the Cairo clock, one click to pick,
 * radio semantics and keys. Cairo is UTC+2 in November 2026.
 */

// Mon 2 Nov: 09:00, 13:30, 17:00, 18:30 Cairo; Tue 3 Nov: 17:00 Cairo.
const SLOTS = ['2026-11-02T16:30:00Z', '2026-11-02T07:00:00Z', '2026-11-02T11:30:00Z', '2026-11-02T15:00:00Z', '2026-11-03T15:00:00Z']

function Harness({ slots = SLOTS, onPick = () => undefined }: { slots?: string[]; onPick?: (iso: string) => void }) {
  const [value, setValue] = useState<string | null>(null)
  return (
    <SlotPicker
      slots={slots}
      value={value}
      onChange={(iso) => {
        setValue(iso)
        onPick(iso)
      }}
      label="Free time"
    />
  )
}

describe('SlotPicker', () => {
  it('puts the days first, then the day\'s times under Morning / Afternoon / Evening (Cairo clock)', () => {
    renderWithProviders(<Harness />)
    const days = within(screen.getByRole('radiogroup', { name: 'Day' })).getAllByRole('radio')
    expect(days.map((d) => d.textContent)).toEqual(['Mon 2 · 4 times', 'Tue 3 · 1 time'])
    expect(days[0]).toHaveAttribute('aria-checked', 'true')
    const part = (name: string) => within(screen.getByRole('radiogroup', { name })).getAllByRole('radio').map((r) => r.textContent)
    expect(part('Morning')).toEqual(['09:00'])
    expect(part('Afternoon')).toEqual(['13:30'])
    expect(part('Evening')).toEqual(['17:00', '18:30'])
    expect(screen.getByText('Times shown in Cairo time')).toBeInTheDocument()
  })

  it('one click picks a time and shows it chosen; another day shows its own times', async () => {
    const onPick = vi.fn()
    renderWithProviders(<Harness onPick={onPick} />)
    await userEvent.click(screen.getByRole('radio', { name: '18:30' }))
    expect(onPick).toHaveBeenCalledWith('2026-11-02T16:30:00Z')
    expect(screen.getByRole('radio', { name: '18:30' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '17:00' })).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(screen.getByRole('radio', { name: 'Tue 3 · 1 time' }))
    expect(screen.queryByRole('radiogroup', { name: 'Morning' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('radiogroup', { name: 'Evening' })).getAllByRole('radio')).toHaveLength(1)
  })

  it('moves like a radio group: one tab stop, arrows select, Home / End jump; days follow the arrows too', async () => {
    const onPick = vi.fn()
    renderWithProviders(<Harness onPick={onPick} />)
    const first = screen.getByRole('radio', { name: '09:00' })
    expect(first).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: '13:30' })).toHaveAttribute('tabindex', '-1')
    first.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onPick).toHaveBeenLastCalledWith('2026-11-02T11:30:00Z')
    expect(screen.getByRole('radio', { name: '13:30' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(onPick).toHaveBeenLastCalledWith('2026-11-02T16:30:00Z')
    expect(screen.getByRole('radio', { name: '18:30' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}') // wraps
    expect(onPick).toHaveBeenLastCalledWith('2026-11-02T07:00:00Z')

    screen.getByRole('radio', { name: 'Mon 2 · 4 times' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Tue 3 · 1 time' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Tue 3 · 1 time' })).toHaveFocus()
  })

  it('in Arabic, Left is the next chip', async () => {
    const onPick = vi.fn()
    renderWithProviders(<Harness onPick={onPick} />, { locale: 'ar' })
    const morning = within(screen.getByRole('radiogroup', { name: 'الصباح' })).getByRole('radio')
    morning.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onPick).toHaveBeenLastCalledWith('2026-11-02T11:30:00Z')
  })

  it('says when nothing is free, and shows the payment lock instead of chips', () => {
    const { unmount } = renderWithProviders(<Harness slots={[]} />)
    expect(screen.getByText('No free times in the coming weeks.')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    unmount()
    renderWithProviders(<SlotPicker slots={SLOTS} value={null} onChange={() => undefined} label="Free time" locked="balance" />, { locale: 'ar' })
    expect(screen.getByRole('status')).toHaveTextContent('الحصص متوقفة — الدفع')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('splits the day at 12:00 and 17:00', () => {
    expect(['11:59', '12:00', '16:59', '17:00'].map(dayPartOf)).toEqual(['morning', 'afternoon', 'afternoon', 'evening'])
  })
})

describe('WeeklySlotPicker', () => {
  const OPTIONS: WeeklyOption[] = [
    { weekday: 2, start: '18:00', nextStartsAt: '2026-11-03T16:00:00Z', except: ['2026-11-10T16:00:00Z'] },
    { weekday: 1, start: '17:00', nextStartsAt: '2026-11-02T15:00:00Z', except: [] },
    { weekday: 2, start: '09:00', nextStartsAt: '2026-11-03T07:00:00Z', except: [] },
  ]

  it('weekday chips with counts, times grouped, and the weeks a time is not free', async () => {
    const onChange = vi.fn()
    renderWithProviders(<WeeklySlotPicker options={OPTIONS} value={{ weekday: 1, start: '17:00' }} onChange={onChange} label="New time" />)
    const days = within(screen.getByRole('radiogroup', { name: 'Day' })).getAllByRole('radio')
    expect(days.map((d) => d.textContent)).toEqual(['Mon · 1 time', 'Tue · 2 times'])
    // The current value's day opens first, with its time chosen.
    expect(screen.getByRole('radio', { name: '17:00' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(days[1]!)
    expect(screen.getByRole('radio', { name: '18:00 · except 10 Nov' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: '09:00' }))
    expect(onChange).toHaveBeenCalledWith(OPTIONS[2])
  })
})
