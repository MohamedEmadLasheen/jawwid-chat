import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { PasswordResetForm } from './PasswordResetForm'
import { PASSWORD_MIN_LENGTH } from './passwordPolicy'

/**
 * Owner decision 2026-10-27: a password may be as short as 4 characters, for
 * every account. The server enforces the same rule; this proves the form's side.
 */

let fetchMock: ReturnType<typeof vi.fn>
const resets = () => fetchMock.mock.calls.filter(([u]) => /\/auth\/password-reset$/.test(String(u)))

beforeEach(() => {
  fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

async function fill(password: string, confirm = password) {
  renderWithProviders(<PasswordResetForm initialEmail="a@example.test" onDone={vi.fn()} onBack={vi.fn()} />)
  await userEvent.type(screen.getByLabelText('One-time code'), '123456')
  await userEvent.type(screen.getByLabelText(/^New password/), password)
  await userEvent.type(screen.getByLabelText('Repeat the new password'), confirm)
  await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
}

describe('the password-reset form: minimum length', () => {
  it('is 4', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(4)
  })

  it('says "At least 4 characters." next to the field', () => {
    renderWithProviders(<PasswordResetForm initialEmail="" onDone={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByText('At least 4 characters.')).toBeInTheDocument()
  })

  it('refuses 3 characters without calling the server', async () => {
    await fill('abc')
    expect(await screen.findByRole('alert')).toHaveTextContent('At least 4 characters.')
    expect(resets()).toHaveLength(0)
  })

  it('accepts 4 characters and sends them', async () => {
    await fill('1234')
    await waitFor(() => expect(resets()).toHaveLength(1))
    expect(JSON.parse(String((resets()[0]![1] as RequestInit).body))).toMatchObject({ password: '1234' })
  })
})
