import { Fragment, useCallback, useMemo, type ReactNode } from 'react'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { HOURS, LESSONS, countLabel, durationLabel, type CountedNoun } from '@/core/i18n/counts'
import type { Bucket } from '../api'
import { T, type Pair } from '../copy'

/** "of/across 14 teachers": the noun agrees with its number in Arabic. */
export const TEACHERS: CountedNoun = {
  en: { one: 'teacher', other: 'teachers' },
  ar: { one: 'معلم واحد', two: 'معلمَين', few: 'معلمين', many: 'معلمًا' },
}

/** "Show 9 more": the teachers not yet shown. */
export const MORE_TEACHERS: CountedNoun = {
  en: { one: 'more', other: 'more' },
  ar: { one: 'معلمًا آخر', two: 'معلمَين آخرَين', few: 'معلمين آخرين', many: 'معلمًا آخر' },
}

/** "Ask for 9 late reports". */
export const LATE_REPORTS: CountedNoun = {
  en: { one: 'late report', other: 'late reports' },
  ar: { one: 'التقرير المتأخر', two: 'التقريرين المتأخرين', few: 'تقارير متأخرة', many: 'تقريرًا متأخرًا' },
}

/** Lessons after a preposition ("missed 2 lessons", "غياب عن حصتين"). */
export const LESSONS_AFTER: CountedNoun = {
  en: LESSONS.en,
  ar: { one: 'حصة', two: 'حصتين', few: 'حصص', many: 'حصة' },
}

export function useCopy() {
  const { locale } = useI18n()
  return useCallback(
    (pair: Pair, params?: Record<string, string | number>) => {
      const template = locale === 'ar' ? pair.ar : pair.en
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
    },
    [locale],
  )
}

/** A template whose slots are nodes (an isolated percentage inside a sentence). */
export function useCopyNodes() {
  const { locale } = useI18n()
  return useCallback(
    (pair: Pair, params: Record<string, ReactNode>): ReactNode => {
      const template = locale === 'ar' ? pair.ar : pair.en
      return template.split(/(\{\w+\})/g).map((part, i) => {
        const key = /^\{(\w+)\}$/.exec(part)?.[1]
        return <Fragment key={i}>{key !== undefined && key in params ? params[key] : part}</Fragment>
      })
    },
    [locale],
  )
}

/**
 * A rate as a whole percentage, isolated so it never reorders inside an
 * Arabic sentence and always reads "78%". `null` (nothing to divide) is a dash.
 */
export function Pct({ value, className }: { value: number | null; className?: string }) {
  const text = percentText(value)
  return (
    <bdi dir="ltr" className={className ? `ltr ${className}` : 'ltr'}>
      {text}
    </bdi>
  )
}

export function percentText(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

export function useFormat() {
  const { number, locale } = useI18n()
  const tx = useCopy()
  return useMemo(() => {
    // RQA-F2: the noun agrees with the number in Arabic ("٣ حصص", "ساعتان"), not a fixed singular.
    const hoursOf = (minutes: number) => {
      const h = Math.round((minutes / 60) * 10) / 10
      return countLabel(h, number(h), HOURS, locale)
    }
    const count = (n: number, noun: CountedNoun) => countLabel(n, number(n), noun, locale)
    const lessonsOf = (n: number) => count(n, LESSONS)
    const monthFmt = new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'long', year: 'numeric', timeZone: 'UTC' })
    return {
      locale,
      number,
      count,
      hours: (minutes: number | null) => (minutes === null ? tx(T.none) : hoursOf(minutes)),
      /** RQA-F8: "3 days 19 h", not "5,506 minutes". */
      duration: (m: number | null) => (m === null ? tx(T.none) : durationLabel(m, number, locale)),
      /** RQA-F8: "October 2026" / "أكتوبر 2026", never the raw "2026-10". */
      month: (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? monthFmt.format(new Date(`${ym}-01T00:00:00Z`)) : ym),
      percent: percentText,
      lessons: lessonsOf,
      // The lessons-and-hours pair of the full record's outcome cards.
      lessonsHours: (b: Bucket) => `${lessonsOf(b.lessons)}${locale === 'ar' ? '، ' : ', '}${hoursOf(b.minutes)}`,
    }
  }, [number, locale, tx])
}

export type Format = ReturnType<typeof useFormat>
