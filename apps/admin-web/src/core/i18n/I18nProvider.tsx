import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { messages, type Locale, type MessageKey } from './messages'

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
 * `-u-nu-latn` is not decoration: `terminology.md` §8.2 and DD-09 require
 * WESTERN digits 0–9 in both locales, and plain `ar-EG` gives `Intl` the
 * Arabic-Indic set (٠١٢٣) for every number, duration and time it formats. The
 * mobile app renders «قبل 5 دقائق» with Latin digits, and a console that wrote
 * «قبل ٥ دقائق» beside it would be a second numeral system in one product.
 */
const LOCALE_TAG: Record<Locale, string> = { ar: 'ar-EG-u-nu-latn', en: 'en-GB' }

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
    const dateTimeFmt = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' })
    const dateFmt = new Intl.DateTimeFormat(tag, { dateStyle: 'medium' })
    const timeFmt = new Intl.DateTimeFormat(tag, { timeStyle: 'short' })

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

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
