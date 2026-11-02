import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { messages, type Locale, type MessageKey } from './messages'
import { ACADEMY_ZONE } from '@/core/time/academyTime'

type Params = Record<string, string | number>

interface I18nValue {
  locale: Locale
  dir: 'rtl' | 'ltr'
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, params?: Params) => string
  /** Relative time such as "12 minutes" — used for wait durations. */
  duration: (fromIso: string, nowMs?: number) => string
  dateTime: (iso: string) => string
  date: (iso: string) => string
  time: (iso: string) => string
  number: (value: number) => string
}

const I18nContext = createContext<I18nValue | null>(null)

const STORAGE_KEY = 'jawwid.locale'
/**
 * ADMIN-008: a signed-in person's own choice, kept per account, so one person's
 * pick on a shared browser never becomes the next person's language. Without a
 * choice of their own, an account opens in its /me.locale.
 */
const accountKey = (accountId: string) => `${STORAGE_KEY}.account.${accountId}`

function readAccountLocale(accountId: string): Locale | null {
  try {
    const stored = localStorage.getItem(accountKey(accountId))
    if (stored === 'ar' || stored === 'en') return stored
  } catch {
    // Blocked storage: the account's own language stands.
  }
  return null
}

/** The language an account opens in: its own pick on this browser, else what /me says; null if neither is known. */
export function accountLocale(accountId: string, serverLocale: string | null | undefined): Locale | null {
  return readAccountLocale(accountId) ?? (serverLocale === 'en' || serverLocale === 'ar' ? serverLocale : null)
}

/** Remember `locale` as this account's own pick on this browser. */
export function rememberAccountLocale(accountId: string, locale: Locale): void {
  try {
    localStorage.setItem(accountKey(accountId), locale)
  } catch {
    // A convenience; losing it must not break the app.
  }
}
export const LOCALE_TAG: Record<Locale, string> = { ar: 'ar-EG', en: 'en-GB' }

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'ar' || stored === 'en') return stored
  } catch {
    // Private mode / blocked storage: fall through to the default.
  }
  return 'ar'
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  )
}

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode
  initialLocale?: Locale
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? readStoredLocale())
  const dir: 'rtl' | 'ltr' = locale === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = dir
  }, [locale, dir])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Preference is a convenience; losing it must not break the app.
    }
  }, [])

  const value = useMemo<I18nValue>(() => {
    const tag = LOCALE_TAG[locale]
    const dict = messages[locale]

    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto', style: 'long' })
    const numberFmt = new Intl.NumberFormat(tag)
    // PD-22: staff read every time in the academy's zone, never their browser's, so two
    // supervisors in two countries see the same clock.
    const dateTimeFmt = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short', timeZone: ACADEMY_ZONE })
    const dateFmt = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeZone: ACADEMY_ZONE })
    const timeFmt = new Intl.DateTimeFormat(tag, { timeStyle: 'short', timeZone: ACADEMY_ZONE })

    return {
      locale,
      dir,
      setLocale,
      t: (key, params) => interpolate(dict[key] ?? key, params),
      duration: (fromIso, nowMs = Date.now()) => {
        const elapsedMs = nowMs - new Date(fromIso).getTime()
        const minutes = Math.floor(elapsedMs / 60_000)
        if (minutes < 60) return rtf.format(-Math.max(minutes, 0), 'minute')
        const hours = Math.floor(minutes / 60)
        if (hours < 24) return rtf.format(-hours, 'hour')
        return rtf.format(-Math.floor(hours / 24), 'day')
      },
      dateTime: (iso) => dateTimeFmt.format(new Date(iso)),
      date: (iso) => dateFmt.format(new Date(iso)),
      time: (iso) => timeFmt.format(new Date(iso)),
      number: (n) => numberFmt.format(n),
    }
  }, [locale, dir, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** The i18n context when one is mounted, else null (the session works without one, as in some tests). */
export function useI18nIfAny(): I18nValue | null {
  return useContext(I18nContext)
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
