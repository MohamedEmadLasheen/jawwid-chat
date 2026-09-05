import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { ErrorState, EmptyState, QueryBoundary } from './States'
import { ApiError, NetworkError } from '@/core/api/errors'
import { renderWithProviders } from '@/test/utils'

describe('ErrorState', () => {
  it('offers no retry on a 403 — the backend said no and there is no way round it', () => {
    renderWithProviders(
      <ErrorState
        error={new ApiError({ status: 403, code: 'x', messageEn: 'nope', messageAr: 'لا' })}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText("You don't have permission to access this.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('offers a retry on a transient failure', () => {
    renderWithProviders(<ErrorState error={new NetworkError()} onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows the error in Arabic when the operator works in Arabic', () => {
    renderWithProviders(
      <ErrorState
        error={new ApiError({ status: 500, code: 'x', messageEn: 'Boom', messageAr: 'انفجار' })}
      />,
      { locale: 'ar' },
    )
    expect(screen.getByText('انفجار')).toBeInTheDocument()
  })

  it('announces itself to assistive tech', () => {
    renderWithProviders(<ErrorState error={new NetworkError()} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})

describe('QueryBoundary', () => {
  it('reassures rather than looking broken when there is genuinely nothing to do', () => {
    renderWithProviders(
      <QueryBoundary isLoading={false} error={null} isEmpty emptyTitle="Nothing needs you right now.">
        <div>rows</div>
      </QueryBoundary>,
    )
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument()
    expect(screen.queryByText('rows')).not.toBeInTheDocument()
  })

  it('prefers the error over the empty state', () => {
    renderWithProviders(
      <QueryBoundary isLoading={false} error={new NetworkError()} isEmpty emptyTitle="empty">
        <div>rows</div>
      </QueryBoundary>,
    )
    expect(screen.queryByText('empty')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('renders content once loaded', () => {
    renderWithProviders(
      <QueryBoundary isLoading={false} error={null}>
        <div>rows</div>
      </QueryBoundary>,
    )
    expect(screen.getByText('rows')).toBeInTheDocument()
  })
})

describe('EmptyState', () => {
  it('shows a hint alongside the title', () => {
    renderWithProviders(<EmptyState title="No tasks." hint="Nice." />)
    expect(screen.getByText('No tasks.')).toBeInTheDocument()
    expect(screen.getByText('Nice.')).toBeInTheDocument()
  })
})
