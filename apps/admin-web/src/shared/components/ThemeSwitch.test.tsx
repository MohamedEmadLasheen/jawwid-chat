import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { THEME_KEY, readTheme } from '@/core/theme/theme'
import { ThemeSwitch } from './ThemeSwitch'

describe('the theme switch: Light, Dark, Auto', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })
  afterEach(() => document.documentElement.removeAttribute('data-theme'))

  it('starts on Auto (the device decides) and forces nothing', () => {
    renderWithProviders(<ThemeSwitch />)
    expect(readTheme()).toBe('auto')
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('applies and remembers a choice; Auto lets the device decide again', async () => {
    renderWithProviders(<ThemeSwitch />)
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')

    await userEvent.click(screen.getByRole('radio', { name: 'Auto' }))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
  })

  it('moves between the choices with the arrow keys, as a radio group does', async () => {
    renderWithProviders(<ThemeSwitch />)
    screen.getByRole('radio', { name: 'Auto' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    // Auto is last; the next one wraps to Light.
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Light' }))
  })
})
