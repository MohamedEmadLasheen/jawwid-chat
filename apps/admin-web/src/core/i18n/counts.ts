import type { Locale } from './messages'

/**
 * RQA-F2: a number and its noun, as Arabic says them. A fixed "{n} حصة" reads
 * "٣ حصة" (it should be "٣ حصص"); Arabic changes the noun with the number:
 *   1 -> its own word ("حصة واحدة"), 2 -> the dual ("حصتان"),
 *   3..10 -> the plural ("٣ حصص"), 0 and 11+ -> the singular ("١١ حصة"),
 *   and a fraction (2.5 hours) -> the singular ("٢٫٥ ساعة").
 * English is "1 lesson" / "n lessons". `shown` is the number already formatted
 * for the reader (digits, separators); `n` decides the form.
 */
export interface ArabicNoun {
  one: string
  two: string
  /** 3 to 10, after the number. */
  few: string
  /** 0, 11 and more, and fractions, after the number. */
  many: string
}

export interface CountedNoun {
  en: { one: string; other: string }
  ar: ArabicNoun
}

export function countLabel(n: number, shown: string, noun: CountedNoun, locale: Locale): string {
  if (locale === 'en') return `${shown} ${n === 1 ? noun.en.one : noun.en.other}`
  if (Number.isInteger(n)) {
    if (n === 1) return noun.ar.one
    if (n === 2) return noun.ar.two
    if (n >= 3 && n <= 10) return `${shown} ${noun.ar.few}`
  }
  return `${shown} ${noun.ar.many}`
}

export const LESSONS: CountedNoun = {
  en: { one: 'lesson', other: 'lessons' },
  ar: { one: 'حصة واحدة', two: 'حصتان', few: 'حصص', many: 'حصة' },
}

export const HOURS: CountedNoun = {
  en: { one: 'h', other: 'h' },
  ar: { one: 'ساعة واحدة', two: 'ساعتان', few: 'ساعات', many: 'ساعة' },
}

export const MINUTES: CountedNoun = {
  en: { one: 'min', other: 'min' },
  ar: { one: 'دقيقة واحدة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة' },
}

export const DAYS: CountedNoun = {
  en: { one: 'day', other: 'days' },
  ar: { one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يومًا' },
}

export const TRIALS: CountedNoun = {
  en: { one: 'trial', other: 'trials' },
  ar: { one: 'حصة تجريبية واحدة', two: 'حصتان تجريبيتان', few: 'حصص تجريبية', many: 'حصة تجريبية' },
}

export const STEPS: CountedNoun = {
  en: { one: 'step', other: 'steps' },
  ar: { one: 'خطوة واحدة', two: 'خطوتان', few: 'خطوات', many: 'خطوة' },
}

/**
 * RQA-F8: a length of time a person reads at a glance -- "45 min", "3 h 20 min",
 * "3 days 19 h" -- never "5,506 minutes". Two units at most; the smaller is
 * dropped when it is zero.
 */
export function durationLabel(minutes: number, number: (n: number) => string, locale: Locale): string {
  const m = Math.max(0, Math.round(minutes))
  const part = (n: number, noun: CountedNoun) => countLabel(n, number(n), noun, locale)
  if (m < 60) return part(m, MINUTES)
  const days = Math.floor(m / 1440)
  const hours = Math.floor((m % 1440) / 60)
  const mins = m % 60
  const join = (a: string, b: string | null) => (b ? (locale === 'ar' ? `${a} و${b}` : `${a} ${b}`) : a)
  if (days > 0) return join(part(days, DAYS), hours > 0 ? part(hours, HOURS) : null)
  return join(part(hours, HOURS), mins > 0 ? part(mins, MINUTES) : null)
}
