import { useCallback, useEffect, useState } from 'react'

/**
 * The admin web's theme: Light, Dark, or Auto (follow the operating system; the default).
 * A forced choice is the `data-theme` attribute on <html>; Auto removes it and the CSS follows
 * `prefers-color-scheme`. The choice is kept on this device and applied before the first paint by
 * public/theme-init.js (same key and values).
 */
export type ThemeChoice = 'light' | 'dark' | 'auto'
export const THEME_KEY = 'jawwid.theme'
export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'auto']

export function readTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
}

/** The current choice and a setter that stores and applies it (and follows other tabs). */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme)
  const set = useCallback((next: ThemeChoice) => {
    setChoice(next)
    applyTheme(next)
    try {
      if (next === 'auto') window.localStorage.removeItem(THEME_KEY)
      else window.localStorage.setItem(THEME_KEY, next)
    } catch {
      // A private window keeps the choice for this visit only.
    }
  }, [])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return
      const next = readTheme()
      setChoice(next)
      applyTheme(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return [choice, set]
}
