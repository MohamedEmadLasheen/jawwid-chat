import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Thread } from './Thread'
import { makeMessage, renderWithProviders } from '@/test/utils'

describe('Thread', () => {
  it('marks an internal note so it can never be mistaken for a reply to the family', () => {
    renderWithProviders(
      <Thread
        messages={[makeMessage({ visibility: 'internal', body: 'Do not promise a discount' })]}
        isLoading={false}
        hasMore={false}
        onLoadMore={vi.fn()}
      />,
    )
    // Label, not just colour — the note must be unambiguous in greyscale too.
    expect(screen.getByText('Internal note')).toBeInTheDocument()
    const bubble = screen.getByText('Do not promise a discount')
    expect(bubble.closest('.msg')).toHaveClass('msg--internal')
  })

  it('does not label an ordinary customer-visible message as internal', () => {
    renderWithProviders(
      <Thread
        messages={[makeMessage({ visibility: 'customer', body: 'Hello' })]}
        isLoading={false}
        hasMore={false}
        onLoadMore={vi.fn()}
      />,
    )
    expect(screen.queryByText('Internal note')).not.toBeInTheDocument()
  })

  it('labels a coverage reply so the history says under what authority it was sent', () => {
    renderWithProviders(
      <Thread
        messages={[
          makeMessage({ author_type: 'staff', on_behalf_mode: 'coverage', body: 'Covering reply' }),
        ]}
        isLoading={false}
        hasMore={false}
        onLoadMore={vi.fn()}
      />,
    )
    expect(screen.getByText('You are covering this family')).toBeInTheDocument()
  })

  it('does not badge an owner’s own reply', () => {
    renderWithProviders(
      <Thread
        messages={[makeMessage({ author_type: 'staff', on_behalf_mode: 'owner' })]}
        isLoading={false}
        hasMore={false}
        onLoadMore={vi.fn()}
      />,
    )
    expect(screen.queryByText('You own this family')).not.toBeInTheDocument()
  })

  it('renders a system event distinctly from a person’s message', () => {
    renderWithProviders(
      <Thread
        messages={[makeMessage({ author_type: 'system', body: 'Payment failed' })]}
        isLoading={false}
        hasMore={false}
        onLoadMore={vi.fn()}
      />,
    )
    expect(screen.getByText('Payment failed').closest('.msg')).toHaveClass('msg--system')
  })
})
