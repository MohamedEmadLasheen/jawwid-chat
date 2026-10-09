import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { ProfilePage } from './ProfilePage'
import * as avatarModule from './api'

/**
 * The admin's own profile photo.
 *
 * A UI-contract test, not a security test: every DENY lives in the API and is proven in
 * `apps/api/test/integration/staff-teacher-avatars.spec.ts`, because a hidden button is not
 * a control. What matters here is that the panel does not LIE — it never shows a photo that
 * failed to upload, never silently swallows a failure, and never treats a cancelled picker
 * as an action.
 */
describe('the admin profile photo panel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the current photo when there is one', async () => {
    vi.spyOn(avatarModule.avatarApi, 'mine').mockResolvedValue({
      displayName: 'QA Admin',
      avatarUrl: 'https://storage.test/avatars/admin?sig=x',
    })

    renderWithProviders(<ProfilePage />)

    const img = await screen.findByRole('img', { name: /QA Admin's profile photo/i })
    expect(img).toHaveAttribute('src', 'https://storage.test/avatars/admin?sig=x')
    expect(screen.getByRole('button', { name: /change photo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove photo/i })).toBeInTheDocument()
  })

  it('falls back to initials, and offers to ADD rather than change', async () => {
    vi.spyOn(avatarModule.avatarApi, 'mine').mockResolvedValue({
      displayName: 'QA Admin',
      avatarUrl: null,
    })

    renderWithProviders(<ProfilePage />)

    expect(await screen.findByText('QA')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add photo/i })).toBeInTheDocument()
    // Nothing to remove, so the control is absent rather than disabled.
    expect(screen.queryByRole('button', { name: /remove photo/i })).not.toBeInTheDocument()
  })

  it('a failed upload says so and does NOT show a photo', async () => {
    vi.spyOn(avatarModule.avatarApi, 'mine').mockResolvedValue({
      displayName: 'QA Admin',
      avatarUrl: null,
    })
    vi.spyOn(avatarModule, 'uploadAvatar').mockRejectedValue(new Error('storage said no'))

    renderWithProviders(<ProfilePage />)
    await screen.findByText('QA')

    const file = new File(['bytes'], 'me.jpg', { type: 'image/jpeg' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, file)

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    // The panel still says there is no photo, because there is not.
    expect(screen.queryByRole('img', { name: /profile photo/i })).not.toBeInTheDocument()
  })

  it('an oversized image is refused locally, without an upload attempt', async () => {
    vi.spyOn(avatarModule.avatarApi, 'mine').mockResolvedValue({
      displayName: 'QA Admin',
      avatarUrl: null,
    })
    const upload = vi.spyOn(avatarModule, 'uploadAvatar')

    renderWithProviders(<ProfilePage />)
    await screen.findByText('QA')

    const big = new File([new Uint8Array(9 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, big)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/8 MB/i))
    // A convenience, not the control -- but it should not waste an upload either.
    expect(upload).not.toHaveBeenCalled()
  })

  it('says so when the profile cannot be loaded', async () => {
    vi.spyOn(avatarModule.avatarApi, 'mine').mockRejectedValue(new Error('nope'))

    renderWithProviders(<ProfilePage />)

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })
})
