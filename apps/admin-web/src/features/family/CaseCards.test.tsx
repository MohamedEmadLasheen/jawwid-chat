import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CaseCards } from './CaseCards'
import { makeCapabilities, makeCase, renderWithProviders } from '@/test/utils'

describe('CaseCards', () => {
  it('offers no way to close an owner-locked case to someone who may not close it', () => {
    renderWithProviders(
      <CaseCards
        cases={[makeCase({ type: 'renewal', owner_locked: true })]}
        activeCaseId={null}
        capabilities={makeCapabilities({ can_close_owner_locked: false })}
        onSelect={vi.fn()}
        onResolve={vi.fn()}
      />,
    )
    // Brief §5: coverage never closes a relationship case. Say why, don't just
    // hide the button and leave the operator wondering.
    expect(screen.queryByRole('button', { name: 'Resolved' })).not.toBeInTheDocument()
    expect(
      screen.getByText('Owner-locked — deferred to the owner’s next shift'),
    ).toBeInTheDocument()
  })

  it('lets the owner resolve the same case', async () => {
    const onResolve = vi.fn()
    renderWithProviders(
      <CaseCards
        cases={[makeCase({ id: 'case_9', type: 'renewal', owner_locked: true })]}
        activeCaseId={null}
        capabilities={makeCapabilities({ can_close_owner_locked: true })}
        onSelect={vi.fn()}
        onResolve={onResolve}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Resolved' }))
    expect(onResolve).toHaveBeenCalledWith('case_9')
  })

  it('hides cases that are already finished', () => {
    const { container } = renderWithProviders(
      <CaseCards
        cases={[makeCase({ status: 'closed' }), makeCase({ id: 'c2', status: 'resolved' })]}
        activeCaseId={null}
        capabilities={makeCapabilities()}
        onSelect={vi.fn()}
        onResolve={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('flags a blocking case and a high-severity complaint', () => {
    renderWithProviders(
      <CaseCards
        cases={[makeCase({ type: 'complaint', severity: 'high', is_blocking: true })]}
        activeCaseId={null}
        capabilities={makeCapabilities()}
        onSelect={vi.fn()}
        onResolve={vi.fn()}
      />,
    )
    expect(screen.getByText('Blocking')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
  })

  it('toggles the case filter over the single thread', async () => {
    const onSelect = vi.fn()
    renderWithProviders(
      <CaseCards
        cases={[makeCase({ id: 'case_3', type: 'billing' })]}
        activeCaseId={null}
        capabilities={makeCapabilities()}
        onSelect={onSelect}
        onResolve={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'billing' }))
    expect(onSelect).toHaveBeenCalledWith('case_3')
  })
})
