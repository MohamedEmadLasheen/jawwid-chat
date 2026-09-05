import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InboxRowItem } from './InboxRowItem'
import { makeInboxRow, renderWithProviders } from '@/test/utils'

describe('InboxRowItem', () => {
  it('shows the server’s reason text so the situation is legible without opening it', () => {
    renderWithProviders(
      <InboxRowItem
        row={makeInboxRow({ top_reason: 'payment failed 2 hours ago' })}
        selected={false}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('payment failed 2 hours ago')).toBeInTheDocument()
  })

  it('never renders an attention score or a P1/P2/P3 label', () => {
    const { container } = renderWithProviders(
      <InboxRowItem row={makeInboxRow({ bucket: 'now' })} selected={false} onSelect={vi.fn()} />,
    )
    // Brief §6: buckets are shown as a reason, never as a number or a label.
    expect(container.textContent).not.toMatch(/\bP[123]\b/)
    expect(container.textContent).not.toMatch(/\bscore\b/i)
    expect(container.textContent).not.toMatch(/\b(6[0-9]|[0-9]{3})\b/)
  })

  it('conveys the bucket by more than colour', () => {
    renderWithProviders(
      <InboxRowItem row={makeInboxRow({ bucket: 'now' })} selected={false} onSelect={vi.fn()} />,
    )
    // The dot is decorative; the meaning reaches assistive tech as text.
    expect(screen.getByText('Now')).toBeInTheDocument()
  })

  it('says when the operator is covering rather than owning', () => {
    renderWithProviders(
      <InboxRowItem
        row={makeInboxRow({ handling_mode: 'coverage' })}
        selected={false}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('You are covering this family')).toBeInTheDocument()
  })

  it('stays quiet about handling mode when the operator simply owns the family', () => {
    renderWithProviders(
      <InboxRowItem
        row={makeInboxRow({ handling_mode: 'owner' })}
        selected={false}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.queryByText('You own this family')).not.toBeInTheDocument()
  })

  it('never renders a phone number', () => {
    const { container } = renderWithProviders(
      <InboxRowItem row={makeInboxRow()} selected={false} onSelect={vi.fn()} />,
    )
    expect(container.textContent).not.toMatch(/\+?\d{7,}/)
  })

  it('selects the family when clicked', async () => {
    const onSelect = vi.fn()
    renderWithProviders(
      <InboxRowItem row={makeInboxRow({ family_id: 'fam_42' })} selected={false} onSelect={onSelect} />,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('fam_42')
  })
})
