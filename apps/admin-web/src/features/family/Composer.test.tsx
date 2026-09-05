import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from './Composer'
import { makeCapabilities, renderWithProviders } from '@/test/utils'

/**
 * The composer is where the brief's handling rules become visible to an
 * operator, so these tests are about authority and about not sending twice.
 */
describe('Composer', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify({ id: 'msg_new' }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }),
              ),
            10,
          ),
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('always offers an internal note, because any admin may write one on any family', () => {
    renderWithProviders(
      <Composer
        familyId="fam_1"
        capabilities={makeCapabilities({ can_send_customer_message: false })}
        activeCaseId={null}
      />,
    )
    expect(screen.getByRole('button', { name: 'Internal note' })).toBeEnabled()
  })

  it('explains why a reply is unavailable instead of silently hiding it', () => {
    renderWithProviders(
      <Composer
        familyId="fam_1"
        capabilities={makeCapabilities({
          can_send_customer_message: false,
          assist_blocked_reason: 'the on-duty admin has this open',
        })}
        activeCaseId={null}
      />,
    )
    expect(screen.getByRole('button', { name: 'Reply' })).toBeDisabled()
    expect(
      screen.getByText('You cannot reply here: the on-duty admin has this open'),
    ).toBeInTheDocument()
  })

  it('falls back to an internal note when the operator is off duty', async () => {
    renderWithProviders(
      <Composer
        familyId="fam_1"
        capabilities={makeCapabilities({ can_send_customer_message: false })}
        activeCaseId={null}
      />,
    )
    await userEvent.type(screen.getByRole('textbox'), 'noting this for the owner')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    // It must not silently become a customer-visible message.
    expect(body.visibility).toBe('internal')
  })

  it('never sends on_behalf_mode — the server derives it from on_duty()', async () => {
    renderWithProviders(
      <Composer familyId="fam_1" capabilities={makeCapabilities()} activeCaseId={null} />,
    )
    await userEvent.type(screen.getByRole('textbox'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body).not.toHaveProperty('on_behalf_mode')
  })

  it('sends an idempotency key so a retry cannot post the reply twice', async () => {
    renderWithProviders(
      <Composer familyId="fam_1" capabilities={makeCapabilities()} activeCaseId={null} />,
    )
    await userEvent.type(screen.getByRole('textbox'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]![1].headers['Idempotency-Key']).toBeTruthy()
  })

  it('cannot be double-submitted while the first send is in flight', async () => {
    renderWithProviders(
      <Composer familyId="fam_1" capabilities={makeCapabilities()} activeCaseId={null} />,
    )
    await userEvent.type(screen.getByRole('textbox'), 'hello')
    const send = screen.getByRole('button', { name: 'Send' })

    await userEvent.click(send)
    await waitFor(() => expect(send).toBeDisabled())

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('attaches the reply to the open case when one is selected', async () => {
    renderWithProviders(
      <Composer familyId="fam_1" capabilities={makeCapabilities()} activeCaseId="case_7" />,
    )
    await userEvent.type(screen.getByRole('textbox'), 'about your renewal')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).case_id).toBe('case_7')
  })

  it('sends on Enter and keeps Shift+Enter for a newline', async () => {
    renderWithProviders(
      <Composer familyId="fam_1" capabilities={makeCapabilities()} activeCaseId={null} />,
    )
    const input = screen.getByRole('textbox')

    await userEvent.type(input, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(fetchMock).not.toHaveBeenCalled()

    await userEvent.type(input, '{Enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('refuses to send whitespace', async () => {
    renderWithProviders(
      <Composer familyId="fam_1" capabilities={makeCapabilities()} activeCaseId={null} />,
    )
    await userEvent.type(screen.getByRole('textbox'), '   {Enter}')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
