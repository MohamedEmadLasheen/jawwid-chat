import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { makeStaff, renderWithProviders } from '@/test/utils'

/**
 * ADMIN-008 (QA AR-I18N-01): the Admin Web opened in whatever language someone
 * last picked in this browser, and never read the account's own (/me.locale) --
 * so it "switched between page loads" from one person to the next. The
 * interface now speaks the signed-in account's language: its own pick on this
 * browser, else /me.locale; a pick made while signed in is that account's only.
 */
function Lang() {
  const { locale, setLocale } = useI18n()
  return (
    <>
      <span data-testid="lang">{locale}</span>
      <button type="button" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>switch</button>
    </>
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })))
  localStorage.setItem('jawwid.locale', 'en')
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.removeItem('jawwid.locale')
})

describe('ADMIN-008: the account\'s language', () => {
  it('an account opens in its /me.locale, whatever the last person picked in this browser', async () => {
    renderWithProviders(<Lang />, { locale: 'en', staff: makeStaff({ id: 'acc-ar', locale: 'ar' }) })
    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('ar'))
    expect(document.documentElement.lang).toBe('ar')
    expect(document.documentElement.dir).toBe('rtl')
  })

  it('a pick made while signed in is remembered for that account, and only that account', async () => {
    const first = renderWithProviders(<Lang />, { locale: 'en', staff: makeStaff({ id: 'acc-1', locale: 'ar' }) })
    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('ar'))
    act(() => screen.getByRole('button', { name: 'switch' }).click())
    expect(screen.getByTestId('lang')).toHaveTextContent('en')
    first.unmount()

    // The next person on this browser opens in THEIR language, not the pick above.
    const second = renderWithProviders(<Lang />, { locale: 'en', staff: makeStaff({ id: 'acc-2', locale: 'ar' }) })
    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('ar'))
    second.unmount()

    // The first person, back, has their own pick.
    renderWithProviders(<Lang />, { locale: 'ar', staff: makeStaff({ id: 'acc-1', locale: 'ar' }) })
    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('en'))
  })

  it('without a language of its own the account keeps what is on screen', async () => {
    renderWithProviders(<Lang />, { locale: 'en', staff: makeStaff({ id: 'acc-none' }) })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('lang')).toHaveTextContent('en')
  })
})
