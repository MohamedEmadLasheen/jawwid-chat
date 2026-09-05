import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useI18n } from './I18nProvider'
import { messages } from './messages'
import { renderWithProviders } from '@/test/utils'

function Probe() {
  const { t, dir, locale, setLocale, duration, number } = useI18n()
  return (
    <div>
      <span data-testid="dir">{dir}</span>
      <span data-testid="locale">{locale}</span>
      <span data-testid="nav">{t('nav.inbox')}</span>
      <span data-testid="interpolated">{t('inbox.openCases', { count: 3 })}</span>
      <span data-testid="duration">{duration(new Date(Date.now() - 12 * 60_000).toISOString())}</span>
      <span data-testid="number">{number(1234)}</span>
      <button type="button" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>
        toggle
      </button>
    </div>
  )
}

describe('localisation', () => {
  it('is a real RTL layout in Arabic, not a mirrored English one', async () => {
    renderWithProviders(<Probe />, { locale: 'ar' })
    expect(screen.getByTestId('dir')).toHaveTextContent('rtl')
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
    expect(screen.getByTestId('nav')).toHaveTextContent('الوارد')
  })

  it('switches direction and language together', async () => {
    renderWithProviders(<Probe />, { locale: 'ar' })
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('dir')).toHaveTextContent('ltr')
    expect(document.documentElement.dir).toBe('ltr')
    expect(screen.getByTestId('nav')).toHaveTextContent('Inbox')
  })

  it('interpolates parameters', () => {
    renderWithProviders(<Probe />, { locale: 'en' })
    expect(screen.getByTestId('interpolated')).toHaveTextContent('3 open cases')
  })

  it('formats durations and numbers in the active locale', () => {
    renderWithProviders(<Probe />, { locale: 'en' })
    expect(screen.getByTestId('duration')).toHaveTextContent('12 minutes ago')
    expect(screen.getByTestId('number')).toHaveTextContent('1,234')
  })

  it('has an Arabic string for every English key — Arabic is not an afterthought', () => {
    const englishKeys = Object.keys(messages.en).sort()
    const arabicKeys = Object.keys(messages.ar).sort()
    expect(arabicKeys).toEqual(englishKeys)

    for (const [key, value] of Object.entries(messages.ar)) {
      expect(value, `ar.${key} is empty`).not.toBe('')
      // A stray English fallback would silently ship an untranslated string.
      expect(value, `ar.${key} looks untranslated`).not.toBe(
        messages.en[key as keyof typeof messages.en],
      )
    }
  })

  it('never exposes an internal bucket name or score to an operator', () => {
    for (const locale of ['en', 'ar'] as const) {
      for (const key of ['bucket.now', 'bucket.today', 'bucket.waiting_family', 'bucket.quiet'] as const) {
        const value: string = messages[locale][key]
        expect(value).not.toMatch(/\d/)
        expect(value.toLowerCase()).not.toContain('bucket')
      }
    }
  })
})
