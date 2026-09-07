import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FamilyActions } from './FamilyActions'
import {
  makeCapabilities,
  makeFamilyDetail,
  makeStaff,
  renderWithProviders,
} from '@/test/utils'

/**
 * Ownership is the invariant the whole product is built around: one family, one
 * permanent owner, changed only through transfer_ownership() with a reason.
 */
describe('FamilyActions — ownership', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('does not offer ownership transfer to an admin', () => {
    renderWithProviders(
      <FamilyActions
        detail={makeFamilyDetail({
          capabilities: makeCapabilities({ can_transfer_ownership: false }),
        })}
        activeCase={null}
      />,
      { staff: makeStaff({ role: 'admin' }) },
    )
    expect(screen.queryByRole('button', { name: 'Transfer ownership' })).not.toBeInTheDocument()
  })

  it('does not offer ownership transfer to a coverage admin either', () => {
    renderWithProviders(
      <FamilyActions
        detail={makeFamilyDetail({
          capabilities: makeCapabilities({ can_transfer_ownership: false }),
        })}
        activeCase={null}
      />,
      { staff: makeStaff({ role: 'coverage_admin' }) },
    )
    expect(screen.queryByRole('button', { name: 'Transfer ownership' })).not.toBeInTheDocument()
  })

  it('offers it to a manager the server has also cleared', () => {
    renderWithProviders(
      <FamilyActions
        detail={makeFamilyDetail({
          capabilities: makeCapabilities({ can_transfer_ownership: true }),
        })}
        activeCase={null}
      />,
      { staff: makeStaff({ role: 'manager' }) },
    )
    expect(screen.getByRole('button', { name: 'Transfer ownership' })).toBeInTheDocument()
  })

  it('withholds it from a manager when the server says no — the backend still decides', () => {
    renderWithProviders(
      <FamilyActions
        detail={makeFamilyDetail({
          capabilities: makeCapabilities({ can_transfer_ownership: false }),
        })}
        activeCase={null}
      />,
      { staff: makeStaff({ role: 'manager' }) },
    )
    expect(screen.queryByRole('button', { name: 'Transfer ownership' })).not.toBeInTheDocument()
  })

  it('will not submit a transfer without a reason', async () => {
    renderWithProviders(
      <FamilyActions
        detail={makeFamilyDetail({
          capabilities: makeCapabilities({ can_transfer_ownership: true }),
        })}
        activeCase={null}
      />,
      { staff: makeStaff({ role: 'manager' }) },
    )

    await userEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    // The confirm button is the one inside the dialog.
    const confirm = screen.getAllByRole('button', { name: 'Transfer ownership' }).at(-1)!
    expect(confirm).toBeDisabled()

    await userEvent.type(screen.getByRole('textbox'), 'rebalancing night load')
    expect(confirm).toBeEnabled()
  })

  it('closes the dialog on Escape without transferring', async () => {
    renderWithProviders(
      <FamilyActions
        detail={makeFamilyDetail({
          capabilities: makeCapabilities({ can_transfer_ownership: true }),
        })}
        activeCase={null}
      />,
      { staff: makeStaff({ role: 'manager' }) },
    )
    await userEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('FamilyActions — handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null', { status: 200 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('offers "I\'ll keep this" and "For owner" — handling, not ownership', () => {
    renderWithProviders(
      <FamilyActions detail={makeFamilyDetail()} activeCase={null} />,
      { staff: makeStaff({ role: 'coverage_admin' }) },
    )
    expect(screen.getByRole('button', { name: "I'll keep this" })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'For owner' })).toBeEnabled()
    // Neither of those is an ownership control.
    expect(screen.queryByRole('button', { name: 'Transfer ownership' })).not.toBeInTheDocument()
  })

  it('disables escalate and follow-up until a case is selected', () => {
    renderWithProviders(
      <FamilyActions detail={makeFamilyDetail()} activeCase={null} />,
      { staff: makeStaff() },
    )
    expect(screen.getByRole('button', { name: 'Escalate' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Follow-up' })).toBeDisabled()
  })
})
