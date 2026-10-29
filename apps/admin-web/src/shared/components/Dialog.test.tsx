import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { Dialog } from './Dialog'

/**
 * Dialog keeps onClose in a ref so a parent's re-render (a new inline
 * function) does not re-run its focus effect. These pin that the LATEST
 * onClose is still the one that runs, and that focus stays where it is.
 */
describe('Dialog', () => {
  it('runs the latest onClose on Escape, and a re-render does not pull focus back to the dialog', async () => {
    const user = userEvent.setup()
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender } = renderWithProviders(
      <Dialog title="Edit" onClose={first}>
        <input aria-label="Name" />
      </Dialog>,
    )
    await user.click(screen.getByRole('textbox', { name: 'Name' }))
    rerender(
      <Dialog title="Edit" onClose={latest}>
        <input aria-label="Name" />
      </Dialog>,
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })

  it('runs the latest onClose on a sheet backdrop click', async () => {
    const user = userEvent.setup()
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender } = renderWithProviders(
      <Dialog title="Details" variant="sheet" onClose={first}>
        <p>Body</p>
      </Dialog>,
    )
    rerender(
      <Dialog title="Details" variant="sheet" onClose={latest}>
        <p>Body</p>
      </Dialog>,
    )
    await user.click(document.querySelector('.dialog-backdrop')!)
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })
})
